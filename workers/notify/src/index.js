import { runNotificationCycle } from './evaluator.js';
import { buildPublicGcmRegistration, buildPublicGcmRegistrations, checkGcmConnection, hasGcmServiceAccount, maskSecret, normalizeGcmPairedClients, normalizeGcmRegistrations, readGcmServiceAccount, resolveGcmProjectId } from './gcm.js';
import { compileNotifyRules, normalizeNotifyPayload } from './rules.js';

const SETTINGS_KEY = 'notify:settings';
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function jsonResponse(payload, { status = 200, origin = '*' } = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}

function emptyResponse({ status = 204, origin = '*' } = {}) {
  return new Response(null, {
    status,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}

function readOrigin(request) {
  return request.headers.get('origin') || '*';
}

function normalizeSettings(settings = {}) {
  const rawClients = typeof settings.clients === 'object' && settings.clients ? settings.clients : {};
  const gotifyClients = Array.isArray(settings.gotifyClients)
    ? settings.gotifyClients.map((client) => ({
        id: String(client?.id || '').trim(),
        baseUrl: String(client?.baseUrl || '').trim(),
        username: String(client?.username || '').trim(),
        token: String(client?.token || '').trim(),
        appId: Number(client?.appId) || 0,
        userId: Number(client?.userId) || 0,
        createdAt: String(client?.createdAt || '').trim()
      })).filter((client) => client.id && client.baseUrl && client.token)
    : [];
  const gcmRegistrations = normalizeGcmRegistrations(settings.gcmRegistrations);
  const clients = Object.entries(rawClients).reduce((map, [clientId, client]) => {
    const normalizedClientId = normalizeClientId(client?.clientId || clientId);

    if (!normalizedClientId) {
      return map;
    }

    map[normalizedClientId] = {
      clientId: normalizedClientId,
      clientLabel: normalizeClientName(client?.clientLabel || client?.notifyClientLabel || client?.clientName || ''),
      barkDeviceKey: String(client?.barkDeviceKey || '').trim(),
      payload: normalizeNotifyPayload(client?.payload || {}),
      state: {
        ruleStates: typeof client?.state?.ruleStates === 'object' && client.state.ruleStates ? client.state.ruleStates : {},
        deliveryFailures: typeof client?.state?.deliveryFailures === 'object' && client.state.deliveryFailures ? client.state.deliveryFailures : {},
        recentEvents: Array.isArray(client?.state?.recentEvents) ? client.state.recentEvents : [],
        lastRunAt: String(client?.state?.lastRunAt || '').trim()
      },
      meta: {
        counts: {
          planRuleCount: Number(client?.meta?.counts?.planRuleCount) || 0,
          dcaRuleCount: Number(client?.meta?.counts?.dcaRuleCount) || 0,
          totalRuleCount: Number(client?.meta?.counts?.totalRuleCount) || 0
        },
        lastSyncedAt: String(client?.meta?.lastSyncedAt || '').trim(),
        lastCheckedAt: String(client?.meta?.lastCheckedAt || '').trim(),
        lastTestedAt: String(client?.meta?.lastTestedAt || '').trim()
      }
    };

    return map;
  }, {});

  return {
    clients,
    gotifyBaseUrl: String(settings.gotifyBaseUrl || '').trim(),
    gotifyUsername: String(settings.gotifyUsername || '').trim(),
    gotifyPassword: String(settings.gotifyPassword || '').trim(),
    gotifyToken: String(settings.gotifyToken || '').trim(),
    gotifyClients,
    gcmProjectId: String(settings.gcmProjectId || '').trim(),
    gcmPackageName: String(settings.gcmPackageName || '').trim(),
    gcmRegistrations,
    gcmLastCheckAt: String(settings.gcmLastCheckAt || '').trim(),
    gcmLastCheckStatus: String(settings.gcmLastCheckStatus || '').trim(),
    gcmLastCheckDetail: String(settings.gcmLastCheckDetail || '').trim()
  };
}

function buildDefaultClientRecord(clientId = '', clientLabel = '') {
  const normalizedClientId = normalizeClientId(clientId);
  return {
    clientId: normalizedClientId,
    clientLabel: normalizeClientName(clientLabel),
    barkDeviceKey: '',
    payload: normalizeNotifyPayload({}),
    state: {
      ruleStates: {},
      deliveryFailures: {},
      recentEvents: [],
      lastRunAt: ''
    },
    meta: {
      counts: {
        planRuleCount: 0,
        dcaRuleCount: 0,
        totalRuleCount: 0
      },
      lastSyncedAt: '',
      lastCheckedAt: '',
      lastTestedAt: ''
    }
  };
}

function getClientRecord(settings, clientId = '', clientLabel = '') {
  const normalizedClientId = normalizeClientId(clientId);

  if (!normalizedClientId) {
    return buildDefaultClientRecord('', clientLabel);
  }

  const existing = settings.clients?.[normalizedClientId] || null;
  const nextClientLabel = normalizeClientName(clientLabel) || String(existing?.clientLabel || '').trim();

  return {
    ...buildDefaultClientRecord(normalizedClientId, nextClientLabel),
    ...(existing || {}),
    clientId: normalizedClientId,
    clientLabel: nextClientLabel
  };
}

function upsertClientRecord(settings, clientId = '', patch = {}) {
  const normalizedClientId = normalizeClientId(clientId);

  if (!normalizedClientId) {
    throw new Error('缺少浏览器 clientId。');
  }

  const current = getClientRecord(settings, normalizedClientId);
  const nextRecord = {
    ...buildDefaultClientRecord(normalizedClientId, patch.clientLabel ?? current.clientLabel),
    ...current,
    ...patch,
    clientId: normalizedClientId,
    clientLabel: normalizeClientName(patch.clientLabel ?? current.clientLabel ?? ''),
    barkDeviceKey: String(patch.barkDeviceKey ?? current.barkDeviceKey ?? '').trim(),
    payload: normalizeNotifyPayload(patch.payload ?? current.payload ?? {}),
    state: {
      ...buildDefaultClientRecord(normalizedClientId).state,
      ...(current.state || {}),
      ...(patch.state || {})
    },
    meta: {
      ...buildDefaultClientRecord(normalizedClientId).meta,
      ...(current.meta || {}),
      ...(patch.meta || {}),
      counts: {
        ...buildDefaultClientRecord(normalizedClientId).meta.counts,
        ...(current.meta?.counts || {}),
        ...(patch.meta?.counts || {})
      }
    }
  };

  return normalizeSettings({
    ...settings,
    clients: {
      ...(settings.clients || {}),
      [normalizedClientId]: nextRecord
    }
  });
}

function buildScopedNotifySettings(settings, clientId = '') {
  const clientRecord = getClientRecord(settings, clientId);

  return {
    ...settings,
    barkDeviceKey: clientRecord.barkDeviceKey,
    clientId: clientRecord.clientId,
    clientLabel: clientRecord.clientLabel
  };
}

function normalizeClientId(value = '') {
  return String(value || '').trim().slice(0, 120);
}

function normalizeClientName(value = '') {
  return String(value || '').trim().slice(0, 120);
}

function normalizePairingCode(value = '') {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function randomString(length = 16) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

function buildPairingCode(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => PAIRING_CODE_ALPHABET[value % PAIRING_CODE_ALPHABET.length]).join('');
}

async function hashText(value = '') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function isFutureIso(value = '') {
  const normalizedValue = String(value || '').trim();
  const expiresAt = Date.parse(normalizedValue);

  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function readCurrentClientId(request) {
  const url = new URL(request.url);
  return normalizeClientId(url.searchParams.get('clientId'));
}

function buildPublicGcmSetup(settings, env, options = {}) {
  const currentClientId = normalizeClientId(options?.clientId);
  const gcmRegistrations = buildPublicGcmRegistrations(settings.gcmRegistrations, {
    clientId: currentClientId
  });
  const gcmCurrentClientRegistrations = currentClientId
    ? gcmRegistrations.filter((registration) => registration.pairedToCurrentClient)
    : [];

  return {
    gcmProjectId: resolveGcmProjectId(settings, env),
    gcmPackageName: String(settings.gcmPackageName || '').trim(),
    gcmRegistrationCount: gcmRegistrations.length,
    gcmRegistrations,
    gcmCurrentClientId: currentClientId,
    gcmCurrentClientRegistrationCount: gcmCurrentClientRegistrations.length,
    gcmCurrentClientRegistrations,
    gcmPairedRegistrationCount: gcmRegistrations.filter((registration) => registration.pairedClientCount > 0).length,
    gcmUnpairedRegistrationCount: gcmRegistrations.filter((registration) => registration.pairedClientCount === 0).length,
    gcmServiceAccountConfigured: hasGcmServiceAccount(env),
    gcmLastCheckAt: String(settings.gcmLastCheckAt || '').trim(),
    gcmLastCheckStatus: String(settings.gcmLastCheckStatus || '').trim(),
    gcmLastCheckDetail: String(settings.gcmLastCheckDetail || '').trim()
  };
}

function applyGcmCheckState(registrations = [], matcher = null, details = {}) {
  if (typeof matcher !== 'function') {
    return registrations;
  }

  return registrations.map((registration) => (
    matcher(registration)
      ? {
          ...registration,
          lastCheckedAt: String(details.checkedAt || '').trim(),
          lastCheckStatus: String(details.status || '').trim(),
          lastCheckDetail: String(details.detail || '').trim(),
          updatedAt: String(details.updatedAt || registration.updatedAt || '').trim()
        }
      : registration
  ));
}

function upsertGcmRegistration(registrations = [], candidate = {}) {
  const normalizedToken = String(candidate.token || '').trim();
  const normalizedId = String(candidate.id || '').trim();
  let replaced = false;
  const nextRegistrations = registrations.map((registration) => {
    const sameRegistration = (
      normalizedId && registration.id === normalizedId
    ) || (
      normalizedToken && registration.token === normalizedToken
    );

    if (!sameRegistration) {
      return registration;
    }

    replaced = true;
    return {
      ...registration,
      ...candidate
    };
  });

  if (!replaced) {
    nextRegistrations.push(candidate);
  }

  return nextRegistrations;
}

function upsertGcmPairedClient(pairedClients = [], candidate = {}) {
  const normalizedClientId = normalizeClientId(candidate.clientId);
  let replaced = false;
  const nextPairedClients = pairedClients.map((client) => {
    if (client.clientId !== normalizedClientId) {
      return client;
    }

    replaced = true;
    return {
      ...client,
      ...candidate
    };
  });

  if (!replaced && normalizedClientId) {
    nextPairedClients.push(candidate);
  }

  return nextPairedClients;
}

function removeGcmPairedClient(pairedClients = [], clientId = '') {
  const normalizedClientId = normalizeClientId(clientId);

  if (!normalizedClientId) {
    return normalizeGcmPairedClients(pairedClients);
  }

  return normalizeGcmPairedClients(pairedClients).filter((client) => client.clientId !== normalizedClientId);
}

function findGcmRegistration(settings, { registrationId = '', token = '' } = {}) {
  const registrations = Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations : [];
  const normalizedRegistrationId = String(registrationId || '').trim();
  const normalizedToken = String(token || '').trim();

  if (normalizedRegistrationId) {
    return registrations.find((registration) => registration.id === normalizedRegistrationId) || null;
  }

  if (normalizedToken) {
    return registrations.find((registration) => registration.token === normalizedToken) || null;
  }

  return registrations[0] || null;
}

async function findGcmRegistrationByPairingCode(settings, pairingCode = '') {
  const normalizedPairingCode = normalizePairingCode(pairingCode);

  if (!normalizedPairingCode) {
    return null;
  }

  const pairingCodeHash = await hashText(normalizedPairingCode);

  return (Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations : []).find((registration) => (
    isFutureIso(registration.pairingCodeExpiresAt)
    && String(registration.pairingCodeHash || '').trim() === pairingCodeHash
  )) || null;
}

function ensureStateBinding(env) {
  if (!env.NOTIFY_STATE) {
    throw new Error('未配置 NOTIFY_STATE KV 绑定。');
  }
}

async function readJson(env, key, fallback) {
  ensureStateBinding(env);
  const rawValue = await env.NOTIFY_STATE.get(key);
  if (!rawValue) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return fallback;
  }
}

async function writeJson(env, key, value) {
  ensureStateBinding(env);
  await env.NOTIFY_STATE.put(key, JSON.stringify(value));
}

async function readSettings(env) {
  return normalizeSettings(await readJson(env, SETTINGS_KEY, {}));
}

async function writeSettings(env, settings) {
  await writeJson(env, SETTINGS_KEY, normalizeSettings(settings));
}

function requireCurrentClientId(request) {
  const currentClientId = readCurrentClientId(request);

  if (!currentClientId) {
    throw new Error('缺少浏览器 clientId。');
  }

  return currentClientId;
}

function getClientRecentEvents(clientRecord = {}) {
  return Array.isArray(clientRecord?.state?.recentEvents) ? clientRecord.state.recentEvents : [];
}

function getClientDeliveryFailures(clientRecord = {}) {
  return Object.values(typeof clientRecord?.state?.deliveryFailures === 'object' && clientRecord.state.deliveryFailures
    ? clientRecord.state.deliveryFailures
    : {});
}

function buildEmptyRunSummary() {
  return {
    triggeredCount: 0,
    deliveredCount: 0,
    events: [],
    clientCount: 0,
    clients: []
  };
}

function appendClientRunSummary(summary = buildEmptyRunSummary(), clientSummary = {}) {
  const nextEvents = [
    ...(Array.isArray(summary.events) ? summary.events : []),
    ...(Array.isArray(clientSummary.events) ? clientSummary.events : [])
  ].sort((left, right) => (
    Date.parse(String(right?.createdAt || '')) - Date.parse(String(left?.createdAt || ''))
  )).slice(0, 30);

  return {
    triggeredCount: Number(summary.triggeredCount) + (Number(clientSummary.triggeredCount) || 0),
    deliveredCount: Number(summary.deliveredCount) + (Number(clientSummary.deliveredCount) || 0),
    events: nextEvents,
    clientCount: Number(summary.clientCount) + 1,
    clients: [
      ...(Array.isArray(summary.clients) ? summary.clients : []),
      {
        clientId: String(clientSummary.clientId || '').trim(),
        clientLabel: String(clientSummary.clientLabel || '').trim(),
        triggeredCount: Number(clientSummary.triggeredCount) || 0,
        deliveredCount: Number(clientSummary.deliveredCount) || 0,
        eventCount: Array.isArray(clientSummary.events) ? clientSummary.events.length : 0
      }
    ]
  };
}

function applySettingsRemovals(settings, clientId = '', removals = []) {
  const nextSettings = normalizeSettings(settings);

  for (const removal of removals) {
    const configType = String(removal?.configType || '').trim();
    const configKey = String(removal?.configKey || '').trim();
    const configId = String(removal?.configId || '').trim();

    if (!configType || !configKey) {
      continue;
    }

    if (configType === 'bark-client') {
      const targetClientId = normalizeClientId(configId || clientId);

      if (!targetClientId) {
        continue;
      }

      nextSettings.clients[targetClientId] = {
        ...getClientRecord(nextSettings, targetClientId),
        barkDeviceKey: ''
      };
      continue;
    }

    if (configType === 'gotify-client') {
      nextSettings.gotifyClients = nextSettings.gotifyClients.filter((client) => `gotify-client:${client.id}` !== configKey && String(client.id || '').trim() !== configId);
      continue;
    }

    if (configType === 'gotify-legacy') {
      nextSettings.gotifyBaseUrl = '';
      nextSettings.gotifyToken = '';
    }
  }

  return nextSettings;
}

async function handleStatus(request, env) {
  const origin = readOrigin(request);
  const currentClientId = requireCurrentClientId(request);
  const settings = await readSettings(env);
  const clientRecord = getClientRecord(settings, currentClientId);
  const recentEvents = getClientRecentEvents(clientRecord);
  const deliveryFailures = getClientDeliveryFailures(clientRecord);
  const gcmSetup = buildPublicGcmSetup(settings, env, {
    clientId: currentClientId
  });

  return jsonResponse({
    configured: {
      bark: Boolean(clientRecord.barkDeviceKey),
      gotify: false,
      gcm: Boolean(gcmSetup.gcmServiceAccountConfigured && gcmSetup.gcmCurrentClientRegistrationCount)
    },
    counts: {
      planRuleCount: Number(clientRecord?.meta?.counts?.planRuleCount) || 0,
      dcaRuleCount: Number(clientRecord?.meta?.counts?.dcaRuleCount) || 0,
      totalRuleCount: Number(clientRecord?.meta?.counts?.totalRuleCount) || 0
    },
    lastSyncedAt: String(clientRecord?.meta?.lastSyncedAt || ''),
    lastCheckedAt: String(clientRecord?.meta?.lastCheckedAt || ''),
    lastTestedAt: String(clientRecord?.meta?.lastTestedAt || ''),
    eventCount: recentEvents.length,
    lastEvent: recentEvents[0] || null,
    deliveryFailureCount: deliveryFailures.length,
    deliveryFailures,
    setup: {
      barkDeviceKey: clientRecord.barkDeviceKey,
      clientId: clientRecord.clientId,
      clientLabel: clientRecord.clientLabel,
      ...gcmSetup
    }
  }, { origin });
}

async function handleEvents(request, env) {
  const origin = readOrigin(request);
  const currentClientId = requireCurrentClientId(request);
  const settings = await readSettings(env);
  const clientRecord = getClientRecord(settings, currentClientId);

  return jsonResponse({
    events: getClientRecentEvents(clientRecord)
  }, { origin });
}

async function handleSync(request, env) {
  const origin = readOrigin(request);
  const currentClientId = requireCurrentClientId(request);
  const rawPayload = await request.json().catch(() => ({}));
  const payload = normalizeNotifyPayload(rawPayload);
  const compiled = compileNotifyRules(payload);
  const currentClientLabel = normalizeClientName(rawPayload?.clientLabel || rawPayload?.notifyClientLabel || '');
  const settings = await readSettings(env);
  const existingClient = getClientRecord(settings, currentClientId, currentClientLabel);
  const allowedRuleIds = new Set(compiled.allRules.map((rule) => rule.ruleId));
  const nextRuleStates = Object.entries(existingClient?.state?.ruleStates || {}).reduce((map, [ruleId, state]) => {
    if (allowedRuleIds.has(ruleId)) {
      map[ruleId] = state;
    }
    return map;
  }, {});
  const nextState = {
    ...existingClient.state,
    ruleStates: nextRuleStates,
    recentEvents: getClientRecentEvents(existingClient)
  };
  const nextMeta = {
    ...existingClient.meta,
    counts: compiled.summary,
    lastSyncedAt: payload.syncedAt
  };
  const nextSettings = upsertClientRecord(settings, currentClientId, {
    clientLabel: currentClientLabel || existingClient.clientLabel,
    payload,
    state: nextState,
    meta: nextMeta
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    clientId: currentClientId,
    counts: compiled.summary,
    lastSyncedAt: payload.syncedAt
  }, { origin });
}

async function handleSettings(request, env) {
  const origin = readOrigin(request);
  const currentClientId = requireCurrentClientId(request);
  const existingSettings = await readSettings(env);
  const payload = await request.json().catch(() => ({}));
  const nextSettings = upsertClientRecord(existingSettings, currentClientId, {
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || ''),
    barkDeviceKey: String(payload?.barkDeviceKey || '').trim()
  });
  const nextClientRecord = getClientRecord(nextSettings, currentClientId);

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    setup: {
      barkDeviceKey: nextClientRecord.barkDeviceKey,
      clientId: nextClientRecord.clientId,
      clientLabel: nextClientRecord.clientLabel,
      ...buildPublicGcmSetup(nextSettings, env, {
        clientId: currentClientId
      })
    }
  }, { origin });
}

