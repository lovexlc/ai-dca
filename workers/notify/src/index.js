import { runNotificationCycle } from './evaluator.js';
import { buildPublicGcmRegistration, buildPublicGcmRegistrations, checkGcmConnection, hasGcmServiceAccount, isRegistrationPairedToScope, maskSecret, normalizeGcmPairedClients, normalizeGcmRegistrations, normalizeNotifyGroupId, readGcmServiceAccount, resolveGcmProjectId } from './gcm.js';
import { compileNotifyRules, normalizeNotifyPayload } from './rules.js';
import {
  SWITCH_CONFIG_PREFIX,
  buildSwitchTriggerNotification,
  computeSwitchSnapshot,
  evaluateSwitchTriggers,
  fetchLatestNavMap,
  fetchSinaPrices,
  isInTradingSession,
  isSwitchConfigRunnable,
  normalizeSwitchConfig,
  switchConfigKey,
  switchSnapshotKey,
  switchStateKey
} from './switchStrategy.js';

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
  console.log('[notify] runDetection enter', JSON.stringify({
    reason,
    clientId: options?.clientId || null
  }));
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
 * QDII 代码白名单（与前端 holdingsLedgerCore.js 保持一致）。
 * worker 拿不到基金名称，只能靠代码识别 QDII；后续如果 digest 上传了 name，可改用关键词匹配。
 * 并作为 `getFundType` 接口失败时的兑底。
 */
const HOLDINGS_QDII_CODE_SET = new Set([
  '021000', // 南方纳斯达克100指数发起(QDII)I
  '006075', // 博时标普500ETF联接(QDII)C
  '019172'  // 摩根纳斯达克100(QDII)人民币A
]);

/** 东财 F10 jbgk「基金类型」在 KV 里的缓存前缀。值为 JSON `{ type: string, ts: number }`。 */
const FUND_TYPE_KEY_PREFIX = 'fundtype:';
/** 成功调接口后缓存 30 天。基金类型几乎不变，不需要频繁刷新。 */
const FUND_TYPE_TTL_SECONDS = 30 * 24 * 3600;
/** 接口失败后的负缓存时间（1 小时），避免连续打接口。 */
const FUND_TYPE_NEG_TTL_SECONDS = 3600;

/**
 * 拉取并缓存某只基金在东财 F10 「基金基本概况」里的「基金类型」字段。返回如「指数型-海外股票」、
 * 「股票型-FOF」、「QDII-股票型」等。失败返空串。
 * worker 在 KV 中缓存 30 天，不会频繁调接口。
 */
async function getFundType(code, env) {
  const codeStr = String(code || '').trim();
  if (!codeStr) return '';
  if (!env || !env.NOTIFY_STATE) return '';
  const key = FUND_TYPE_KEY_PREFIX + codeStr;
  try {
    const raw = await env.NOTIFY_STATE.get(key);
    if (raw) {
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj.type === 'string') return obj.type;
      } catch (_e) {
        // 兼容旧格式：直接存了字符串。
        return raw;
      }
    }
  } catch (_e) {
    // KV 读失败，继续走接口。
  }

  let fundType = '';
  try {
    const url = 'https://fundf10.eastmoney.com/jbgk_' + codeStr + '.html';
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ai-dca-notify/1.0)',
        'Referer': 'https://fundf10.eastmoney.com/'
      },
      // Cloudflare edge cache 1 天，减少重复拉取。
      cf: { cacheTtl: 86400, cacheEverything: true }
    });
    if (resp && resp.ok) {
      const html = await resp.text();
      const match = html.match(/基金类型[^<]*<\/[^>]+>\s*<[^>]*>\s*([^<]+?)\s*</);
      if (match) fundType = match[1].trim();
    }
  } catch (_e) {
    // 接口失败，走负缓存。
  }

  try {
    await env.NOTIFY_STATE.put(
      key,
      JSON.stringify({ type: fundType, ts: Date.now() }),
      { expirationTtl: fundType ? FUND_TYPE_TTL_SECONDS : FUND_TYPE_NEG_TTL_SECONDS }
    );
  } catch (_e) {
    // 写缓存失败不阻断主流程。
  }

  return fundType;
}

/**
 * 返回单只基金的生效 kind。场内走 bucket；场外优先调 jbgk 接口看「基金类型」是否含
 * 「海外」或「QDII」，命中返 'qdii'；接口失败时回退到本地白名单。
 */
