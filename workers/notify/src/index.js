import { evaluatePositionDigest, evaluateSellPlanSignals, evaluateVixSignal, runNotificationCycle } from './evaluator.js';
import { buildPublicGcmRegistration, buildPublicGcmRegistrations, checkGcmConnection, hasGcmServiceAccount, isRegistrationPairedToScope, maskSecret, normalizeGcmPairedClients, normalizeGcmRegistrations, normalizeNotifyGroupId, readGcmServiceAccount, resolveGcmProjectId } from './gcm.js';
import { compileNotifyRules, normalizeNotifyPayload } from './rules.js';
import { handleBark, isBarkRoute } from './bark.js';
import { WsHub, tryPublishWs } from './wsHub.js';
import { attachDeliveryAckToEvent, recordDeliveryAck } from './ack.js';

// 把 Durable Object 类型重新导出，让 Workers runtime 能在加载 wrangler 绑定时
// 通过 entry module 的导出表找到 class_name="WsHub"。
export { WsHub };
import {
  SWITCH_CONFIG_PREFIX,
  buildSwitchTriggerNotification,
  computeSwitchSnapshot,
  evaluateSwitchTriggers,
  isInTradingSession,
  isSwitchConfigRunnable,
  navCacheKey,
  normalizeSwitchConfig,
  refreshSnapshotWithLatestNav,
  switchConfigKey,
  switchSnapshotKey,
  switchStateKey,
  testGetNav513100
} from './switchStrategy.js';
import {
  fetchFundNavSnapshot,
  fetchLatestNavMapWithCache,
  fetchSinaPrices,
  getLatestNavWithCache
} from './getNav.js';

const SETTINGS_KEY = 'notify:settings';
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
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

