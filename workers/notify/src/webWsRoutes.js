import { readSettings, writeSettings } from './notifyStorage.js';
import { jsonResponse, readOrigin } from './notifyHttp.js';
import { findGcmRegistration } from './gcmRegistrationState.js';
import { isWebWsRegistration, normalizeGcmRegistrations } from './gcm.js';
import { tryPublishWs } from './wsHub.js';
import {
  getClientRecord,
  hashText,
  normalizeClientId,
  normalizeClientName,
  normalizeClientSecret,
  normalizeDeviceInstallationId,
  randomString,
  upsertClientRecord
} from './clientSettings.js';
import { requireAdminToken } from './security.js';

const MAX_STORED_WEB_WS_REGISTRATIONS = 64;
const WS_PATH_PREFIX = '/api/notify/ws/';
const WEB_WS_CAPABILITIES = new Set(['notify', 'market']);

function safeDecodePathSegment(value = '') {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (_) {
    return String(value || '');
  }
}

function webWsRegistrationTime(registration = {}) {
  return Date.parse(String(registration?.updatedAt || registration?.createdAt || '')) || 0;
}

function normalizeRequestedCapabilities(value) {
  const raw = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : []);
  const capabilities = [];
  for (const item of raw) {
    const capability = String(item || '').trim().toLowerCase();
    if (WEB_WS_CAPABILITIES.has(capability) && !capabilities.includes(capability)) {
      capabilities.push(capability);
    }
  }
  return capabilities.length ? capabilities : ['notify', 'market'];
}

function pruneWebWsRegistrations(registrations = [], keepDeviceInstallationId = '') {
  const normalizedKeepId = normalizeDeviceInstallationId(keepDeviceInstallationId);
  const normalized = normalizeGcmRegistrations(registrations);
  const webWs = normalized.filter((registration) => isWebWsRegistration(registration));
  const nonWebWs = normalized.filter((registration) => !isWebWsRegistration(registration));
  const sortedWebWs = [...webWs].sort((a, b) => webWsRegistrationTime(b) - webWsRegistrationTime(a));
  const kept = new Map();

  for (const registration of sortedWebWs) {
    const id = normalizeDeviceInstallationId(registration.deviceInstallationId || registration.id);
    if (normalizedKeepId && id === normalizedKeepId) {
      kept.set(id, registration);
      break;
    }
  }

  for (const registration of sortedWebWs) {
    if (kept.size >= MAX_STORED_WEB_WS_REGISTRATIONS) break;
    const id = normalizeDeviceInstallationId(registration.deviceInstallationId || registration.id);
    if (!id || kept.has(id)) continue;
    kept.set(id, registration);
  }

  return [...nonWebWs, ...kept.values()];
}

export async function handleWebWsRegister(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const clientId = normalizeClientId(payload?.clientId);
  const clientSecret = normalizeClientSecret(payload?.clientSecret);

  if (!clientId || !clientSecret) {
    return jsonResponse({ ok: false, message: '缺少 clientId 或 clientSecret。' }, { status: 400, origin });
  }

  let settings = await readSettings(env);
  let existingClient = settings.clients?.[clientId] || null;
  const clientSecretHash = await hashText(clientSecret);
  if (String(existingClient?.clientSecretHash || '').trim() && existingClient.clientSecretHash !== clientSecretHash) {
    return jsonResponse({ ok: false, message: 'clientSecret 验证失败。' }, { status: 401, origin });
  }

  const requestedClientLabel = normalizeClientName(payload?.clientLabel || payload?.label || payload?.clientName || '');
  const capabilities = normalizeRequestedCapabilities(payload?.capabilities);
  const shouldBootstrapClient = !existingClient || !String(existingClient.clientSecretHash || '').trim();
  const shouldUpdateClientLabel = requestedClientLabel && requestedClientLabel !== String(existingClient?.clientLabel || '').trim();
  if (shouldBootstrapClient || shouldUpdateClientLabel) {
    settings = upsertClientRecord(settings, clientId, {
      ...(requestedClientLabel ? { clientLabel: requestedClientLabel } : {}),
      clientSecretHash
    });
    existingClient = settings.clients?.[clientId] || getClientRecord(settings, clientId);
  }

  const deviceInstallationId = `web-ws:${clientId}`;
  const wsToken = randomString(64);
  const registrations = normalizeGcmRegistrations(settings.gcmRegistrations);
  const existingIdx = registrations.findIndex((r) => r.deviceInstallationId === deviceInstallationId);
  const nowIso = new Date().toISOString();
  const webDevice = {
    id: deviceInstallationId,
    deviceInstallationId,
    deviceName: `Web · ${existingClient.clientLabel || clientId}`,
    packageName: '',
    token: wsToken,
    isWebClient: true,
    capabilities,
    pairedClients: [{
      clientId,
      groupId: existingClient.notifyGroupId || clientId,
      clientName: existingClient.clientLabel || '',
      pairedAt: nowIso,
      lastSeenAt: nowIso
    }],
    createdAt: nowIso,
    updatedAt: nowIso
  };

  if (existingIdx >= 0) {
    registrations[existingIdx] = { ...registrations[existingIdx], ...webDevice };
  } else {
    registrations.push(webDevice);
  }

  settings.gcmRegistrations = pruneWebWsRegistrations(registrations, deviceInstallationId);
  await writeSettings(env, settings);

  return jsonResponse({ ok: true, deviceInstallationId, token: wsToken }, { origin });
}