async function handleGcmPairingKey(request, env) {
  const origin = readOrigin(request);
  const settings = await readSettings(env);
  const payload = await request.json().catch(() => ({}));
  const registrationId = String(payload.registrationId || '').trim();
  const token = String(payload.token || payload.registrationToken || '').trim();
  const selectedRegistration = findGcmRegistration(settings, {
    registrationId,
    token
  });

  if (!selectedRegistration) {
    throw new Error('当前设备还没有完成注册，请先调用 /api/notify/gcm/register。');
  }

  const pairingCode = buildPairingCode(8);
  const pairingCodeHash = await hashText(pairingCode);
  const pairingCodeIssuedAt = new Date().toISOString();
  const pairingCodeExpiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();
  const nextRegistration = {
    ...selectedRegistration,
    pairingCodeHash,
    pairingCodeIssuedAt,
    pairingCodeExpiresAt,
    updatedAt: pairingCodeIssuedAt
  };
  const nextSettings = normalizeSettings({
    ...settings,
    gcmRegistrations: upsertGcmRegistration(settings.gcmRegistrations, nextRegistration)
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    registration: buildPublicGcmRegistration(nextRegistration),
    pairing: {
      code: pairingCode,
      issuedAt: pairingCodeIssuedAt,
      expiresAt: pairingCodeExpiresAt
    },
    setup: buildPublicGcmSetup(nextSettings, env)
  }, { origin });
}