async function resolveHoldingKindAsync(code, bucketKind, env) {
  const codeStr = String(code || '');
  if (bucketKind === 'exchange') return 'exchange';
  const fundType = await getFundType(codeStr, env);
  if (fundType && /海外|QDII/i.test(fundType)) return 'qdii';
  if (!fundType && HOLDINGS_QDII_CODE_SET.has(codeStr)) return 'qdii';
  return bucketKind || 'otc';
}

/**
 * 按基金类型返回「今日预期的最新 NAV 日期」（与前端 holdingsLedgerCore.js 保持一致）。
 * - exchange（场内 ETF）：周一至周五 = 当日；周六/周日回退到周五。
 * - otc（境内场外）：T 日 NAV 在 T 日晚发布，预期 = 当日（周末回退到周五）。
 * - qdii（场外 QDII）：T+1 发布，预期 = 上一个工作日（周一 → 上周五 T-3）。
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
  // 场内 ETF + 境内场外：预期都是“今日（周末回退到周五）”。
  if (kind === 'exchange' || kind === 'otc') {
    if (dow === 0) return shift(2); // 周日 → 上周五
    if (dow === 6) return shift(1); // 周六 → 周五
    return todayShanghai;
  }
  // qdii：T+1 发布，取上一个工作日
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

  // 透传组合层面 totals（仅用于「全仓总览」推送展示金额）。
  // 仅记录组合维度的几个数字（总市值 / 总成本 / 昨日总市值 / 当日盈亏 / 累计盈亏 / 累计与当日收益率），
  // 不包含任何 per-fund 份额或单笔成本。
  if (digest.totals && typeof digest.totals === 'object') {
    const totals = {};
    for (const k of [
      'marketValue',
      'totalCost',
      'previousMarketValue',
      'totalProfit',
      'todayProfit',
      'totalReturnRate',
      'todayReturnRate'
    ]) {
      const v = Number(digest.totals[k]);
      if (Number.isFinite(v)) totals[k] = v;
    }
    if (Object.keys(totals).length) result.totals = totals;
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

// 管理员：手动触发「全仓总览」推送（可选跳过当日 dedup + 可选临时覆盖 totals）。
// 需要 ADMIN_TEST_TOKEN 匹配。主要用于上线后手动验证推送能走通。
async function handleAdminHoldingsAllTest(request, env) {
  const origin = readOrigin(request);
  const headerToken = request.headers.get('x-admin-token') || '';
  const expected = String(env?.ADMIN_TEST_TOKEN || '').trim();
  if (!expected || headerToken !== expected) {
    return jsonResponse({ error: 'forbidden' }, { status: 403, origin });
  }
  const payload = await request.json().catch(() => ({}));
  const onlyClientId = String(payload?.clientId || '').trim();
  if (!onlyClientId) {
    return jsonResponse({ error: 'clientId required' }, { status: 400, origin });
  }
  const bypassDedup = payload?.bypassDedup !== false; // 默认 true
  const totalsOverride = payload?.totalsOverride && typeof payload.totalsOverride === 'object'
    ? payload.totalsOverride
    : null;
  const eventIdOverride = String(payload?.eventIdOverride || '').trim() || null;
  const now = new Date();
  const todayShanghai = (payload?.todayShanghai && /^\d{4}-\d{2}-\d{2}$/.test(payload.todayShanghai))
    ? payload.todayShanghai
    : getShanghaiDateParts(now).date;
  console.log('[notify][admin-test-all] ENTER', JSON.stringify({
    onlyClientId,
    bypassDedup,
    eventIdOverride,
    todayShanghai,
    totalsKeys: totalsOverride ? Object.keys(totalsOverride) : null
  }));
  let runError = null;
  try {
    await runHoldingsNotificationsAll(env, todayShanghai, 'admin-test-all', {
      onlyClientId,
      bypassDedup,
      totalsOverride,
      eventIdOverride
    });
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    console.log('[notify][admin-test-all] THREW', JSON.stringify({ message: runError }));
  }
  console.log('[notify][admin-test-all] EXIT', JSON.stringify({ runError }));
  return jsonResponse({
    ok: !runError,
    runError,
    todayShanghai,
    onlyClientId,
    bypassDedup,
    eventIdOverride,
    totalsOverride: totalsOverride ? Object.keys(totalsOverride) : null
  }, { origin });
}

async function fetchHoldingsNavSnapshots(env, codes = []) {
  const baseUrl = String(env?.PUBLIC_DATA_BASE_URL || 'https://tools.freebacktrack.tech').replace(/\/+$/, '');
  if (!codes.length) return {};

  const url = `${baseUrl}/api/holdings/nav`;
  console.log('[notify][nav] fetch start', JSON.stringify({ url, codeCount: codes.length, codesSample: codes.slice(0, 3) }));
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ codes })
    });
  } catch (fetchErr) {
    console.log('[notify][nav] fetch threw', JSON.stringify({ message: fetchErr?.message || String(fetchErr), stack: fetchErr?.stack || '' }));
    throw new Error(`拉取净值失败：fetch threw ${fetchErr?.message || fetchErr}`);
  }
  const respHeaders = {};
  try {
    response.headers.forEach((v, k) => { respHeaders[k] = v; });
  } catch (_e) { /* ignore */ }
  const bodyText = await response.text().catch((e) => `__read_failed:${e?.message || e}`);
  console.log('[notify][nav] fetch result', JSON.stringify({
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    bodyLen: bodyText?.length || 0,
    bodyPreview: typeof bodyText === 'string' ? bodyText.slice(0, 400) : '',
    headerSubset: {
      'content-type': respHeaders['content-type'],
      'cf-ray': respHeaders['cf-ray'],
      'cf-worker': respHeaders['cf-worker'],
      'server': respHeaders['server'],
      'allow': respHeaders['allow']
    }
  }));
  if (!response.ok) {
    throw new Error(`拉取净值失败：状态 ${response.status}`);
  }
  let data = {};
  try { data = JSON.parse(bodyText); } catch (_e) { data = {}; }
  const list = Array.isArray(data?.snapshots) ? data.snapshots : [];
  const map = {};
  for (const snap of list) {
    const code = String(snap?.code || '').trim();
    if (!code) continue;
    map[code] = snap;
  }
  return map;
}