async function trackAnalyticsEvent(env, type, meta = {}) {
  try {
    const endpoint = String(env?.ANALYTICS_ENDPOINT || 'https://tools.freebacktrack.tech/api/sync/analytics/track').trim();
    if (!endpoint || !type) return;
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: `worker:${type}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
        type,
        createdAt: new Date().toISOString(),
        date: new Date().toISOString().slice(0, 10),
        visitorId: String(meta.clientId || meta.reason || 'notify-worker'),
        sessionId: 'notify-worker',
        userId: '',
        username: '',
        path: '/api/notify/switch/run',
        meta
      })
    });
  } catch (_error) {
    // 统计失败不影响通知 Worker 主流程。
  }
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
      notifyGroupId: normalizeNotifyGroupId(client?.notifyGroupId || normalizedClientId) || normalizedClientId,
      clientSecretHash: String(client?.clientSecretHash || '').trim(),
      barkDeviceKey: String(client?.barkDeviceKey || '').trim(),
      payload: normalizeNotifyPayload(client?.payload || {}),
      state: {
        ruleStates: typeof client?.state?.ruleStates === 'object' && client.state.ruleStates ? client.state.ruleStates : {},
        deliveryFailures: typeof client?.state?.deliveryFailures === 'object' && client.state.deliveryFailures ? client.state.deliveryFailures : {},
        recentEvents: Array.isArray(client?.state?.recentEvents) ? client.state.recentEvents : [],
        deliveryAcks: typeof client?.state?.deliveryAcks === 'object' && client.state.deliveryAcks ? client.state.deliveryAcks : {},
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
    notifyGroupId: normalizeNotifyGroupId(normalizedClientId) || normalizedClientId,
    clientSecretHash: '',
    barkDeviceKey: '',
    payload: normalizeNotifyPayload({}),
    state: {
      ruleStates: {},
      deliveryFailures: {},
      recentEvents: [],
      deliveryAcks: {},
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
function getClientDeliveryAcks(clientRecord = {}) {
  return (typeof clientRecord?.state?.deliveryAcks === 'object' && clientRecord.state.deliveryAcks)
    ? clientRecord.state.deliveryAcks
    : {};
}

function attachClientDeliveryAcks(event = {}, clientRecord = {}) {
  return attachDeliveryAckToEvent(event, getClientDeliveryAcks(clientRecord));
}


function hasPcQueuedChannel(event = {}) {
  return Array.isArray(event?.channels)
    && event.channels.some((channel) => String(channel?.channel || '').trim() === 'pc'
      && String(channel?.status || '').trim() === 'queued');
}

function isSuccessfulEventChannel(channel = {}) {
  const status = String(channel?.status || '').trim();
  return status === 'delivered'
    || status === 'skipped'
    || (String(channel?.channel || '').trim() === 'pc' && status === 'queued');
}

function isPositiveEventChannel(channel = {}) {
  const status = String(channel?.status || '').trim();
  return status === 'delivered'
    || (String(channel?.channel || '').trim() === 'pc' && status === 'queued');
}

function shouldTreatEventAsDelivered(event = {}) {
  const channels = Array.isArray(event?.channels) ? event.channels : [];
  return channels.length > 0
    && channels.every(isSuccessfulEventChannel)
    && channels.some(isPositiveEventChannel);
}

function normalizeEventForClient(event = {}) {
  if (!event || String(event?.status || '').trim() === 'delivered') return event;
  return shouldTreatEventAsDelivered(event)
    ? { ...event, status: 'delivered' }
    : event;
}

function shouldExposeEventForClientPoll(event = {}) {
  if (!event) return false;
  if (String(event?.status || '').trim() !== 'delivered') return true;
  // PC 浏览器以 /events 轮询为投递通道；即使 overall status 已视为 delivered，
  // 仍需把包含 pc/queued channel 的事件返回给浏览器完成本地弹窗。
  return hasPcQueuedChannel(event);
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
    lastEvent: recentEvents[0] ? attachClientDeliveryAcks(recentEvents[0], clientRecord) : null,
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

async function handleAck(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const result = await recordDeliveryAck(env, payload, {
    requireToken: true,
    source: payload.source || 'http'
  });
  return jsonResponse(result, { origin });
}

async function handleEvents(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;

  if (auth.didUpdate) {
    await writeSettings(env, settings);
  }

  // 默认过滤后台已确认送达的事件；但 PC 浏览器通知依赖 /events 轮询，
  // 包含 pc/queued channel 的事件即使 overall status 视为 delivered，也要继续返回给浏览器本地弹窗。
  const pendingEvents = getClientRecentEvents(auth.clientRecord)
    .map((event) => attachClientDeliveryAcks(event, auth.clientRecord))
    .map(normalizeEventForClient)
    .filter(shouldExposeEventForClientPoll);

  return jsonResponse({
    events: pendingEvents
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

  // PR 2b尾巴：worker 侧 VIX 跨阈值推送。
  // rawPayload.vix 是客户端在 buildNotifySyncPayload() 中上传的 digest，
  // normalizeNotifyPayload 会把其过滤掉，所以这里从 raw 里拿。
  // 仅在区间变动时推送；same-level 且 24h 内不重推。
  try {
    env.__notifySettings = buildScopedNotifySettings(nextSettings, currentClientId);
    env.__notifyCurrentClientId = currentClientId;
    const vixStateKey = `vix-state:${currentClientId}`;
    await evaluateVixSignal(env, rawPayload?.vix, {
      clientId: currentClientId,
      settings: env.__notifySettings,
      readState: () => readJson(env, vixStateKey, null),
      writeState: (value) => writeJson(env, vixStateKey, value),
    });
  } catch (error) {
    // VIX 推送失败不应影响 sync 本身。
    console.error('[notify] evaluateVixSignal failed', error);
  }

  // PR 1.5尾巴：sell_layer 推送。rawPayload.sellPlans 是 client 传的快照（含 currentPrice）。
  try {
    const sellStateKey = `sell-plan-state:${currentClientId}`;
    await evaluateSellPlanSignals(env, rawPayload?.sellPlans, {
      clientId: currentClientId,
      settings: env.__notifySettings,
      readState: () => readJson(env, sellStateKey, null),
      writeState: (value) => writeJson(env, sellStateKey, value),
    });
  } catch (error) {
    console.error('[notify] evaluateSellPlanSignals failed', error);
  }

  // PR 4.5尾巴：position 推送。rawPayload.positionDigest 拼装在 client 侧。
  try {
    const posStateKey = `position-state:${currentClientId}`;
    await evaluatePositionDigest(env, rawPayload?.positionDigest, {
      clientId: currentClientId,
      settings: env.__notifySettings,
      readState: () => readJson(env, posStateKey, null),
      writeState: (value) => writeJson(env, posStateKey, value),
    });
  } catch (error) {
    console.error('[notify] evaluatePositionDigest failed', error);
  }

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
  const deviceInstallationId = normalizeDeviceInstallationId(
    payload.deviceInstallationId || payload.installationId || ''
  );
  const clientName = normalizeClientName(payload.clientName) || 'Web 控制台';
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: clientName
  });
  settings = auth.settings;
  const clientId = auth.clientId;
  const currentGroupId = resolveClientGroupId(settings, clientId, auth.clientRecord.clientLabel);

  if (!deviceInstallationId && !pairingCode) {
    throw new Error('缺少设备 ID 或配对码。');
  }

  // 优先使用设备 ID 直接定位；fallback 到配对码（向后兼容旧流程）。
  const selectedRegistration = deviceInstallationId
    ? findGcmRegistration(settings, { deviceInstallationId })
    : await findGcmRegistrationByPairingCode(settings, pairingCode);

  if (!selectedRegistration) {
    throw new Error(
      deviceInstallationId
        ? '未找到该设备 ID。请确认 Android app 已注册并且在线。'
        : '配对码无效或已过期，请回到 Android app 重新生成。'
    );
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

// Android-side unpair: the device authenticates itself via deviceInstallationId + token,
// and removes one or all paired browsers from its pairedClients list.
// Payload: { deviceInstallationId, token, groupId?, clientId?, registrationId? }
async function handleGcmUnpairFromDevice(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const deviceInstallationId = normalizeDeviceInstallationId(payload.deviceInstallationId || payload.installationId || '');
  const registrationId = String(payload.registrationId || '').trim();
  const token = String(payload.token || payload.registrationToken || '').trim();
  const groupId = normalizeNotifyGroupId(payload.groupId || '');
  const targetClientId = String(payload.clientId || payload.targetClientId || '').trim();

  if (!token) {
    throw new Error('解绑前端浏览器需要提供当前设备的 FCM token。');
  }
  if (!deviceInstallationId && !registrationId) {
    throw new Error('解绑前端浏览器需要 deviceInstallationId 或 registrationId。');
  }

  const settings = await readSettings(env);
  const selectedRegistration = findGcmRegistration(settings, {
    deviceInstallationId,
    registrationId,
    token
  });

  if (!selectedRegistration) {
    throw new Error('未找到当前 Android 设备的注册记录。');
  }

  if (String(selectedRegistration.token || '').trim() !== token) {
    throw new Error('Token 与注册记录不一致，无法解绑。');
  }

  let nextPairedClients;
  if (groupId) {
    nextPairedClients = removeGcmPairedGroup(selectedRegistration.pairedClients, groupId);
  } else if (targetClientId) {
    nextPairedClients = removeGcmPairedClient(selectedRegistration.pairedClients, targetClientId);
  } else {
    nextPairedClients = [];
  }

  const nowIso = new Date().toISOString();
  const nextRegistration = {
    ...selectedRegistration,
    pairedClients: nextPairedClients,
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
      includePairedClientIds: true
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

// Android-side device-id rotation: device authenticates with old deviceInstallationId + current
// FCM token, then atomically renames its KV registration record to the new deviceInstallationId.
// Preserves token / pairedClients / pairingCode* / projectId etc so paired browsers stay bound.
// If a stale registration already exists under the new id (e.g. orphaned from an earlier attempt),
// it is dropped to make room for the rename.
// Payload: { oldDeviceInstallationId, newDeviceInstallationId, token }
async function handleGcmResetDeviceId(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const oldDeviceInstallationId = normalizeDeviceInstallationId(
    payload.oldDeviceInstallationId || payload.deviceInstallationId || payload.installationId || ''
  );
  const newDeviceInstallationId = normalizeDeviceInstallationId(
    payload.newDeviceInstallationId || payload.nextDeviceInstallationId || ''
  );
  const token = String(payload.token || payload.registrationToken || '').trim();

  if (!token) {
    throw new Error('重置设备 ID 需要提供当前设备的 FCM token。');
  }
  if (!oldDeviceInstallationId) {
    throw new Error('重置设备 ID 需要提供旧的 deviceInstallationId。');
  }
  if (!newDeviceInstallationId) {
    throw new Error('重置设备 ID 需要提供新的 deviceInstallationId。');
  }
  if (oldDeviceInstallationId === newDeviceInstallationId) {
    throw new Error('新旧 deviceInstallationId 相同，无需重置。');
  }

  const settings = await readSettings(env);
  const selectedRegistration = findGcmRegistration(settings, {
    deviceInstallationId: oldDeviceInstallationId,
    token
  });

  requireAuthenticatedGcmRegistration(selectedRegistration, token);

  const nowIso = new Date().toISOString();
  const nextRegistration = {
    ...selectedRegistration,
    id: newDeviceInstallationId,
    deviceInstallationId: newDeviceInstallationId,
    updatedAt: nowIso
  };

  const existingRegistrations = Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations : [];
  const filteredRegistrations = existingRegistrations.filter((registration) => {
    const registrationId = normalizeDeviceInstallationId(registration.deviceInstallationId || registration.id);
    return registrationId !== oldDeviceInstallationId && registrationId !== newDeviceInstallationId;
  });
  const nextSettings = normalizeSettings({
    ...settings,
    gcmRegistrations: [...filteredRegistrations, nextRegistration]
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    registration: buildPublicGcmRegistration(nextRegistration, {
      includePairedClientIds: true
    })
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

function hasConfirmedPushDelivery(runResult = {}) {
  const channels = Array.isArray(runResult?.summary?.events?.[0]?.channels)
    ? runResult.summary.events[0].channels
    : [];
  return channels.some((channel) => {
    const channelName = String(channel?.channel || '').trim();
    const status = String(channel?.status || '').trim();
    return status === 'delivered' && (channelName === 'gcm' || channelName === 'bark');
  });
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
function isChinaMarketHoliday(dateStr) {
  // A 股休市（除周末外）——先用硬编码覆盖 2026 年已公告节假日。
  // 来源：上交所《2026 年部分节假日休市安排》公告。
  // https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml
  const d = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const y = d.slice(0, 4);
  if (y !== '2026') return false;

  // 闭市区间（闭区间）
  const ranges = [
    ['2026-01-01', '2026-01-03'],
    ['2026-02-15', '2026-02-23'],
    ['2026-04-04', '2026-04-06'],
    ['2026-05-01', '2026-05-05'],
    ['2026-06-19', '2026-06-21'],
    ['2026-09-25', '2026-09-27'],
    ['2026-10-01', '2026-10-07']
  ];

  for (const [start, end] of ranges) {
    if (d >= start && d <= end) return true;
  }
  return false;
}

function isWeekendShanghai(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map((s) => Number(s));
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  return dow === 0 || dow === 6;
}

function shiftShanghaiDate(dateStr, daysBack = 1) {
  const [y, m, d] = String(dateStr).split('-').map((s) => Number(s));
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - daysBack);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function getPreviousTradingDayShanghai(dateStr) {
  let cur = shiftShanghaiDate(dateStr, 1);
  // 最多回退 30 天，避免死循环。
  for (let i = 0; i < 30; i++) {
    if (!isWeekendShanghai(cur) && !isChinaMarketHoliday(cur)) return cur;
    cur = shiftShanghaiDate(cur, 1);
  }
  return cur;
}

function isTradingDayShanghai(dateStr) {
  return !isWeekendShanghai(dateStr) && !isChinaMarketHoliday(dateStr);
}

function getExpectedLatestNavDate(kind, todayShanghai) {
  const today = String(todayShanghai || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return todayShanghai;

  // 这里的 T 定义为“最近一个交易日”（如果今天不是交易日，就回退到最近交易日）。
  // 规则：
  //   - exchange / otc：预期 = T
  //   - qdii：预期 = T-1（即上一个交易日；若 T 为周一，则会自然回退到上周五，即 T-3）
  const T = isTradingDayShanghai(today) ? today : getPreviousTradingDayShanghai(today);

  // 场内 ETF + 境内场外：预期都是“今日（非交易日回退到上一个交易日）”。
  if (kind === 'exchange' || kind === 'otc') {
    return T;
  }

  // qdii：T+1 发布，预期 = T-1
  return getPreviousTradingDayShanghai(T);
}

function getTodayShanghaiDate() {
  try {
    return getShanghaiDateParts(new Date()).date;
  } catch (_error) {
    const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  }
}

/**
 * 统一的净值获取方法，可用于所有涉及净值的业务逻辑。
 * 
 * 支持 KV 缓存、自动判断A股vs美股、自动从源拉取并缓存。
 * 所有其他地方的净值查询都应通过这个方法。
 * 
 * @param {Object} env - Worker env (NOTIFY_STATE binding)
 * @param {string} code - 基金代码
 * @param {string} fundKind - 基金类型 ('exchange'|'otc'|'qdii'|'us-stock'，默认 'exchange')
 * @param {boolean} forceRefresh - 强制刷新，忽略缓存
 * @returns {Promise<Object|null>} { code, name, nav, latestNavDate } 或 null
 */
async function getLatestNav(env, code, fundKind = 'exchange', forceRefreshOrOptions = false) {
  if (!env || !env.NOTIFY_STATE) return null;

  const options = (forceRefreshOrOptions && typeof forceRefreshOrOptions === 'object')
    ? forceRefreshOrOptions
    : {};
  const forceRefresh = (forceRefreshOrOptions && typeof forceRefreshOrOptions === 'object')
    ? options.forceRefresh === true
    : forceRefreshOrOptions === true;
  const todayDate = options.todayDate || getTodayShanghaiDate();
  const readCache = async (key, fallback) => readJson(env, key, fallback);
  const writeCache = async (key, value) => writeJson(env, key, value);

  return getLatestNavWithCache(env, code, fundKind, {
    forceRefresh,
    todayDate,
    readCache,
    writeCache,
    getExpectedLatestNavDate
  });
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

  // 旧版 digest 可能携带 totals（marketValue / todayProfit / totalProfit / …）。
  // 出于隐私考虑现在统一丢弃：不透传到 KV，也不在推送里展示金额；worker 仅根据 code/weight 计算加权收益率百分比。

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
  let debug = null;
  try {
    await runHoldingsNotificationsAll(env, todayShanghai, 'admin-test-all', {
      onlyClientId,
      bypassDedup,
      totalsOverride,
      eventIdOverride
    });

    // debug: 复算一次门闸，定位是否会 skip(not ready / empty contributors / clientRecord missing)
    try {
      const stored = await readJson(env, holdingsRuleKey(onlyClientId), null);
      const digest = normalizeHoldingsDigest(stored?.digest);
      const exchangeBucket = digest.exchange || [];
      const otcBucket = digest.otc || [];
      const codes = [...exchangeBucket, ...otcBucket].map((entry) => entry.code);
      const bucketKindByCode = {};
      for (const e of exchangeBucket) bucketKindByCode[e.code] = 'exchange';
      for (const e of otcBucket) bucketKindByCode[e.code] = 'otc';

      let snapshotsByCode = {};
      try {
        snapshotsByCode = await fetchHoldingsNavSnapshots(env, codes, { bucketKindByCode, todayShanghai });
      } catch (_e) {
        snapshotsByCode = {};
      }

      const exchangeRes = await computeWeightedReturn(exchangeBucket, snapshotsByCode, todayShanghai, 'exchange', env);
      const otcRes = await computeWeightedReturn(otcBucket, snapshotsByCode, todayShanghai, 'otc', env);
      const exchangeReady = !exchangeBucket.length || exchangeRes.ready;
      const otcReady = !otcBucket.length || otcRes.ready;

      const perCode = [];
      for (const code of codes) {
        const bucketKind = bucketKindByCode[code] || (isExchangeLikeCode(code) ? 'exchange' : 'otc');
        const effectiveKind = await resolveHoldingKindAsync(code, bucketKind, env);
        const expected = getExpectedLatestNavDate(effectiveKind, todayShanghai);
        const snap = snapshotsByCode?.[code] || null;
        perCode.push({
          code,
          bucketKind,
          effectiveKind,
          expectedLatestNavDate: expected,
          latestNavDate: snap?.latestNavDate || '',
          ok: snap?.ok !== false,
          hasPrev: Number.isFinite(Number(snap?.previousNav))
        });
      }

      const allEligible = [
        ...(exchangeRes.contributors || []),
        ...(otcRes.contributors || [])
      ];
      const totalWeightAll = allEligible.reduce((sum, item) => sum + item.weight, 0);
      const wouldDispatch = exchangeReady && otcReady && allEligible.length > 0 && totalWeightAll > 0;
      debug = {
        hasStored: !!stored,
        enabled: stored?.enabled === true,
        exchangeCount: exchangeBucket.length,
        otcCount: otcBucket.length,
        snapshotCount: Object.keys(snapshotsByCode || {}).length,
        exchangeReady,
        otcReady,
        exchangeContribCount: exchangeRes.contributors?.length || 0,
        otcContribCount: otcRes.contributors?.length || 0,
        wouldDispatch,
        perCode
      };
    } catch (_e) {
      debug = { error: 'debug_failed' };
    }
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
    totalsOverride: totalsOverride ? Object.keys(totalsOverride) : null,
    debug
  }, { origin });
}

function isExchangeLikeCode(code) {
  // 场内 ETF / LOF / 封闭基金：都以 1 或 5 开头。
  return /^(1[5-9]|5\d)\d{4}$/.test(String(code || ''));
}

function isAfterShanghaiNavCacheCutoff() {
  // 返回当前上海时间是否 ≥ 15:30。场内 NAV 只在这个点之后才写缓存（避免缓存盘中报价）。
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
    const parts = fmt.formatToParts(new Date());
    const hh = Number(parts.find((p) => p.type === 'hour')?.value || '0');
    const mm = Number(parts.find((p) => p.type === 'minute')?.value || '0');
    return (hh * 60 + mm) >= (15 * 60 + 30);
  } catch (_e) {
    return false;
  }
}

/**
 * 拉取持仓收益计算用价格快照，双策略 KV 缓存 + service binding。
 *
 * 调用方传入 bucketKindByCode (code -> 'exchange'|'otc') 和 todayShanghai。
 * 本函数内部再通过 resolveHoldingKindAsync 区分 qdii。
 *
 * 口径：
 *   - exchange：场内基金/ETF 用交易所行情价（新浪 current/收盘价）与昨收价 preClose。
 *     不使用基金单位净值 NAV；字段仍命名 latestNav/previousNav 只是为了兼容既有计算函数。
 *   - otc / qdii：场外基金继续用单位净值 NAV。
 *
 * 读取逻辑：
 *   - exchange / otc / qdii：KV cached.latestNavDate ≥ expectedLatestNavDate → 用缓存，不上游。
 *   - 其他 → 列入 missing，exchange 走 Sina 行情，其余走 holdings/nav。
 *
 * 写入逻辑：fresh.latestNavDate > cached?.latestNavDate 才覆写（“拉到新价格/净值才更新”）。
 *   - exchange：还要求当前上海时间 ≥ 15:30，确保缓存的是收盘价。
 *   - otc / qdii：只要更新就写。
 */
async function fetchHoldingsNavSnapshots(env, codes = [], options = {}) {
  if (!codes.length) return {};
  const { bucketKindByCode = {}, todayShanghai = '' } = options;

  // 逐 code 解析 effective kind（exchange / otc / qdii）以决定缓存有效期。
  const kindByCode = {};
  for (const code of codes) {
    const bucketKind = bucketKindByCode[code] || (isExchangeLikeCode(code) ? 'exchange' : 'otc');
    kindByCode[code] = await resolveHoldingKindAsync(code, bucketKind, env);
  }

  // 并发读全部缓存。
  const cacheReads = await Promise.all(codes.map(async (code) => {
    try {
      const raw = await env?.NOTIFY_STATE?.get(`nav:${code}`);
      if (!raw) return [code, null];
      return [code, JSON.parse(raw)];
    } catch (_e) {
      return [code, null];
    }
  }));
  const cachedByCode = Object.fromEntries(cacheReads);

  // 决定哪些 code 需要拉新。
  const result = {};
  const missing = [];
  let exchangeHit = 0, exchangeMiss = 0, otcHit = 0, otcMiss = 0;
  for (const code of codes) {
    const cached = cachedByCode[code];
    const kind = kindByCode[code];
    let cacheValid = false;
    if (cached && Number.isFinite(Number(cached.latestNav)) && cached.latestNavDate) {
      if (todayShanghai) {
        const expected = getExpectedLatestNavDate(kind, todayShanghai);
        cacheValid = String(cached.latestNavDate) >= expected;
      } else if (kind === 'exchange') {
        // Without an execution date, keep the historical exchange-cache fallback.
        // Scheduled holdings jobs always pass todayShanghai and therefore require
        // same-trading-day cache freshness before skipping an upstream refresh.
        cacheValid = true;
      }
    }
    if (cacheValid) {
      result[code] = cached;
      if (kind === 'exchange') exchangeHit += 1; else otcHit += 1;
    } else {
      missing.push(code);
      if (kind === 'exchange') exchangeMiss += 1; else otcMiss += 1;
    }
  }

  console.log('[notify][nav][cache] read', JSON.stringify({
    total: codes.length,
    hit: codes.length - missing.length,
    miss: missing.length,
    exchangeHit, exchangeMiss, otcHit, otcMiss,
    missSample: missing.slice(0, 5)
  }));

  if (!missing.length) return result;

  const afterCacheCutoff = isAfterShanghaiNavCacheCutoff();
  const exchangeMissing = missing.filter((code) => kindByCode[code] === 'exchange');
  const navMissing = missing.filter((code) => kindByCode[code] !== 'exchange');
  const list = [];

  if (exchangeMissing.length) {
    try {
      const priceMap = await fetchSinaPrices(exchangeMissing);
      let priceCount = 0;
      for (const code of exchangeMissing) {
        const quote = priceMap?.[code];
        const latestPrice = Number(quote?.price);
        const previousPrice = Number(quote?.preClose);
        if (!Number.isFinite(latestPrice) || latestPrice <= 0 || !Number.isFinite(previousPrice) || previousPrice <= 0) {
          if (cachedByCode[code]) result[code] = cachedByCode[code];
          continue;
        }
        priceCount += 1;
        list.push({
          code,
          latestNav: latestPrice,
          latestNavDate: String(quote?.date || todayShanghai || '').trim(),
          previousNav: previousPrice,
          previousNavDate: '',
          source: 'sina-close-price',
          time: String(quote?.time || '').trim(),
          ok: true
        });
      }
      console.log('[notify][price] sina result', JSON.stringify({
        requested: exchangeMissing.length,
        priceCount,
        sample: exchangeMissing.slice(0, 5)
      }));
    } catch (priceErr) {
      console.log('[notify][price] sina fetch failed', JSON.stringify({
        message: priceErr?.message || String(priceErr),
        requested: exchangeMissing.length
      }));
      for (const code of exchangeMissing) {
        if (cachedByCode[code]) result[code] = cachedByCode[code];
      }
    }
  }

  if (navMissing.length) {
    const generatedAt = new Date().toISOString();
    const queue = [...navMissing];
    const results = [];
    const worker = async () => {
      while (queue.length) {
        const code = queue.shift();
        if (!code) continue;
        try {
          const snap = await fetchFundNavSnapshot(code, generatedAt);
          results.push(snap);
        } catch (fetchErr) {
          results.push({
            ok: false,
            code,
            error: fetchErr?.message || String(fetchErr),
            updatedAt: generatedAt
          });
        }
      }
    };
    const concurrency = Math.min(6, queue.length);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    list.push(...results);
  }

  let written = 0, skippedExchange = 0, skippedSameOrOlder = 0;

  for (const snap of list) {
    const code = String(snap?.code || '').trim();
    if (!code) continue;
    if (snap?.ok === false) {
      // 本次该 code 失败 → 回落旧缓存。
      if (cachedByCode[code]) result[code] = cachedByCode[code];
      continue;
    }
    result[code] = snap;

    const kind = kindByCode[code];
    const cached = cachedByCode[code];
    const freshDate = String(snap.latestNavDate || '');
    const cachedDate = String(cached?.latestNavDate || '');
    const isNewer = freshDate && (!cachedDate || freshDate > cachedDate);

    if (!isNewer) { skippedSameOrOlder += 1; continue; }

    if (kind === 'exchange' && !afterCacheCutoff) {
      skippedExchange += 1;
      continue;
    }

    try {
      await env?.NOTIFY_STATE?.put(`nav:${code}`, JSON.stringify(snap), { expirationTtl: 7 * 24 * 3600 });
      written += 1;
    } catch (kvErr) {
      console.log('[notify][nav][cache] write failed', JSON.stringify({
        code, message: kvErr?.message || String(kvErr)
      }));
    }
  }

  console.log('[notify][nav][cache] write summary', JSON.stringify({
    fetchedCount: list.length,
    written,
    skippedExchangeBeforeCutoff: skippedExchange,
    skippedSameOrOlder,
    afterCacheCutoff
  }));

  return result;
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
  // 出于隐私考虑：推送仅展示加权收益率，不再携带 ¥ 金额；具体金额请回网页查看。
  const body = top.length
    ? `今日${kindLabel}加权收益率 ${formatPercent(returnRate)}；贡献 Top：${top.join('、')}。详情请打开网页查看。`
    : `今日${kindLabel}加权收益率 ${formatPercent(returnRate)}。详情请打开网页查看。`;
  // Android 客户端 MarkdownRenderer 支持 **bold** / 列表 / 空行；这里给出更清晰的视觉层次。
  const topMdItems = contributors.slice(0, 3).map((item) => `- ${item.code} **${formatPercent(item.ratio)}**`);
  const bodyMdLines = [`**${kindLabel}加权收益率 ${formatPercent(returnRate)}**`];
  if (topMdItems.length) {
    bodyMdLines.push('', '贡献 Top：', ...topMdItems);
  }
  bodyMdLines.push('', '详情请打开网页查看。');
  const body_md = bodyMdLines.join('\n');
  return { title, body, summary: `${kindLabel}当日收益 ${formatPercent(returnRate)}`, body_md };
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
    const bucketKindByCode = Object.fromEntries(codes.map((c) => [c, kind]));
    let snapshotsByCode = {};
    try {
      snapshotsByCode = await fetchHoldingsNavSnapshots(env, codes, { bucketKindByCode, todayShanghai });
    } catch (_error) {
      // 拉取失败，不写 dedup，下一个 cron 会重试。
      continue;
    }

    const computed = await computeWeightedReturn(bucket, snapshotsByCode, todayShanghai, kind, env);
    if (!computed.ready) continue;

    const clientRecord = getClientRecord(settings, clientId, stored.clientLabel || '');
    if (!clientRecord) continue;

    const { title, body, summary, body_md } = buildHoldingsNotificationContent(kind, computed.returnRate, computed.contributors);
    const eventId = `holdings-${kind}-${todayShanghai}`;
    try {
      const result = await runClientDetection(env, settings, clientRecord, {
        reason,
        testPayload: {
          eventId,
          eventType: 'holdings-daily-return',
          title,
          body,
          body_md,
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

      if (hasConfirmedPushDelivery(result)) {
        const dedupPayload = {
          sentAt: new Date().toISOString(),
          status: 'sent',
          kind,
          date: todayShanghai
        };
        await writeJson(env, dedupKey, dedupPayload);
        // KV TTL
        try {
          await env.NOTIFY_STATE.put(
            dedupKey,
            JSON.stringify(dedupPayload),
            { expirationTtl: HOLDINGS_DEDUP_TTL_SECONDS }
          );
        } catch (_error) {
          // TTL 写入失败不阻断主流程。
        }
      } else {
        console.log('[notify][holdings] skip dedup: no confirmed push delivery', JSON.stringify({
          clientId,
          kind,
          date: todayShanghai,
          channels: (result?.summary?.events?.[0]?.channels || []).map((c) => ({ channel: c.channel, status: c.status }))
        }));
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
// 出于隐私考虑：不再展示任何 ¥ 金额（不论旧版 digest 是否携带 totals），
// 仅显示加权收益率百分比 + 贡献 Top；具体金额引导用户去网页查看。
// 第三个参数保留签名以兼容旧调用方，内部不再读取。
function buildHoldingsNotificationContentAll(returnRate, contributors, _totalsLegacy = null) {
  void _totalsLegacy;
  const dailyPct = formatPercent(returnRate);
  const top = (contributors || []).slice(0, 3).map((item) => `${item.code} ${formatPercent(item.ratio)}`);
  const title = `[持仓总览] 当日收益 ${dailyPct}`;
  const summary = `当日加权收益率 ${dailyPct}`;
  const body = top.length
    ? `今日加权收益率 ${dailyPct}；贡献 Top：${top.join('、')}。详情请打开网页查看。`
    : `今日加权收益率 ${dailyPct}。详情请打开网页查看。`;

  // Android 客户端 MarkdownRenderer 支持 **bold** / 列表 / 空行；这里给出更清晰的视觉层次。
  const topMdItems = (contributors || []).slice(0, 3).map((item) => `- ${item.code} **${formatPercent(item.ratio)}**`);
  const bodyMdLines = [`**当日加权收益率 ${dailyPct}**`];
  if (topMdItems.length) {
    bodyMdLines.push('', '贡献 Top：', ...topMdItems);
  }
  bodyMdLines.push('', '详情请打开网页查看。');
  const body_md = bodyMdLines.join('\n');

  return { title, body, summary, body_md };
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
    // 注：digest 不再包含 totals（金额字段），totalsOverride 选项保留签名但已被忽略，
    // 推送仅展示加权收益率百分比，金额请去网页查看。
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
    const bucketKindByCode = {};
    for (const e of exchangeBucket) bucketKindByCode[e.code] = 'exchange';
    for (const e of otcBucket) bucketKindByCode[e.code] = 'otc';
    let snapshotsByCode = {};
    try {
      snapshotsByCode = await fetchHoldingsNavSnapshots(env, codes, { bucketKindByCode, todayShanghai });
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

    const { title, body, summary, body_md } = buildHoldingsNotificationContentAll(
      dailyReturnRate,
      sortedContribs
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
          body_md,
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

      if (hasConfirmedPushDelivery(result)) {
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
      } else {
        console.log('[notify][holdings-all] skip dedup: no confirmed push delivery', JSON.stringify({
          clientId,
          date: todayShanghai,
          channels: (result?.summary?.events?.[0]?.channels || []).map((c) => ({ channel: c.channel, status: c.status }))
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
  return jsonResponse({
    error: '该接口已下线。'
  }, { status: 404, origin });
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
  let snapshot = await readSwitchSnapshotForClient(env, auth.clientId);
  const config = await readSwitchConfigForClient(env, auth.clientId);

  // 自动刷新净值：当 KV 里的 snapshot 是基于陈旧 NAV 算出时，直接补充最新净值，避免完整重算。
  // 背景：runSwitchStrategyTick 受 isInTradingSession 限制，仅在交易时段触发；
  //   而 GH Action 把 T 日 NAV 写入 data/<code>/latest-nav.json 的时间往往晚于收盘。
  //   收盘后用户进入「基金切换」，单靠 GET 不会触发重算。
  // 实现：
  //   - 防抖 1：snapshot.computedAt 距今 < 3 分钟 → 跳过（cron 或并发 GET 刚算过）。
  //   - 检测：用 benchmarkCodes[0] 作为探针，对比 latest-nav.json.latestNavDate 与 snapshot 里该 code 的 navDate；
  //     若线上更新，则直接用 refreshSnapshotWithLatestNav() 补充净值（无需重算价格等）。
  //   - 失败保护：补充异常不影响返回（继续返回旧 snapshot）。
  try {
    if (snapshot && config && isSwitchConfigRunnable({ ...config, enabled: true })) {
      const benchmarkCodes = Array.isArray(config.benchmarkCodes) ? config.benchmarkCodes : [];
      const probeCode = benchmarkCodes[0]
        || (Array.isArray(config.enabledCodes) ? config.enabledCodes[0] : null);
      if (probeCode) {
        const computedAtMs = snapshot?.computedAt ? Date.parse(snapshot.computedAt) : 0;
        const tooRecent = Number.isFinite(computedAtMs) && computedAtMs > 0
          && (Date.now() - computedAtMs) < 3 * 60 * 1000;
        if (!tooRecent) {
          // 从现有 snapshot 中提取基准净值日期
          let snapshotNavDate = '';
          if (snapshot) {
            const byBenchmark = Array.isArray(snapshot.byBenchmark) ? snapshot.byBenchmark : [];
            const benchEntry = byBenchmark.find((b) => b?.benchmarkCode === probeCode);
            if (benchEntry?.benchmarkNavDate) snapshotNavDate = String(benchEntry.benchmarkNavDate);
            if (!snapshotNavDate) {
              for (const b of byBenchmark) {
                const cand = (b?.candidates || []).find((c) => c?.code === probeCode);
                if (cand?.navDate) { snapshotNavDate = String(cand.navDate); break; }
              }
            }
          }
          // 检测是否有更新的净值（使用统一的 getLatestNav 方法，支持 KV 缓存）
          const latest = await getLatestNav(env, probeCode, 'exchange');
          const latestDate = String(latest?.latestNavDate || '');
          const stale = latestDate && (!snapshotNavDate || latestDate > snapshotNavDate);
          if (stale) {
            try {
              // 直接补充最新净值，而不是完整重算
              // 将 getLatestNav 函数传递给 refreshSnapshotWithLatestNav，使其支持 KV 缓存
              const refreshedSnapshot = await refreshSnapshotWithLatestNav(snapshot, env, getLatestNav);
              if (refreshedSnapshot) {
                snapshot = refreshedSnapshot;
                console.log('[notify] switch snapshot refreshed with latest nav', JSON.stringify({
                  clientId: auth.clientId.slice(0, 18),
                  probeCode,
                  latestDate,
                  prevSnapshotNavDate: snapshotNavDate
                }));
              }
            } catch (refreshErr) {
              console.warn('[notify] switch snapshot refresh failed, returning stale data:', String(refreshErr && refreshErr.message || refreshErr));
            }
          }
        }
      }
    }
  } catch (_error) {
    // 防御：自动刷新异常不影响正常返回。
    console.warn('[notify] switch snapshot auto-refresh exception:', _error);
  }

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
  // 「可计算」」vs「可运行」：这里只要有有效的 bench/cand/H-L 就允许计一次快照。
  // 未启用监控时 runSwitchStrategyForOneClient 会跳过 push，只刷新 snapshot/signals，
  // 这样 UI 能统一渲染 worker 计算的信号，不需要浏览器再独立算一份。
  if (!config || !isSwitchConfigRunnable({ ...config, enabled: true })) {
    return jsonResponse({
      ok: false,
      error: '当前没有可计算的「切换」配置：请先选择基准 ETF、候选 ETF，并在 H/L 两表里各有至少一只已分类。'
    }, { status: 400, origin });
  }
  const summary = await runSwitchStrategyForOneClient(env, auth.clientId, config, { reason: 'switch-manual-run' });
  await trackAnalyticsEvent(env, 'switch_worker_run', { clientId: auth.clientId, reason: 'switch-manual-run', triggered: summary?.triggered || 0, skipped: summary?.skipped || '' });
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
  
  // 使用统一的净值获取方法（支持 KV 缓存）
  const effectiveNavMap = navByCode || await fetchLatestNavMapWithCache(env, codes, [], {
    forceRefresh: false,
    todayDate: getTodayShanghaiDate(),
    readCache: async (key, fallback) => readJson(env, key, fallback),
    writeCache: async (key, value) => writeJson(env, key, value),
    getExpectedLatestNavDate
  });
  
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
  // 未启用自动监控时：只计快照不推送，让 UI 依然能看到 signals。
  for (const trigger of triggers) {
    if (!config.enabled) break;
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

async function handleSwitchTestNav(request, env) {
  const origin = readOrigin(request);
  try {
    const result = await testGetNav513100(env);
    return jsonResponse(result, { status: result.success ? 200 : 400, origin });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: String(error),
      timestamp: new Date().toISOString()
    }, { status: 500, origin });
  }
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
    fetchLatestNavMapWithCache(env, codeList, [], {
      forceRefresh: false,
      todayDate: getTodayShanghaiDate(),
      readCache: async (key, fallback) => readJson(env, key, fallback),
      writeCache: async (key, value) => writeJson(env, key, value),
      getExpectedLatestNavDate
    })
  ]);
  const computedAt = new Date(scheduledMs).toISOString();
  for (const { clientId, config } of enabledList) {
    try {
      const summary = await runSwitchStrategyForOneClient(env, clientId, config, {
        reason,
        priceMap,
        navByCode,
        computedAt
      });
      await trackAnalyticsEvent(env, 'switch_worker_run', { clientId, reason, triggered: summary?.triggered || 0, skipped: summary?.skipped || '' });
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

      if (request.method === 'POST' && url.pathname === '/api/notify/ack') {
        return await handleAck(request, env);
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
      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/unpair-from-device') {
        return await handleGcmUnpairFromDevice(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/reset-device-id') {
        return await handleGcmResetDeviceId(request, env);
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

      if (request.method === 'GET' && url.pathname === '/api/notify/switch/test-nav') {
        return await handleSwitchTestNav(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/health') {
        return jsonResponse({ ok: true }, { origin });
      }

      // 实时通道 WebSocket 升级：客户端在 Sec-WebSocket-Protocol 头里用
      // "jijin-token-<fcmToken>" 携带 token。验证后转发给该设备的 WsHub Durable Object。
      if (url.pathname.startsWith('/api/notify/ws/')) {
        const tail = url.pathname.slice('/api/notify/ws/'.length);
        const slashIdx = tail.indexOf('/');
        const deviceInstallationIdRaw = slashIdx === -1 ? tail : tail.slice(0, slashIdx);
        const subpath = slashIdx === -1 ? '' : tail.slice(slashIdx + 1);
        const deviceInstallationId = normalizeDeviceInstallationId(deviceInstallationIdRaw || '');

        if (!deviceInstallationId) {
          return jsonResponse({ ok: false, message: '缺少 deviceInstallationId。' }, { status: 400, origin });
        }

        // (a) Internal admin publish。仅服务仅有3 个调试点使用，需要 ADMIN_TEST_TOKEN。
        if (request.method === 'POST' && subpath === 'publish') {
          const expected = String((env && env.ADMIN_TEST_TOKEN) || '').trim();
          const auth = String(request.headers.get('authorization') || '').trim();
          const provided = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
          if (!expected || provided !== expected) {
            return jsonResponse({ ok: false, message: 'admin token mismatch' }, { status: 401, origin });
          }
          let body = {};
          try { body = await request.json(); } catch (_) { body = {}; }
          const result = await tryPublishWs(env, deviceInstallationId, body || {});
          return jsonResponse({ ok: !!(result && result.ok), result }, { origin });
        }

        // (b) WebSocket 升级。
        if (request.method === 'GET' && subpath === '') {
          if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') {
            return jsonResponse({ ok: false, message: 'expected websocket upgrade' }, { status: 426, origin });
          }
          const protoHeader = request.headers.get('sec-websocket-protocol') || '';
          const protocols = protoHeader.split(',').map((s) => s.trim()).filter(Boolean);
          const TOKEN_PREFIX = 'jijin-token-';
          const tokenProto = protocols.find((p) => p.startsWith(TOKEN_PREFIX)) || '';
          const token = tokenProto ? tokenProto.slice(TOKEN_PREFIX.length).trim() : '';
          if (!token) {
            return jsonResponse({ ok: false, message: '缺少 token 子协议。' }, { status: 401, origin });
          }
          const settings = await readSettings(env);
          const reg = findGcmRegistration(settings, { deviceInstallationId });
          if (!reg) {
            return jsonResponse({ ok: false, message: '未找到设备注册记录。' }, { status: 404, origin });
          }
          if (String(reg.token || '').trim() !== token) {
            return jsonResponse({ ok: false, message: 'token 与注册记录不一致。' }, { status: 401, origin });
          }
          // 验证通过，转发给 WsHub Durable Object，并把设备 ID 通过内部 header
          // 带给 DO，用于上线后自动 drain 该设备的离线队列。
          const id = env.WS_HUB.idFromName(deviceInstallationId);
          const stub = env.WS_HUB.get(id);
          const forwardedHeaders = new Headers(request.headers);
          forwardedHeaders.set('x-device-installation-id', deviceInstallationId);
          return await stub.fetch('https://ws-hub/connect', new Request(request, { headers: forwardedHeaders }));
        }

        return jsonResponse({ ok: false, message: 'invalid ws route' }, { status: 404, origin });
      }

      if ((request.method === 'GET' || request.method === 'POST') && isBarkRoute(url)) {
        return await handleBark(request, env, { jsonResponse, readSettings, readOrigin });
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