async function handleGcmPair(request, env) {
  const origin = readOrigin(request);
  const settings = await readSettings(env);
  const payload = await request.json().catch(() => ({}));
  const pairingCode = normalizePairingCode(payload.pairingCode || payload.code || '');
  const clientId = normalizeClientId(payload.clientId);
  const clientName = normalizeClientName(payload.clientName) || 'Web 控制台';

  if (!clientId) {
    throw new Error('缺少浏览器 clientId。');
  }

  if (!pairingCode) {
    throw new Error('缺少设备配对码。');
  }

  const selectedRegistration = await findGcmRegistrationByPairingCode(settings, pairingCode);

  if (!selectedRegistration) {
    throw new Error('配对码无效或已过期，请回到 Android app 重新生成。');
  }

  const nowIso = new Date().toISOString();
  const nextRegistration = {
    ...selectedRegistration,
    pairedClients: upsertGcmPairedClient(selectedRegistration.pairedClients, {
      clientId,
      clientName,
      pairedAt: nowIso,
      lastSeenAt: nowIso
    }),
    pairingCodeHash: '',
    pairingCodeIssuedAt: '',
    pairingCodeExpiresAt: '',
    updatedAt: nowIso
  };
  let nextSettings = normalizeSettings({
    ...settings,
    gcmRegistrations: upsertGcmRegistration(settings.gcmRegistrations, nextRegistration)
  });
  nextSettings = upsertClientRecord(nextSettings, clientId, {
    clientLabel: clientName
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    registration: buildPublicGcmRegistration(nextRegistration, {
      clientId
    }),
    setup: buildPublicGcmSetup(nextSettings, env, {
      clientId
    })
  }, { origin });
}