async function computeWeightedReturn(bucket, snapshotsByCode, todayShanghai, kind = 'exchange', env = null) {
  // 返回 { ready, returnRate, contributors[] }。
  // ready=false 表示还有代码的 latestNavDate 未达预期最新日期，在调用方侧跳过。
  // 期望最新日期按「单只」实际 kind 计算：
  //   exchange = 当日；otc（境内场外）= 当日（晚 21 点后才会刷）；qdii = 上一交易日（周一 T-3）。
  // bucket 仍是 exchange/otc 两档，但 otc bucket 里可能夹杂了 QDII，需要逐代码区分。
  let ready = true;
  const eligible = [];
  for (const entry of bucket) {
    const snap = snapshotsByCode[entry.code];
    const latestNav = Number(snap?.latestNav);
    const previousNav = Number(snap?.previousNav);
    const latestNavDate = String(snap?.latestNavDate || '');
    const effectiveKind = await resolveHoldingKindAsync(entry.code, kind, env);
    const expectedLatestNavDate = getExpectedLatestNavDate(effectiveKind, todayShanghai);
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
  console.log('[notify] runHoldingsNotifications enter', JSON.stringify({
    kind,
    todayShanghai,
    reason
  }));
  if (kind !== 'exchange' && kind !== 'otc') {
    console.log('[notify] runHoldingsNotifications skip: invalid kind', JSON.stringify({ kind }));
    return;
  }

  const entries = await listHoldingsRuleEntries(env);
  if (!entries.length) {
    console.log('[notify] runHoldingsNotifications skip: no entries', JSON.stringify({ kind, reason }));
    return;
  }
  console.log('[notify] runHoldingsNotifications loaded entries', JSON.stringify({
    kind,
    reason,
    count: entries.length
  }));

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

    const computed = await computeWeightedReturn(bucket, snapshotsByCode, todayShanghai, kind, env);
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

// 全仓总览（场内 + 场外合并）推送内容构造。
// totals 如果存在，推送里会同时显示 ¥ 金额；否则只显示百分比。
function buildHoldingsNotificationContentAll(returnRate, contributors, totals = null) {
  const dailyPct = formatPercent(returnRate);

  // 当日 ¥ 金额：优先用 totals.todayProfit；否则用 previousMarketValue × 加权收益率 估算。
  let dailyAmt = '';
  if (totals) {
    if (Number.isFinite(totals.todayProfit)) {
      const sign = totals.todayProfit >= 0 ? '+' : '−';
      dailyAmt = `${sign}¥${Math.abs(totals.todayProfit).toFixed(2)}`;
    } else if (Number.isFinite(totals.previousMarketValue) && totals.previousMarketValue > 0) {
      const profit = totals.previousMarketValue * returnRate;
      const sign = profit >= 0 ? '+' : '−';
      dailyAmt = `${sign}¥${Math.abs(profit).toFixed(2)}`;
    }
  }

  // 累计收益行：仅在 totals 提供了 totalProfit + totalReturnRate 时输出。
  // totalReturnRate 在前端已以「百分数值」存储（例如 2.72 表示 2.72%）。
  let totalLine = '';
  if (totals && Number.isFinite(totals.totalProfit) && Number.isFinite(totals.totalReturnRate)) {
    const sign = totals.totalProfit >= 0 ? '+' : '−';
    const rateSign = totals.totalReturnRate >= 0 ? '+' : '−';
    totalLine = `；总收益 ${sign}¥${Math.abs(totals.totalProfit).toFixed(2)} (${rateSign}${Math.abs(totals.totalReturnRate).toFixed(2)}%)`;
  }

  const top = (contributors || []).slice(0, 3).map((item) => `${item.code} ${formatPercent(item.ratio)}`);
  const titleAmt = dailyAmt ? `${dailyAmt} (${dailyPct})` : dailyPct;
  const title = `[持仓总览] 当日收益 ${titleAmt}`;
  const summary = `当日 ${titleAmt}${totalLine}`;
  const dailyText = dailyAmt ? `${dailyAmt} (${dailyPct})` : dailyPct;
  const body = top.length
    ? `今日加权收益率 ${dailyText}${totalLine}；贡献 Top：${top.join('、')}。`
    : `今日加权收益率 ${dailyText}${totalLine}。`;
  return { title, body, summary };
}

// 全仓总览推送（场内 + 场外合并，20:30 / 21:30 使用）。
// ready 门闸：场内容量、场外容量都必须「每只都刷出了应达日期」，任意一只未刷 → 跳过（等 21:30 兜底）。
async function runHoldingsNotificationsAll(env, todayShanghai, reason = 'holdings-scheduled-all', options = {}) {
  const onlyClientId = String(options?.onlyClientId || '').trim() || null;
  const bypassDedup = options?.bypassDedup === true;
  const totalsOverride = options?.totalsOverride && typeof options.totalsOverride === 'object'
    ? options.totalsOverride
    : null;
  const eventIdOverride = String(options?.eventIdOverride || '').trim() || null;
  console.log('[notify] runHoldingsNotificationsAll enter', JSON.stringify({
    todayShanghai,
    reason,
    onlyClientId,
    bypassDedup,
    eventIdOverride,
    totalsOverride: totalsOverride ? Object.keys(totalsOverride) : null
  }));

  const entries = await listHoldingsRuleEntries(env);
  if (!entries.length) {
    console.log('[notify] runHoldingsNotificationsAll skip: no entries', JSON.stringify({ reason }));
    return;
  }
  console.log('[notify] runHoldingsNotificationsAll loaded entries', JSON.stringify({
    reason,
    count: entries.length
  }));

  let settings = await readSettings(env);
  let settingsDirty = false;

  for (const { clientId, key } of entries) {
    if (onlyClientId && clientId !== onlyClientId) continue;
    const stored = await readJson(env, key, null);
    if (!stored || !stored.enabled) {
      console.log('[notify][holdings-all] skip: rule disabled or missing', JSON.stringify({ clientId, hasStored: !!stored, enabled: stored?.enabled === true }));
      continue;
    }

    const dedupKey = holdingsDedupKey(clientId, 'all', todayShanghai);
    if (!bypassDedup) {
      const dedup = await readJson(env, dedupKey, null);
      if (dedup && dedup.status === 'sent') {
        console.log('[notify][holdings-all] skip: dedup hit', JSON.stringify({ clientId, dedupKey, sentAt: dedup.sentAt }));
        continue;
      }
    }

    const digest = normalizeHoldingsDigest(stored.digest);
    if (totalsOverride) {
      // 管理员测试：临时覆盖 totals，以便在 digest 还未带 totals 时也能展示 ¥ 金额。
      const merged = { ...(digest.totals || {}) };
      for (const [k, v] of Object.entries(totalsOverride)) {
        const num = Number(v);
        if (Number.isFinite(num)) merged[k] = num;
      }
      if (Object.keys(merged).length) digest.totals = merged;
    }
    const exchangeBucket = digest.exchange || [];
    const otcBucket = digest.otc || [];
    console.log('[notify][holdings-all] digest', JSON.stringify({
      clientId,
      exchangeCount: exchangeBucket.length,
      otcCount: otcBucket.length,
      hasTotals: !!digest.totals
    }));
    if (!exchangeBucket.length && !otcBucket.length) {
      console.log('[notify][holdings-all] skip: empty digest', JSON.stringify({ clientId }));
      continue;
    }

    const codes = [...exchangeBucket, ...otcBucket].map((entry) => entry.code);
    let snapshotsByCode = {};
    try {
      snapshotsByCode = await fetchHoldingsNavSnapshots(env, codes);
    } catch (error) {
      // 拉取失败，不写 dedup，下个 cron 会重试。
      console.log('[notify][holdings-all] skip: nav fetch failed', JSON.stringify({
        clientId,
        message: error instanceof Error ? error.message : String(error)
      }));
      continue;
    }
    console.log('[notify][holdings-all] nav snapshots', JSON.stringify({
      clientId,
      codeCount: codes.length,
      snapshotCount: Object.keys(snapshotsByCode).length
    }));

    const exchangeRes = await computeWeightedReturn(
      exchangeBucket,
      snapshotsByCode,
      todayShanghai,
      'exchange',
      env
    );
    const otcRes = await computeWeightedReturn(
      otcBucket,
      snapshotsByCode,
      todayShanghai,
      'otc',
      env
    );
    const exchangeReady = !exchangeBucket.length || exchangeRes.ready;
    const otcReady = !otcBucket.length || otcRes.ready;
    if (!exchangeReady || !otcReady) {
      console.log('[notify] runHoldingsNotificationsAll skip: not ready', JSON.stringify({
        clientId,
        exchangeReady,
        otcReady,
        exchangeContribCount: exchangeRes.contributors?.length || 0,
        otcContribCount: otcRes.contributors?.length || 0
      }));
      continue;
    }

    // 上传时 weight 是「本只市值 / 全仓总市值」，两个 bucket 合起来 ≈ 1。
    // 这里用原始 weight 在全集上重新 normalize（实际上则 ≈ weight 本身）。
    const allEligible = [
      ...(exchangeRes.contributors || []),
      ...(otcRes.contributors || [])
    ];
    if (!allEligible.length) continue;
    const totalWeightAll = allEligible.reduce((sum, item) => sum + item.weight, 0);
    if (!(totalWeightAll > 0)) continue;
    const dailyReturnRate = allEligible.reduce(
      (sum, item) => sum + (item.weight / totalWeightAll) * item.ratio,
      0
    );
    const sortedContribs = allEligible
      .map((item) => ({
        ...item,
        contribution: (item.weight / totalWeightAll) * item.ratio
      }))
      .sort((a, b) => Math.abs(b.ratio) - Math.abs(a.ratio));

    const totals = digest.totals || null;
    const { title, body, summary } = buildHoldingsNotificationContentAll(
      dailyReturnRate,
      sortedContribs,
      totals
    );

    const clientRecord = getClientRecord(settings, clientId, stored.clientLabel || '');
    if (!clientRecord) {
      console.log('[notify][holdings-all] skip: clientRecord missing', JSON.stringify({ clientId }));
      continue;
    }

    const eventId = eventIdOverride || `holdings-all-${todayShanghai}`;
    console.log('[notify][holdings-all] dispatching', JSON.stringify({
      clientId,
      eventId,
      contribCount: allEligible.length,
      dailyReturnRate
    }));
    try {
      const result = await runClientDetection(env, settings, clientRecord, {
        reason,
        testPayload: {
          eventId,
          eventType: 'holdings-daily-return',
          title,
          body,
          summary,
          ruleId: 'holdings-daily-all',
          symbol: '持仓总览',
          strategyName: '持仓当日收益',
          triggerCondition: `${todayShanghai} all`,
          purchaseAmount: '',
          detailUrl: ''
        }
      });
      settings = result.settings;
      settingsDirty = true;
      console.log('[notify][holdings-all] dispatched OK', JSON.stringify({
        clientId,
        eventId,
        deliveredCount: result?.summary?.deliveredCount,
        channels: (result?.summary?.events?.[0]?.channels || []).map((c) => ({
          channel: c.channel,
          status: c.status,
          detail: c.detail,
          configLabel: c.configLabel
        }))
      }));

      const dedupPayload = {
        sentAt: new Date().toISOString(),
        status: 'sent',
        kind: 'all',
        date: todayShanghai
      };
      await writeJson(env, dedupKey, dedupPayload);
      try {
        await env.NOTIFY_STATE.put(
          dedupKey,
          JSON.stringify(dedupPayload),
          { expirationTtl: HOLDINGS_DEDUP_TTL_SECONDS }
        );
      } catch (error) {
        // TTL 写入失败不阻断主流程。
        console.log('[notify][holdings-all] dedup ttl write failed (non-fatal)', JSON.stringify({
          clientId,
          message: error instanceof Error ? error.message : String(error)
        }));
      }
    } catch (error) {
      // 推送失败不写 dedup，等下个点重试。
      console.log('[notify][holdings-all] dispatch THREW', JSON.stringify({
        clientId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null
      }));
    }
  }

  if (settingsDirty) {
    await writeSettings(env, settings);
  }
}

// ---------------------------------------------------------------------------
// 场内切换策略
// 前端在「交易计划中心 / 切换」tab 配置基准 + 候选 + 阈值后 POST 到 KV，
// Cron Trigger（A 股交易时段每分钟）扫描所有 client 的配置：
// 1. 拉取实时盘中价（新浪 hq.sinajs.cn）
// 2. 拉取最新单位净值（PUBLIC_DATA_BASE_URL/data/<code>/latest-nav.json）
// 3. 计算 (price - nav) / nav 溢价 %
// 4. 「基准 - 候选」溢价差跨越任一阈值（1% / 8% 等）→ 推送到该 client 已配对的设备
// 去重：(基准, 候选) 对维护 (level, sign)，level 升档或方向翻转才推送一次。
// ---------------------------------------------------------------------------

async function readSwitchConfigForClient(env, clientId) {
  const stored = await readJson(env, switchConfigKey(clientId), null);
  return stored ? normalizeSwitchConfig(stored) : null;
}

async function writeSwitchConfigForClient(env, clientId, config) {
  const normalized = normalizeSwitchConfig({
    ...config,
    updatedAt: new Date().toISOString()
  });
  await writeJson(env, switchConfigKey(clientId), normalized);
  return normalized;
}

async function readSwitchSnapshotForClient(env, clientId) {
  return await readJson(env, switchSnapshotKey(clientId), null);
}

async function listSwitchClientIds(env) {
  ensureStateBinding(env);
  const ids = [];
  let cursor;
  do {
    const result = await env.NOTIFY_STATE.list({ prefix: SWITCH_CONFIG_PREFIX, cursor });
    for (const item of result.keys || []) {
      const clientId = String(item.name || '').slice(SWITCH_CONFIG_PREFIX.length);
      if (clientId) ids.push(clientId);
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  return ids;
}

async function handleSwitchConfigGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await readSwitchConfigForClient(env, auth.clientId);
  return jsonResponse({
    ok: true,
    clientId: auth.clientId,
    config: config || normalizeSwitchConfig({ enabled: false })
  }, { origin });
}

// 清理该 clientId 的切换策略 config/snapshot/state 三个 KV 键，避免旧 benchmark 污染。
async function handleSwitchConfigDelete(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  ensureStateBinding(env);
  const clientId = auth.clientId;
  const keys = [
    switchConfigKey(clientId),
    switchSnapshotKey(clientId),
    switchStateKey(clientId)
  ];
  const cleared = [];
  for (const key of keys) {
    try {
      const existed = (await env.NOTIFY_STATE.get(key)) != null;
      await env.NOTIFY_STATE.delete(key);
      if (existed) cleared.push(key);
    } catch (_e) {
      // 单个键删除失败不阐断全部。
    }
  }
  return jsonResponse({
    ok: true,
    clientId,
    clearedKeys: cleared,
    examinedKeys: keys
  }, { origin });
}

async function handleSwitchConfigPost(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '')
  });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const nextConfig = await writeSwitchConfigForClient(env, auth.clientId, {
    enabled: payload?.enabled,
    benchmarkCodes: Array.isArray(payload?.benchmarkCodes)
      ? payload.benchmarkCodes
      : (payload?.benchmarkCode ? [payload.benchmarkCode] : []),
    enabledCodes: payload?.enabledCodes ?? payload?.candidateCodes,
    premiumClass: payload?.premiumClass,
    intraSellLowerPct: payload?.intraSellLowerPct,
    intraBuyOtherPct: payload?.intraBuyOtherPct,
    clientLabel: auth.clientRecord?.clientLabel || ''
  });
  return jsonResponse({ ok: true, config: nextConfig }, { origin });
}