export async function handleWebWsUnregister(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const clientId = normalizeClientId(payload?.clientId);
  const clientSecret = normalizeClientSecret(payload?.clientSecret);

  if (!clientId || !clientSecret) {
    return jsonResponse({ ok: false, message: '缺少 clientId 或 clientSecret。' }, { status: 400, origin });
  }

  let settings = await readSettings(env);
  const existingClient = settings.clients?.[clientId];

  if (!existingClient) {
    return jsonResponse({ ok: false, message: '客户端未注册。' }, { status: 404, origin });
  }

  const clientSecretHash = await hashText(clientSecret);
  if (existingClient.clientSecretHash && existingClient.clientSecretHash !== clientSecretHash) {
    return jsonResponse({ ok: false, message: 'clientSecret 验证失败。' }, { status: 401, origin });
  }

  const deviceInstallationId = `web-ws:${clientId}`;
  const registrations = normalizeGcmRegistrations(settings.gcmRegistrations);
  settings.gcmRegistrations = registrations.filter((r) => r.deviceInstallationId !== deviceInstallationId);
  await writeSettings(env, settings);

  return jsonResponse({ ok: true }, { origin });
}

export async function handleWebWsRequest(request, env, url) {
  const origin = readOrigin(request);
  const tail = url.pathname.slice(WS_PATH_PREFIX.length);
  const slashIdx = tail.indexOf('/');
  const deviceInstallationIdRaw = slashIdx === -1 ? tail : tail.slice(0, slashIdx);
  const subpath = slashIdx === -1 ? '' : tail.slice(slashIdx + 1);
  const deviceInstallationId = normalizeDeviceInstallationId(safeDecodePathSegment(deviceInstallationIdRaw || ''));

  if (!deviceInstallationId) {
    return jsonResponse({ ok: false, message: '缺少 deviceInstallationId。' }, { status: 400, origin });
  }

  if (request.method === 'POST' && subpath === 'publish') {
    const authError = requireAdminToken(request, env, { origin });
    if (authError) return authError;
    let body = {};
    try { body = await request.json(); } catch (_) { body = {}; }
    const result = await tryPublishWs(env, deviceInstallationId, body || {});
    return jsonResponse({ ok: !!(result && result.ok), result }, { origin });
  }

  if (request.method === 'GET' && subpath === '') {
    if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') {
      return jsonResponse({ ok: false, message: 'expected websocket upgrade' }, { status: 426, origin });
    }
    const protoHeader = request.headers.get('sec-websocket-protocol') || '';
    const protocols = protoHeader.split(',').map((s) => s.trim()).filter(Boolean);
    const tokenProto = protocols.find((p) => p.startsWith('jijin-token-')) || '';
    const token = tokenProto ? tokenProto.slice('jijin-token-'.length).trim() : '';
    if (!token) {
      return jsonResponse({ ok: false, message: '缺少 token 子协议。' }, { status: 401, origin });
    }
    const settings = await readSettings(env);
    const reg = findGcmRegistration(settings, { deviceInstallationId });
    if (!reg) {
      return jsonResponse({ ok: false, message: '未找到设备注册记录。' }, { status: 404, origin });
    }
    if (!reg.isWebClient && !String(reg.deviceInstallationId || reg.id || '').startsWith('web-ws:')) {
      return jsonResponse({ ok: false, message: '旧版 Android GCM/FCM 设备已下线。' }, { status: 410, origin });
    }
    if (String(reg.token || '').trim() !== token) {
      return jsonResponse({ ok: false, message: 'token 与注册记录不一致。' }, { status: 401, origin });
    }
    const id = env.WS_HUB.idFromName(deviceInstallationId);
    const stub = env.WS_HUB.get(id);
    const forwardedHeaders = new Headers(request.headers);
    forwardedHeaders.set('x-device-installation-id', deviceInstallationId);
    return await stub.fetch('https://ws-hub/connect', new Request(request, { headers: forwardedHeaders }));
  }

  return jsonResponse({ ok: false, message: 'invalid ws route' }, { status: 404, origin });
}
