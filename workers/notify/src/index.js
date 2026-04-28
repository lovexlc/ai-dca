import { runNotificationCycle } from './evaluator.js';
import { buildPublicGcmRegistration, buildPublicGcmRegistrations, checkGcmConnection, hasGcmServiceAccount, isRegistrationPairedToScope, maskSecret, normalizeGcmPairedClients, normalizeGcmRegistrations, normalizeNotifyGroupId, readGcmServiceAccount, resolveGcmProjectId } from './gcm.js';
import { compileNotifyRules, normalizeNotifyPayload } from './rules.js';

const SETTINGS_KEY = 'notify:settings';
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const GROUP_SHARE_CODE_TTL_MS = 10 * 60 * 1000;
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLIENT_SECRET_HEADER = 'x-notify-client-secret';

function jsonResponse(payload, { status = 200, origin = '*' } = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': `content-type, ${CLIENT_SECRET_HEADER}`
    }
  });
}

function emptyResponse({ status = 204, origin = '*' } = {}) {
  return new Response(null, {
    status,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': `content-type, ${CLIENT_SECRET_HEADER}`
    }
  });
}

function readOrigin(request) {
  return request.headers.get('origin') || '*';
}

function normalizeSettings(settings = {}) {
  const rawClients = typeof settings.clients === 'object' && settings.clients ? settings.clients : {};
  const notifyGroupShares = Array.isArray(settings.notifyGroupShares)
    ? settings.notifyGroupShares.map((share) => ({
        codeHash: String(share?.codeHash || '').trim(),
        groupId: normalizeNotifyGroupId(share?.groupId),
        createdByClientId: normalizeClientId(share?.createdByClientId),
        createdAt: String(share?.createdAt || '').trim(),
        expiresAt: String(share?.expiresAt || '').trim()
      })).filter((share) => share.codeHash && share.groupId && isFutureIso(share.expiresAt))
    : [];
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
      notifyGroupId: normalizeNotifyGroupId(client?.notifyGroupId || normalizedClientId) || normalizedClientId,
      clientSecretHash: String(client?.clientSecretHash || '').trim(),
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
    notifyGroupShares,
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
    notifyGroupId: normalizeNotifyGroupId(normalizedClientId) || normalizedClientId,
    clientSecretHash: '',
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
    notifyGroupId: normalizeNotifyGroupId(patch.notifyGroupId ?? current.notifyGroupId ?? normalizedClientId) || normalizedClientId,
    clientSecretHash: String(patch.clientSecretHash ?? current.clientSecretHash ?? '').trim(),
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
    clientLabel: clientRecord.clientLabel,
    notifyGroupId: clientRecord.notifyGroupId
  };
}

function normalizeClientId(value = '') {
  return String(value || '').trim().slice(0, 120);
}

function normalizeClientName(value = '') {
  return String(value || '').trim().slice(0, 120);
}

function normalizeClientSecret(value = '') {
  return String(value || '').trim().slice(0, 240);
}