async function handleGcmUnpair(request, env) {
  const origin = readOrigin(request);
  const settings = await readSettings(env);
  const payload = await request.json().catch(() => ({}));
  const clientId = normalizeClientId(payload.clientId || readCurrentClientId(request));
  const registrationId = String(payload.registrationId || '').trim();
  const token = String(payload.token || payload.registrationToken || '').trim();

  if (!clientId) {
    throw new Error('缺少浏览器 clientId。');
  }

  const selectedRegistration = findGcmRegistration(settings, {
    registrationId,
    token
  });

  if (!selectedRegistration) {
    throw new Error('未找到需要解绑的 Android 设备。');
  }

  const nowIso = new Date().toISOString();
  const nextRegistration = {
    ...selectedRegistration,
    pairedClients: removeGcmPairedClient(selectedRegistration.pairedClients, clientId),
    updatedAt: nowIso
  };
  const nextSettings = normalizeSettings({
    ...settings,
    gcmRegistrations: upsertGcmRegistration(settings.gcmRegistrations, nextRegistration)
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    registration: buildPublicGcmRegistration(nextRegistration, {
      clientId
    }),
    setup: buildPublicGcmSetup(nextSettings, env, {
      clientId
    })
  }, { origin });
}

async function handleGcmRegister(request, env) {
  const origin = readOrigin(request);
  const settings = await readSettings(env);
  const payload = await request.json().catch(() => ({}));
  const serviceAccount = (() => {
    try {
      return readGcmServiceAccount(env);
    } catch (_error) {
      return null;
    }
  })();
  const projectId = String(payload.projectId || settings.gcmProjectId || serviceAccount?.projectId || '').trim();
  const packageName = String(payload.packageName || settings.gcmPackageName || '').trim();
  const deviceName = String(payload.deviceName || '').trim() || 'Android Device';
  const registrationId = String(payload.registrationId || '').trim();
  const token = String(payload.token || payload.registrationToken || '').trim();
  const appId = String(payload.appId || '').trim();
  const senderId = String(payload.senderId || '').trim();

  if (!projectId) {
    throw new Error('注册 Android GCM 设备前需要先提供 Firebase Project ID。');
  }

  if (!token) {
    throw new Error('缺少 Android registration token。');
  }

  const nowIso = new Date().toISOString();
  const existingRegistration = findGcmRegistration(settings, {
    registrationId,
    token
  });
  const registration = {
    ...existingRegistration,
    id: existingRegistration?.id || registrationId || `gcm:${randomString(10).toLowerCase()}`,
    deviceName,
    packageName,
    appId,
    senderId,
    token,
    createdAt: existingRegistration?.createdAt || nowIso,
    updatedAt: nowIso,
    lastCheckedAt: existingRegistration?.lastCheckedAt || '',
    lastCheckStatus: existingRegistration?.lastCheckStatus || '',
    lastCheckDetail: existingRegistration?.lastCheckDetail || '',
    pairedClients: existingRegistration?.pairedClients || [],
    pairingCodeHash: existingRegistration?.pairingCodeHash || '',
    pairingCodeIssuedAt: existingRegistration?.pairingCodeIssuedAt || '',
    pairingCodeExpiresAt: existingRegistration?.pairingCodeExpiresAt || ''
  };
  const nextSettings = normalizeSettings({
    ...settings,
    gcmProjectId: projectId,
    gcmPackageName: packageName || settings.gcmPackageName,
    gcmRegistrations: upsertGcmRegistration(settings.gcmRegistrations, registration)
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    registration: buildPublicGcmRegistration(registration),
    setup: buildPublicGcmSetup(nextSettings, env)
  }, { origin });
}