async function handleSwitchSnapshotGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const snapshot = await readSwitchSnapshotForClient(env, auth.clientId);
  const config = await readSwitchConfigForClient(env, auth.clientId);
  return jsonResponse({
    ok: true,
    snapshot,
    config: config || normalizeSwitchConfig({ enabled: false })
  }, { origin });
}

async function handleSwitchRunPost(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await readSwitchConfigForClient(env, auth.clientId);
  if (!config || !isSwitchConfigRunnable(config)) {
    return jsonResponse({
      ok: false,
      error: '当前没有可运行的「切换」配置：请先选择基准 ETF、候选 ETF 并启用监控。'
    }, { status: 400, origin });
  }
  const summary = await runSwitchStrategyForOneClient(env, auth.clientId, config, { reason: 'switch-manual-run' });
  const snapshot = await readSwitchSnapshotForClient(env, auth.clientId);
  return jsonResponse({ ok: true, summary, snapshot }, { origin });
}

async function runSwitchStrategyForOneClient(env, clientId, config, { reason = 'switch-strategy', priceMap = null, navByCode = null, computedAt = '' } = {}) {
  let settings = await readSettings(env);
  const clientRecord = getClientRecord(settings, clientId);
  if (!clientRecord || !clientRecord.clientId) {
    return { triggered: 0, skipped: 'no-client' };
  }
  const codes = Array.from(new Set([
    ...(Array.isArray(config.benchmarkCodes) ? config.benchmarkCodes : []),
    ...(config.enabledCodes || [])
  ]));
  const effectivePriceMap = priceMap || await fetchSinaPrices(codes).catch(() => ({}));
  const effectiveNavMap = navByCode || await fetchLatestNavMap(env, codes);
  const computedAtIso = computedAt || new Date().toISOString();
  const snapshot = computeSwitchSnapshot(config, effectivePriceMap, effectiveNavMap, computedAtIso);
  const prevState = (await readJson(env, switchStateKey(clientId), null)) || {};
  const { triggers, nextTriggerStates } = evaluateSwitchTriggers(snapshot, prevState.triggerStates || {});
  snapshot.triggers = triggers;
  await writeJson(env, switchSnapshotKey(clientId), snapshot);
  await writeJson(env, switchStateKey(clientId), {
    triggerStates: nextTriggerStates,
    updatedAt: snapshot.computedAt
  });
  let pushedCount = 0;
  for (const trigger of triggers) {
    const testPayload = buildSwitchTriggerNotification(snapshot, trigger, env);
    try {
      const result = await runClientDetection(env, settings, clientRecord, {
        reason,
        testPayload
      });
      settings = result.settings;
      pushedCount += 1;
    } catch (_error) {
      // 忽略单条失败：下一分钟若仍处触发态会再尝试推送
    }
  }
  if (pushedCount) {
    await writeSettings(env, settings);
  }
  return {
    triggered: triggers.length,
    pushed: pushedCount,
    candidateCount: (snapshot.byBenchmark || [])
      .reduce((acc, b) => acc + ((b.candidates || []).length), 0),
    ready: snapshot.ready
  };
}