function normalizeDeviceInstallationId(value = '') {
  return String(value || '').trim().slice(0, 160);
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

function readCurrentClientSecret(request) {
  return normalizeClientSecret(request.headers.get(CLIENT_SECRET_HEADER));
}

function resolveClientGroupId(settings, clientId = '', clientLabel = '') {
  const clientRecord = getClientRecord(settings, clientId, clientLabel);
  return normalizeNotifyGroupId(clientRecord.notifyGroupId || clientRecord.clientId) || clientRecord.clientId;
}

function getNotifyGroupMembers(settings, groupId = '') {
  const normalizedGroupId = normalizeNotifyGroupId(groupId);

  if (!normalizedGroupId) {
    return [];
  }

  return Object.values(settings.clients || {}).filter((client) => (
    resolveClientGroupId(settings, client?.clientId, client?.clientLabel) === normalizedGroupId
  ));
}

function requireMatchingClientId(request, payload = {}) {
  const queryClientId = readCurrentClientId(request);
  const bodyClientId = normalizeClientId(payload.clientId);
  const currentClientId = queryClientId || bodyClientId;

  if (!currentClientId) {
    throw new Error('缺少浏览器 clientId。');
  }

  if (queryClientId && bodyClientId && queryClientId !== bodyClientId) {
    throw new Error('浏览器 clientId 不匹配。');
  }

  return currentClientId;
}

async function ensureAuthenticatedClient(request, settings, options = {}) {
  const clientId = requireMatchingClientId(request, options?.payload);
  const clientSecret = readCurrentClientSecret(request);
  const desiredClientLabel = normalizeClientName(options?.clientLabel || '');

  if (!clientSecret) {
    throw new Error('缺少浏览器鉴权信息，请刷新页面后重试。');
  }

  const existingClient = settings.clients?.[clientId] || null;
  const clientSecretHash = await hashText(clientSecret);

  if (String(existingClient?.clientSecretHash || '').trim() && existingClient.clientSecretHash !== clientSecretHash) {
    throw new Error('浏览器鉴权失败，请回到原浏览器页面重新加载后重试。');
  }

  const needsSecretBootstrap = !existingClient || !String(existingClient.clientSecretHash || '').trim();
  const needsLabelUpdate = desiredClientLabel && desiredClientLabel !== String(existingClient?.clientLabel || '').trim();
  const resolvedGroupId = normalizeNotifyGroupId(existingClient?.notifyGroupId || clientId) || clientId;

  if (needsSecretBootstrap || needsLabelUpdate) {
    const nextSettings = upsertClientRecord(settings, clientId, {
      clientLabel: needsLabelUpdate ? desiredClientLabel : String(existingClient?.clientLabel || desiredClientLabel || '').trim(),
      notifyGroupId: resolvedGroupId,
      clientSecretHash
    });

    return {
      didUpdate: true,
      clientId,
      clientRecord: getClientRecord(nextSettings, clientId, desiredClientLabel),
      settings: nextSettings
    };
  }

  return {
    didUpdate: false,
    clientId,
    clientRecord: getClientRecord(settings, clientId, desiredClientLabel),
    settings
  };
}

function buildPublicGcmSetup(settings, env, options = {}) {
  const currentClientId = normalizeClientId(options?.clientId);
  const currentGroupId = currentClientId ? resolveClientGroupId(settings, currentClientId) : '';
  const gcmRegistrations = buildPublicGcmRegistrations(settings.gcmRegistrations, {
    clientId: currentClientId,
    currentGroupId
  });
  const gcmCurrentClientRegistrations = currentClientId
    ? gcmRegistrations.filter((registration) => registration.pairedToCurrentClient)
    : [];
  const notifyGroupMembers = currentGroupId ? getNotifyGroupMembers(settings, currentGroupId) : [];

  return {
    notifyGroupId: currentGroupId,
    notifyGroupMemberCount: notifyGroupMembers.length,
    notifyGroupMemberClientIds: notifyGroupMembers.map((client) => client.clientId),
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
  const normalizedDeviceInstallationId = normalizeDeviceInstallationId(candidate.deviceInstallationId || candidate.id);
  let replaced = false;
  const nextRegistrations = registrations.map((registration) => {
    const registrationDeviceInstallationId = normalizeDeviceInstallationId(registration.deviceInstallationId || registration.id);
    const sameRegistration = (
      normalizedDeviceInstallationId && registrationDeviceInstallationId === normalizedDeviceInstallationId
    ) || (
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

function removeGcmPairedGroup(pairedClients = [], groupId = '') {
  const normalizedGroupId = normalizeNotifyGroupId(groupId);

  if (!normalizedGroupId) {
    return normalizeGcmPairedClients(pairedClients);
  }

  return normalizeGcmPairedClients(pairedClients).filter((client) => client.groupId !== normalizedGroupId);
}

function findGcmRegistration(settings, { deviceInstallationId = '', registrationId = '', token = '' } = {}) {
  const registrations = Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations : [];
  const normalizedDeviceInstallationId = normalizeDeviceInstallationId(deviceInstallationId);
  const normalizedRegistrationId = String(registrationId || '').trim();
  const normalizedToken = String(token || '').trim();

  if (normalizedDeviceInstallationId) {
    return registrations.find((registration) => (
      normalizeDeviceInstallationId(registration.deviceInstallationId || registration.id) === normalizedDeviceInstallationId
    )) || null;
  }

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

async function findNotifyGroupShare(settings, shareCode = '') {
  const normalizedShareCode = normalizePairingCode(shareCode);

  if (!normalizedShareCode) {
    return null;
  }

  const shareCodeHash = await hashText(normalizedShareCode);

  return (Array.isArray(settings.notifyGroupShares) ? settings.notifyGroupShares : []).find((share) => (
    isFutureIso(share.expiresAt)
    && String(share.codeHash || '').trim() === shareCodeHash
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

function requireAuthenticatedGcmRegistration(selectedRegistration, token = '') {
  const normalizedToken = String(token || '').trim();

  if (!normalizedToken) {
    throw new Error('缺少 Android registration token。');
  }

  if (!selectedRegistration) {
    throw new Error('当前设备还没有完成注册，请先调用 /api/notify/gcm/register。');
  }

  if (String(selectedRegistration.token || '').trim() !== normalizedToken) {
    throw new Error('Android 设备鉴权失败，请使用当前 app 里的有效 token 重新请求。');
  }
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
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  const currentClientId = auth.clientId;
  const clientRecord = auth.clientRecord;

  if (auth.didUpdate) {
    await writeSettings(env, settings);
  }

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
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;

  if (auth.didUpdate) {
    await writeSettings(env, settings);
  }

  return jsonResponse({
    events: getClientRecentEvents(auth.clientRecord)
  }, { origin });
}

async function handleSync(request, env) {
  const origin = readOrigin(request);
  const rawPayload = await request.json().catch(() => ({}));
  const payload = normalizeNotifyPayload(rawPayload);
  const compiled = compileNotifyRules(payload);
  const currentClientLabel = normalizeClientName(rawPayload?.clientLabel || rawPayload?.notifyClientLabel || '');
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    clientLabel: currentClientLabel
  });
  settings = auth.settings;
  const currentClientId = auth.clientId;
  const existingClient = auth.clientRecord;
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
  const payload = await request.json().catch(() => ({}));
  const currentClientLabel = normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '');
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    clientLabel: currentClientLabel
  });
  settings = auth.settings;
  const currentClientId = auth.clientId;
  const nextSettings = upsertClientRecord(settings, currentClientId, {
    clientLabel: currentClientLabel || auth.clientRecord.clientLabel,
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

async function handleNotifyGroupShareCode(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '')
  });
  settings = auth.settings;
  const currentClientId = auth.clientId;
  const currentGroupId = resolveClientGroupId(settings, currentClientId, auth.clientRecord.clientLabel);
  const shareCode = buildPairingCode(8);
  const codeHash = await hashText(shareCode);
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + GROUP_SHARE_CODE_TTL_MS).toISOString();
  const nextSettings = normalizeSettings({
    ...settings,
    notifyGroupShares: [
      ...(Array.isArray(settings.notifyGroupShares) ? settings.notifyGroupShares : []).filter((share) => share.groupId !== currentGroupId),
      {
        codeHash,
        groupId: currentGroupId,
        createdByClientId: currentClientId,
        createdAt: issuedAt,
        expiresAt
      }
    ]
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    shareGroup: {
      code: shareCode,
      groupId: currentGroupId,
      issuedAt,
      expiresAt
    },
    setup: buildPublicGcmSetup(nextSettings, env, {
      clientId: currentClientId
    })
  }, { origin });
}

async function handleNotifyGroupJoin(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const shareCode = normalizePairingCode(payload.shareCode || payload.code || '');

  if (!shareCode) {
    throw new Error('缺少通知共享码。');
  }

  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || payload?.clientName || '')
  });
  settings = auth.settings;
  const currentClientId = auth.clientId;
  const currentClientLabel = auth.clientRecord.clientLabel || 'Web 控制台';
  const targetShare = await findNotifyGroupShare(settings, shareCode);

  if (!targetShare) {
    throw new Error('通知共享码无效或已过期，请在原浏览器重新生成。');
  }

  const targetGroupId = normalizeNotifyGroupId(targetShare.groupId);
  const nowIso = new Date().toISOString();
  let nextSettings = upsertClientRecord(settings, currentClientId, {
    clientLabel: currentClientLabel,
    notifyGroupId: targetGroupId,
    clientSecretHash: auth.clientRecord.clientSecretHash
  });
  nextSettings = normalizeSettings({
    ...nextSettings,
    gcmRegistrations: normalizeGcmRegistrations(nextSettings.gcmRegistrations).map((registration) => {
      if (!normalizeGcmPairedClients(registration.pairedClients).some((client) => client.groupId === targetGroupId)) {
        return registration;
      }

      return {
        ...registration,
        pairedClients: upsertGcmPairedClient(registration.pairedClients, {
          clientId: currentClientId,
          groupId: targetGroupId,
          clientName: currentClientLabel,
          pairedAt: nowIso,
          lastSeenAt: nowIso
        }),
        updatedAt: nowIso
      };
    })
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    notifyGroup: {
      groupId: targetGroupId,
      memberCount: getNotifyGroupMembers(nextSettings, targetGroupId).length
    },
    setup: buildPublicGcmSetup(nextSettings, env, {
      clientId: currentClientId
    })
  }, { origin });
}

async function handleGcmPairingKey(request, env) {
  const origin = readOrigin(request);
  const settings = await readSettings(env);
  const payload = await request.json().catch(() => ({}));
  const deviceInstallationId = normalizeDeviceInstallationId(payload.deviceInstallationId || payload.installationId || '');
  const registrationId = String(payload.registrationId || '').trim();
  const token = String(payload.token || payload.registrationToken || '').trim();
  const selectedRegistration = findGcmRegistration(settings, {
    deviceInstallationId,
    registrationId,
    token
  });

  requireAuthenticatedGcmRegistration(selectedRegistration, token);

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
    registration: buildPublicGcmRegistration(nextRegistration, {
      includePairedClientIds: true
    }),
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
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const pairingCode = normalizePairingCode(payload.pairingCode || payload.code || '');
  const clientName = normalizeClientName(payload.clientName) || 'Web 控制台';
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: clientName
  });
  settings = auth.settings;
  const clientId = auth.clientId;
  const currentGroupId = resolveClientGroupId(settings, clientId, auth.clientRecord.clientLabel);

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
      groupId: currentGroupId,
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
    clientLabel: clientName,
    clientSecretHash: auth.clientRecord.clientSecretHash
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
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload
  });
  settings = auth.settings;
  const clientId = auth.clientId;
  const currentGroupId = resolveClientGroupId(settings, clientId, auth.clientRecord.clientLabel);
  const deviceInstallationId = normalizeDeviceInstallationId(payload.deviceInstallationId || payload.installationId || '');
  const registrationId = String(payload.registrationId || '').trim();
  const token = String(payload.token || payload.registrationToken || '').trim();

  const selectedRegistration = findGcmRegistration(settings, {
    deviceInstallationId,
    registrationId,
    token
  });

  if (!selectedRegistration) {
    throw new Error('未找到需要解绑的 Android 设备。');
  }

  if (!normalizeGcmPairedClients(selectedRegistration.pairedClients).some((client) => client.groupId === currentGroupId)) {
    throw new Error('当前共享组与这台 Android 设备还没有建立绑定关系。');
  }

  const nowIso = new Date().toISOString();
  const nextRegistration = {
    ...selectedRegistration,
    pairedClients: removeGcmPairedGroup(selectedRegistration.pairedClients, currentGroupId),
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
  const deviceInstallationId = normalizeDeviceInstallationId(payload.deviceInstallationId || payload.installationId || '');
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

  if (!deviceInstallationId) {
    throw new Error('缺少 Android deviceInstallationId。');
  }

  const nowIso = new Date().toISOString();
  const existingRegistration = findGcmRegistration(settings, {
    deviceInstallationId,
    registrationId,
    token
  });
  const registration = {
    ...existingRegistration,
    id: deviceInstallationId,
    deviceInstallationId,
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
    registration: buildPublicGcmRegistration(registration, {
      includePairedClientIds: true
    }),
    setup: buildPublicGcmSetup(nextSettings, env)
  }, { origin });
}