async function handleGcmCheck(request, env) {
  const origin = readOrigin(request);
  const settings = await readSettings(env);
  const payload = await request.json().catch(() => ({}));
  const explicitToken = String(payload.token || payload.registrationToken || '').trim();
  const explicitRegistrationId = String(payload.registrationId || '').trim();
  const selectedRegistration = findGcmRegistration(settings, {
    registrationId: explicitRegistrationId,
    token: explicitToken
  });
  const projectId = String(payload.projectId || settings.gcmProjectId || resolveGcmProjectId(settings, env) || '').trim();
  const packageName = String(payload.packageName || selectedRegistration?.packageName || settings.gcmPackageName || '').trim();
  const token = explicitToken || String(selectedRegistration?.token || '').trim();
  const registrationMatcher = selectedRegistration
    ? (registration) => registration.id === selectedRegistration.id
    : explicitToken
      ? (registration) => registration.token === explicitToken
      : null;

  try {
    const result = await checkGcmConnection({
      env,
      projectId,
      packageName,
      token
    });
    const nextSettings = normalizeSettings({
      ...settings,
      gcmProjectId: projectId,
      gcmPackageName: packageName || settings.gcmPackageName,
      gcmLastCheckAt: result.checkedAt,
      gcmLastCheckStatus: result.status,
      gcmLastCheckDetail: result.detail,
      gcmRegistrations: applyGcmCheckState(settings.gcmRegistrations, registrationMatcher, {
        checkedAt: result.checkedAt,
        status: result.status,
        detail: result.detail,
        updatedAt: new Date().toISOString()
      })
    });

    await writeSettings(env, nextSettings);

    return jsonResponse({
      ok: true,
      result,
      registration: selectedRegistration
        ? buildPublicGcmRegistration({
            ...selectedRegistration,
            packageName,
            lastCheckedAt: result.checkedAt,
            lastCheckStatus: result.status,
            lastCheckDetail: result.detail
          })
        : explicitToken
          ? {
              id: '',
              deviceName: String(payload.deviceName || '').trim(),
              packageName,
              tokenMasked: maskSecret(explicitToken),
              createdAt: '',
              updatedAt: '',
              lastCheckedAt: result.checkedAt,
              lastCheckStatus: result.status,
              lastCheckDetail: result.detail
            }
          : null,
      setup: buildPublicGcmSetup(nextSettings, env)
    }, { origin });
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : 'GCM 连接检查失败';
    const checkedAt = new Date().toISOString();
    const failedSettings = normalizeSettings({
      ...settings,
      gcmProjectId: projectId,
      gcmPackageName: packageName || settings.gcmPackageName,
      gcmLastCheckAt: checkedAt,
      gcmLastCheckStatus: 'failed',
      gcmLastCheckDetail: failureMessage,
      gcmRegistrations: applyGcmCheckState(settings.gcmRegistrations, registrationMatcher, {
        checkedAt,
        status: 'failed',
        detail: failureMessage,
        updatedAt: new Date().toISOString()
      })
    });

    await writeSettings(env, failedSettings);
    throw error;
  }
}