async function runSwitchStrategyTick(env, scheduledMs, reason = 'switch-cron') {
  const scheduledIso = new Date(scheduledMs).toISOString();
  console.log('[notify] runSwitchStrategyTick enter', JSON.stringify({
    reason,
    scheduledMs,
    scheduledIso
  }));
  // 双保险：crontab 用 UTC，时间窗口可能宽于实际交易时段；这里再卡一次北京时间。
  if (!isInTradingSession(new Date(scheduledMs))) {
    console.log('[notify] runSwitchStrategyTick skip: outside trading session', JSON.stringify({
      reason,
      scheduledIso
    }));
    return;
  }
  const clientIds = await listSwitchClientIds(env);
  if (!clientIds.length) {
    console.log('[notify] runSwitchStrategyTick skip: no switch clients', JSON.stringify({ reason }));
    return;
  }
  const enabledList = [];
  for (const clientId of clientIds) {
    const config = await readSwitchConfigForClient(env, clientId);
    if (config && isSwitchConfigRunnable(config)) {
      enabledList.push({ clientId, config });
    }
  }
  if (!enabledList.length) return;
  const allCodes = new Set();
  for (const { config } of enabledList) {
    for (const code of (config.benchmarkCodes || [])) allCodes.add(code);
    for (const code of (config.enabledCodes || [])) allCodes.add(code);
  }
  const codeList = Array.from(allCodes);
  const [priceMap, navByCode] = await Promise.all([
    fetchSinaPrices(codeList).catch(() => ({})),
    fetchLatestNavMap(env, codeList)
  ]);
  const computedAt = new Date(scheduledMs).toISOString();
  for (const { clientId, config } of enabledList) {
    try {
      await runSwitchStrategyForOneClient(env, clientId, config, {
        reason,
        priceMap,
        navByCode,
        computedAt
      });
    } catch (_error) {
      // 单个 client 失败不阻断整轮
    }
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

      if (request.method === 'POST' && url.pathname === '/api/notify/admin/holdings-all-test') {
        return await handleAdminHoldingsAllTest(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/switch/config') {
        return await handleSwitchConfigGet(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/switch/config') {
        return await handleSwitchConfigPost(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/switch/snapshot') {
        return await handleSwitchSnapshotGet(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/switch/run') {
        return await handleSwitchRunPost(request, env);
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
    const scheduledMs = Number(controller?.scheduledTime) || Date.now();
    const cron = String(controller?.cron || '').trim();
    let shanghaiHHMM = '';
    let shanghaiDate = '';
    try {
      const parts = getShanghaiDateParts(new Date(scheduledMs));
      shanghaiDate = parts.date;
      shanghaiHHMM = parts.hhmm;
    } catch (_error) {
      // 安全兜底，不能影响入口日志本身。
    }
    console.log('[notify] scheduled tick', JSON.stringify({
      cron,
      scheduledMs,
      scheduledIso: new Date(scheduledMs).toISOString(),
      shanghaiDate,
      shanghaiHHMM
    }));
    // 「场内切换」专用分钟级 cron（仅 A 股交易时段）。接下来在函数内部还会再卡一道
    // isInTradingSession，双保险；指定这个 cron 的调度下不运行 runDetection / holdings。
    if (cron === '* 1-7 * * MON-FRI') {
      console.log('[notify] scheduled dispatch -> runSwitchStrategyTick', JSON.stringify({ cron }));
      ctx.waitUntil(runSwitchStrategyTick(env, scheduledMs, 'switch-cron'));
      return;
    }

    console.log('[notify] scheduled dispatch -> runDetection', JSON.stringify({ cron }));
    ctx.waitUntil(runDetection(env, 'scheduled'));

    try {
      const todayShanghai = shanghaiDate || getShanghaiDateParts(new Date(scheduledMs)).date;
      const hhmm = shanghaiHHMM || getShanghaiDateParts(new Date(scheduledMs)).hhmm;
      if (hhmm === '15:30') {
        console.log('[notify] scheduled dispatch -> runHoldingsNotifications', JSON.stringify({ kind: 'exchange', hhmm, todayShanghai }));
        ctx.waitUntil(runHoldingsNotifications(env, 'exchange', todayShanghai, 'holdings-scheduled-1530'));
      } else if (hhmm === '20:30') {
        console.log('[notify] scheduled dispatch -> runHoldingsNotifications', JSON.stringify({ kind: 'otc', hhmm, todayShanghai }));
        ctx.waitUntil(runHoldingsNotificationsAll(env, todayShanghai, 'holdings-scheduled-2030'));
      } else if (hhmm === '21:30') {
        console.log('[notify] scheduled dispatch -> runHoldingsNotifications', JSON.stringify({ kind: 'otc', hhmm, todayShanghai }));
        ctx.waitUntil(runHoldingsNotificationsAll(env, todayShanghai, 'holdings-scheduled-2130'));
      } else if (hhmm === '23:35') {
        // 临时测试分支：晚 23:35 手动验证全仓总览推送，bypass dedup 以允许同一天重复发送。
        // 验证完成后移除本分支 与 wrangler.toml 中的 "35 15 * * *" cron。
        // eventIdOverride 带上分钟时间戳，避免与同一天其他推送（如 admin 测试）的 eventId 撞车
        // 导致 FCM/iOS 在设备端被去重咽住。
        console.log('[notify] scheduled dispatch -> runHoldingsNotificationsAll (test 23:35)', JSON.stringify({ hhmm, todayShanghai }));
        ctx.waitUntil(runHoldingsNotificationsAll(env, todayShanghai, 'holdings-test-2335', {
          bypassDedup: true,
          eventIdOverride: `holdings-all-test-${todayShanghai}-${Date.now()}`
        }));
      } else {
        console.log('[notify] scheduled holdings dispatch skipped', JSON.stringify({ hhmm, todayShanghai }));
      }
    } catch (error) {
      console.log('[notify] scheduled dispatch error', JSON.stringify({
        cron,
        message: error instanceof Error ? error.message : String(error)
      }));
      // 调度分发异常不能拖垮原有 runDetection。
    }
  }
};