async function handleGcmCheck(request, env) {
  const origin = readOrigin(request);
  const settings = await readSettings(env);
  const payload = await request.json().catch(() => ({}));
  const explicitDeviceInstallationId = normalizeDeviceInstallationId(payload.deviceInstallationId || payload.installationId || '');
  const explicitToken = String(payload.token || payload.registrationToken || '').trim();
  const explicitRegistrationId = String(payload.registrationId || '').trim();
  const selectedRegistration = findGcmRegistration(settings, {
    deviceInstallationId: explicitDeviceInstallationId,
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

  requireAuthenticatedGcmRegistration(selectedRegistration, explicitToken);

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
          }, {
            includePairedClientIds: true
          })
        : explicitToken
          ? {
              id: explicitDeviceInstallationId,
              deviceInstallationId: explicitDeviceInstallationId,
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
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  const currentClientId = auth.clientId;
  const clientRecord = auth.clientRecord;

  if (auth.didUpdate) {
    await writeSettings(env, settings);
  }

  const result = await runClientDetection(env, settings, clientRecord, {
    reason: 'manual-test',
    testPayload: {
      eventId: String(payload.eventId || '').trim(),
      eventType: String(payload.eventType || 'test').trim() || 'test',
      title: String(payload.title || '交易计划测试提醒'),
      body: String(payload.body || '这是一条测试通知，用来校验当前已接入的提醒通道是否可用。'),
      summary: String(payload.summary || '测试通知'),
      ruleId: String(payload.ruleId || 'test'),
      symbol: String(payload.symbol || '').trim(),
      strategyName: String(payload.strategyName || '').trim(),
      triggerCondition: String(payload.triggerCondition || '').trim(),
      purchaseAmount: String(payload.purchaseAmount || '').trim(),
      detailUrl: String(payload.detailUrl || payload.url || '').trim()
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
  const requestedClientId = readCurrentClientId(request);

  if (requestedClientId) {
    const settings = await readSettings(env);
    const auth = await ensureAuthenticatedClient(request, settings);

    if (auth.didUpdate) {
      await writeSettings(env, auth.settings);
    }
  }

  const summary = await runDetection(env, 'manual-run', {
    clientId: requestedClientId
  });

  return jsonResponse({
    ok: true,
    summary
  }, { origin });
}

// ---------------------------------------------------------------------------
// 持仓当日收益提醒
// 前端在「通知」tab 开启后会 POST 代码+组合权重的快照到 KV，定时任务在
// 15:30 / 20:30 / 21:30 （Asia/Shanghai）拉取净值后计算全仓当日收益率并推送。
// KV 中不存份额/金额/成本等任何用户敏感数据。
// ---------------------------------------------------------------------------

const HOLDINGS_RULE_KEY_PREFIX = 'holdings-rule:';
const HOLDINGS_DEDUP_KEY_PREFIX = 'holdings-dedup:';
const HOLDINGS_DEDUP_TTL_SECONDS = 36 * 3600;
const FUND_CODE_PATTERN = /^\d{6}$/;

function holdingsRuleKey(clientId) {
  return `${HOLDINGS_RULE_KEY_PREFIX}${clientId}`;
}

function holdingsDedupKey(clientId, kind, dateKey) {
  return `${HOLDINGS_DEDUP_KEY_PREFIX}${clientId}:${kind}:${dateKey}`;
}

/**
 * 按基金类型返回「今日预期的最新 NAV 日期」（与前端 holdingsLedgerCore.js 保持一致）。
 * - exchange：金融市场（中国A股 ETF）周一至周五 = 当日；周六映射到周五，周日到周五。
 * - otc：场外公募基金一般 T-1；中港/QDII 周一是 T-3（上周五）。
 *   这里统一取 “上一个交易日”（周一 → 上周五，其他工作日 → 昨天，周六/周日 → 上周五）。
 */
function getExpectedLatestNavDate(kind, todayShanghai) {
  const [y, m, d] = String(todayShanghai).split('-').map((s) => Number(s));
  if (!y || !m || !d) return todayShanghai;
  const today = new Date(Date.UTC(y, m - 1, d));
  const dow = today.getUTCDay(); // 0=Sun … 6=Sat
  const shift = (days) => {
    const t = new Date(today.getTime());
    t.setUTCDate(t.getUTCDate() - days);
    const yy = t.getUTCFullYear();
    const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(t.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };
  if (kind === 'exchange') {
    if (dow === 0) return shift(2); // 周日 → 上周五
    if (dow === 6) return shift(1); // 周六 → 周五
    return todayShanghai;
  }
  // otc （含 QDII）
  if (dow === 1) return shift(3); // 周一 → 上周五 (QDII T-3)
  if (dow === 0) return shift(2); // 周日 → 周五
  if (dow === 6) return shift(1); // 周六 → 周五
  return shift(1); // 周二至周五 → 昨天 (T-1)
}

function getShanghaiDateParts(date = new Date()) {
  // 使用 Intl 拿到 Asia/Shanghai 的年月日/小时/分钟（包依轻量，Worker 运行时可用）。
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${hour}:${parts.minute}`
  };
}

function normalizeHoldingsDigest(digest) {
  const result = {
    version: 1,
    generatedAt: '',
    exchange: [],
    otc: []
  };
  if (!digest || typeof digest !== 'object') return result;
  if (digest.generatedAt) result.generatedAt = String(digest.generatedAt);

  let totalWeight = 0;
  for (const bucket of ['exchange', 'otc']) {
    const list = Array.isArray(digest[bucket]) ? digest[bucket] : [];
    for (const entry of list) {
      const code = String(entry?.code || '').trim();
      const weight = Number(entry?.weight);
      if (!FUND_CODE_PATTERN.test(code)) continue;
      if (!Number.isFinite(weight) || weight <= 0 || weight > 1) continue;
      result[bucket].push({ code, weight });
      totalWeight += weight;
    }
  }

  // 软限制：总权重 ≤ 1.5（两个 bucket 各自合计 ≤ 1，上限考虑取整冗余）
  if (totalWeight > 1.5) {
    return result;
  }
  return result;
}

async function handleHoldingsRuleGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;

  if (auth.didUpdate) {
    await writeSettings(env, settings);
  }

  const stored = await readJson(env, holdingsRuleKey(auth.clientId), null);
  if (!stored) {
    return jsonResponse({
      enabled: false,
      digest: null,
      updatedAt: ''
    }, { origin });
  }

  return jsonResponse({
    enabled: Boolean(stored.enabled),
    digest: stored.digest || null,
    updatedAt: stored.updatedAt || ''
  }, { origin });
}

async function handleHoldingsRulePost(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: payload?.clientLabel
  });
  settings = auth.settings;

  if (auth.didUpdate) {
    await writeSettings(env, settings);
  }

  const enabled = Boolean(payload?.enabled);
  const digest = normalizeHoldingsDigest(payload?.digest);
  const updatedAt = new Date().toISOString();

  await writeJson(env, holdingsRuleKey(auth.clientId), {
    enabled,
    digest,
    updatedAt,
    clientLabel: auth.clientRecord?.clientLabel || ''
  });

  return jsonResponse({
    enabled,
    digest,
    updatedAt
  }, { origin });
}

async function fetchHoldingsNavSnapshots(env, codes = []) {
  const baseUrl = String(env?.PUBLIC_DATA_BASE_URL || 'https://tools.freebacktrack.tech').replace(/\/+$/, '');
  if (!codes.length) return {};

  const response = await fetch(`${baseUrl}/api/holdings/nav`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ codes })
  });
  if (!response.ok) {
    throw new Error(`拉取净值失败：状态 ${response.status}`);
  }
  const data = await response.json().catch(() => ({}));
  const list = Array.isArray(data?.snapshots) ? data.snapshots : [];
  const map = {};
  for (const snap of list) {
    const code = String(snap?.code || '').trim();
    if (!code) continue;
    map[code] = snap;
  }
  return map;
}

function computeWeightedReturn(bucket, snapshotsByCode, todayShanghai, kind = 'exchange') {
  // 返回 { ready, returnRate, contributors[] }。
  // ready=false 表示还有代码的 latestNavDate 未达预期最新日期，在调用方侧跳过。
  // 期望最新日期按 kind 计算：场内 = 当日；场外/QDII = 上一个交易日（周一为 T-3）。
  const expectedLatestNavDate = getExpectedLatestNavDate(kind, todayShanghai);
  let ready = true;
  const eligible = [];
  for (const entry of bucket) {
    const snap = snapshotsByCode[entry.code];
    const latestNav = Number(snap?.latestNav);
    const previousNav = Number(snap?.previousNav);
    const latestNavDate = String(snap?.latestNavDate || '');
    if (!Number.isFinite(latestNav) || !Number.isFinite(previousNav) || previousNav <= 0) {
      // 缺少净值或昨日净值 → 在加权中跳过，但如果是 latestNavDate 不达预期日期造成的，则整套跳过。
      if (!latestNavDate || latestNavDate < expectedLatestNavDate) ready = false;
      continue;
    }
    if (latestNavDate < expectedLatestNavDate || latestNavDate > todayShanghai) {
      ready = false;
      continue;
    }
    eligible.push({
      code: entry.code,
      weight: entry.weight,
      latestNav,
      previousNav,
      ratio: latestNav / previousNav - 1
    });
  }

  if (!ready || !eligible.length) {
    return { ready: false, returnRate: 0, contributors: eligible };
  }

  // 在 bucket 内 re-normalize（仅限于 eligible）。
  const totalWeight = eligible.reduce((sum, item) => sum + item.weight, 0);
  if (!(totalWeight > 0)) {
    return { ready: false, returnRate: 0, contributors: eligible };
  }
  const weightedReturn = eligible.reduce((sum, item) => sum + (item.weight / totalWeight) * item.ratio, 0);

  return {
    ready: true,
    returnRate: weightedReturn,
    contributors: eligible
      .map((item) => ({ ...item, contribution: (item.weight / totalWeight) * item.ratio }))
      .sort((a, b) => Math.abs(b.ratio) - Math.abs(a.ratio))
  };
}

function formatPercent(value) {
  const sign = value >= 0 ? '+' : '−';
  return `${sign}${Math.abs(value * 100).toFixed(2)}%`;
}

function buildHoldingsNotificationContent(kind, returnRate, contributors) {
  const kindLabel = kind === 'exchange' ? '场内' : '场外';
  const title = `[${kindLabel}] 当日收益 ${formatPercent(returnRate)}`;
  const top = contributors.slice(0, 3).map((item) => `${item.code} ${formatPercent(item.ratio)}`);
  const body = top.length
    ? `今日${kindLabel}加权收益率 ${formatPercent(returnRate)}；贡献 Top：${top.join('、')}。`
    : `今日${kindLabel}加权收益率 ${formatPercent(returnRate)}。`;
  return { title, body, summary: `${kindLabel}当日收益 ${formatPercent(returnRate)}` };
}

async function listHoldingsRuleEntries(env) {
  ensureStateBinding(env);
  const entries = [];
  let cursor;
  do {
    const result = await env.NOTIFY_STATE.list({ prefix: HOLDINGS_RULE_KEY_PREFIX, cursor });
    for (const item of result.keys || []) {
      const clientId = String(item.name || '').slice(HOLDINGS_RULE_KEY_PREFIX.length);
      if (!clientId) continue;
      entries.push({ clientId, key: item.name });
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  return entries;
}

async function runHoldingsNotifications(env, kind, todayShanghai, reason = 'holdings-scheduled') {
  if (kind !== 'exchange' && kind !== 'otc') return;

  const entries = await listHoldingsRuleEntries(env);
  if (!entries.length) return;

  let settings = await readSettings(env);
  let settingsDirty = false;

  for (const { clientId, key } of entries) {
    const stored = await readJson(env, key, null);
    if (!stored || !stored.enabled) continue;

    const dedupKey = holdingsDedupKey(clientId, kind, todayShanghai);
    const dedup = await readJson(env, dedupKey, null);
    if (dedup && dedup.status === 'sent') continue;

    const digest = normalizeHoldingsDigest(stored.digest);
    const bucket = digest[kind] || [];
    if (!bucket.length) continue;

    const codes = bucket.map((entry) => entry.code);
    let snapshotsByCode = {};
    try {
      snapshotsByCode = await fetchHoldingsNavSnapshots(env, codes);
    } catch (_error) {
      // 拉取失败，不写 dedup，下一个 cron 会重试。
      continue;
    }

    const computed = computeWeightedReturn(bucket, snapshotsByCode, todayShanghai, kind);
    if (!computed.ready) continue;

    const clientRecord = getClientRecord(settings, clientId, stored.clientLabel || '');
    if (!clientRecord) continue;

    const { title, body, summary } = buildHoldingsNotificationContent(kind, computed.returnRate, computed.contributors);
    const eventId = `holdings-${kind}-${todayShanghai}`;
    try {
      const result = await runClientDetection(env, settings, clientRecord, {
        reason,
        testPayload: {
          eventId,
          eventType: 'holdings-daily-return',
          title,
          body,
          summary,
          ruleId: `holdings-daily-${kind}`,
          symbol: kind === 'exchange' ? '场内总仓' : '场外总仓',
          strategyName: '持仓当日收益',
          triggerCondition: `${todayShanghai} ${kind}`,
          purchaseAmount: '',
          detailUrl: ''
        }
      });
      settings = result.settings;
      settingsDirty = true;

      await writeJson(env, dedupKey, {
        sentAt: new Date().toISOString(),
        status: 'sent',
        kind,
        date: todayShanghai
      });
      // KV TTL
      try {
        await env.NOTIFY_STATE.put(
          dedupKey,
          JSON.stringify({
            sentAt: new Date().toISOString(),
            status: 'sent',
            kind,
            date: todayShanghai
          }),
          { expirationTtl: HOLDINGS_DEDUP_TTL_SECONDS }
        );
      } catch (_error) {
        // TTL 写入失败不阻断主流程。
      }
    } catch (_error) {
      // 推送失败不写 dedup，等下个点重试。
    }
  }

  if (settingsDirty) {
    await writeSettings(env, settings);
  }
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

      if (request.method === 'POST' && url.pathname === '/api/notify/group/share-code') {
        return await handleNotifyGroupShareCode(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/group/join') {
        return await handleNotifyGroupJoin(request, env);
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

      if (request.method === 'GET' && url.pathname === '/api/notify/holdings-rule') {
        return await handleHoldingsRuleGet(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/holdings-rule') {
        return await handleHoldingsRulePost(request, env);
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

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runDetection(env, 'scheduled'));

    try {
      const scheduledMs = Number(controller?.scheduledTime) || Date.now();
      const { date: todayShanghai, hhmm } = getShanghaiDateParts(new Date(scheduledMs));
      if (hhmm === '15:30') {
        ctx.waitUntil(runHoldingsNotifications(env, 'exchange', todayShanghai, 'holdings-scheduled-1530'));
      } else if (hhmm === '20:30') {
        ctx.waitUntil(runHoldingsNotifications(env, 'otc', todayShanghai, 'holdings-scheduled-2030'));
      } else if (hhmm === '21:30') {
        ctx.waitUntil(runHoldingsNotifications(env, 'otc', todayShanghai, 'holdings-scheduled-2130'));
      }
    } catch (_error) {
      // 调度分发异常不能拖垮原有 runDetection。
    }
  }
};