async function createGotifyAccount(settings) {
  const baseUrl = String(settings.gotifyBaseUrl || '').trim();
  const adminUsername = String(settings.gotifyUsername || '').trim();
  const adminPassword = String(settings.gotifyPassword || '').trim();

  if (!baseUrl || !adminUsername || !adminPassword) {
    throw new Error('Gotify 管理配置不完整，无法生成安卓接入账号。');
  }

  const username = `ai-dca-${randomString(8).toLowerCase()}`;
  const password = randomString(18);
  const endpoint = new URL('/user', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${adminUsername}:${adminPassword}`)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: username,
      pass: password,
      admin: false
    })
  });
  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = { error: rawText };
    }
  }

  if (!response.ok) {
    throw new Error(payload.errorDescription || payload.error || `创建 Gotify 用户失败：状态 ${response.status}`);
  }

  const appResponse = await fetch(new URL('/application', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString(), {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${username}:${password}`)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: `ai-dca-mobile-${randomString(6).toLowerCase()}`,
      description: 'AI DCA 移动端通知接收',
      defaultPriority: 8
    })
  });
  const appRawText = await appResponse.text();
  let appPayload = {};

  if (appRawText) {
    try {
      appPayload = JSON.parse(appRawText);
    } catch (_error) {
      appPayload = { error: appRawText };
    }
  }

  if (!appResponse.ok) {
    throw new Error(appPayload.errorDescription || appPayload.error || `创建 Gotify 应用失败：状态 ${appResponse.status}`);
  }

  return {
    id: `gotify:${username}`,
    gotifyBaseUrl: baseUrl,
    gotifyUsername: username,
    gotifyPassword: password,
    gotifyUserId: Number(payload.id) || 0,
    gotifyAppId: Number(appPayload.id) || 0,
    gotifyToken: String(appPayload.token || '').trim(),
    createdAt: new Date().toISOString()
  };
}

async function handleGotifyAccount(request, env) {
  const origin = readOrigin(request);
  const settings = await readSettings(env);
  const account = await createGotifyAccount(settings);
  const nextSettings = normalizeSettings({
    ...settings,
    gotifyClients: [
      ...(Array.isArray(settings.gotifyClients) ? settings.gotifyClients : []),
      {
        id: account.id,
        baseUrl: account.gotifyBaseUrl,
        username: account.gotifyUsername,
        token: account.gotifyToken,
        appId: account.gotifyAppId,
        userId: account.gotifyUserId,
        createdAt: account.createdAt
      }
    ]
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    account: {
      gotifyBaseUrl: account.gotifyBaseUrl,
      gotifyUsername: account.gotifyUsername,
      gotifyPassword: account.gotifyPassword
    }
  }, { origin });
}

async function runClientDetection(env, settings, clientRecord, { reason = 'manual-run', testPayload = null } = {}) {
  const currentClientId = normalizeClientId(clientRecord?.clientId);

  if (!currentClientId) {
    return {
      settings,
      summary: buildEmptyRunSummary()
    };
  }

  env.__notifySettings = buildScopedNotifySettings(settings, currentClientId);
  env.__notifyCurrentClientId = currentClientId;
  const cycle = await runNotificationCycle(env, clientRecord.payload, clientRecord.state, {
    reason,
    testPayload
  });
  let nextSettings = settings;

  if (Array.isArray(cycle.settingsRemovals) && cycle.settingsRemovals.length) {
    nextSettings = applySettingsRemovals(nextSettings, currentClientId, cycle.settingsRemovals);
  }

  const refreshedClient = getClientRecord(nextSettings, currentClientId, clientRecord.clientLabel);
  const nowIso = new Date().toISOString();
  nextSettings = upsertClientRecord(nextSettings, currentClientId, {
    clientLabel: refreshedClient.clientLabel || clientRecord.clientLabel,
    state: cycle.state,
    meta: {
      ...refreshedClient.meta,
      counts: testPayload ? refreshedClient.meta.counts : compileNotifyRules(refreshedClient.payload).summary,
      lastCheckedAt: testPayload ? refreshedClient.meta.lastCheckedAt : nowIso,
      lastTestedAt: testPayload ? nowIso : refreshedClient.meta.lastTestedAt
    }
  });

  return {
    settings: nextSettings,
    summary: {
      ...cycle.summary,
      clientId: currentClientId,
      clientLabel: refreshedClient.clientLabel || clientRecord.clientLabel
    }
  };
}

async function handleTest(request, env) {
  const origin = readOrigin(request);
  const currentClientId = requireCurrentClientId(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const clientRecord = getClientRecord(settings, currentClientId);
  const result = await runClientDetection(env, settings, clientRecord, {
    reason: 'manual-test',
    testPayload: {
      title: String(payload.title || '交易计划测试提醒'),
      body: String(payload.body || '这是一条测试通知，用来校验当前已接入的提醒通道是否可用。'),
      summary: String(payload.summary || '测试通知'),
      ruleId: String(payload.ruleId || 'test')
    }
  });
  settings = result.settings;
  await writeSettings(env, settings);

  return jsonResponse({
    ok: true,
    summary: result.summary
  }, { origin });
}

async function runDetection(env, reason = 'manual-run', options = {}) {
  let settings = await readSettings(env);
  const requestedClientId = normalizeClientId(options?.clientId);
  const clientRecords = requestedClientId
    ? [getClientRecord(settings, requestedClientId)]
    : Object.values(settings.clients || {}).filter((client) => normalizeClientId(client?.clientId));
  let summary = buildEmptyRunSummary();

  for (const clientRecord of clientRecords) {
    const result = await runClientDetection(env, settings, clientRecord, {
      reason
    });
    settings = result.settings;
    summary = appendClientRunSummary(summary, result.summary);
  }

  await writeSettings(env, settings);
  return summary;
}

async function handleRun(request, env) {
  const origin = readOrigin(request);
  const summary = await runDetection(env, 'manual-run', {
    clientId: readCurrentClientId(request)
  });

  return jsonResponse({
    ok: true,
    summary
  }, { origin });
}

export default {
  async fetch(request, env) {
    const origin = readOrigin(request);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return emptyResponse({ origin });
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/notify/status') {
        return await handleStatus(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/events') {
        return await handleEvents(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/sync') {
        return await handleSync(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/test') {
        return await handleTest(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/settings') {
        return await handleSettings(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gotify-account') {
        return jsonResponse({ error: 'Gotify 通知能力已移除。' }, { status: 410, origin });
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/register') {
        return await handleGcmRegister(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/check') {
        return await handleGcmCheck(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/pairing-key') {
        return await handleGcmPairingKey(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/pair') {
        return await handleGcmPair(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/unpair') {
        return await handleGcmUnpair(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/run') {
        return await handleRun(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/health') {
        return jsonResponse({ ok: true }, { origin });
      }

      return jsonResponse({ error: '未找到通知接口。' }, { status: 404, origin });
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }

      return jsonResponse({
        error: error instanceof Error ? error.message : '通知服务异常'
      }, {
        status: 500,
        origin
      });
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runDetection(env, 'scheduled'));
  }
};
