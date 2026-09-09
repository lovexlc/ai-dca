import { normalizeNotifyGroupId, normalizeGcmRegistrations } from './gcm.js';
import { normalizeServerChan3Config } from './channels/serverChan3.js';
import { normalizeNotifyPayload } from './rules.js';
import { normalizeNotifyAccountUsername } from './notifyAccount.js';
import {
  VERIFIED_NOTIFY_USER_ID_HEADER,
  VERIFIED_NOTIFY_USERNAME_HEADER
} from './notifyAccountAuth.js';

export const CLIENT_SECRET_HEADER = 'x-notify-client-secret';
export const CLIENT_ACCOUNT_USERNAME_HEADER = 'x-notify-account-username';
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class NotifyClientError extends Error {
  constructor(message, status = 400, code = '') {
    super(message);
    this.name = 'NotifyClientError';
    this.status = status;
    this.code = String(code || '');
  }
}

export function normalizeNotifyUserId(value = '') {
  return String(value || '').trim().replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 96);
}

export function buildAccountClientId(userId = '') {
  const normalizedUserId = normalizeNotifyUserId(userId);
  return normalizedUserId ? normalizeClientId(`account:${normalizedUserId}`) : '';
}

export function normalizeSettings(settings = {}) {
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
  const gcmRegistrations = normalizeGcmRegistrations(settings.gcmRegistrations).filter((registration) => registration.isWebClient);
  const clients = Object.entries(rawClients).reduce((map, [clientId, client]) => {
    const normalizedClientId = normalizeClientId(client?.clientId || clientId);

    if (!normalizedClientId) {
      return map;
    }

    map[normalizedClientId] = {
      clientId: normalizedClientId,
      clientLabel: normalizeClientName(client?.clientLabel || client?.notifyClientLabel || client?.clientName || ''),
      accountUsername: normalizeNotifyAccountUsername(client?.accountUsername || client?.username || ''),
      ownerUserId: normalizeNotifyUserId(client?.ownerUserId || ''),
      accountClientId: normalizeClientId(client?.accountClientId || ''),
      isDeviceOnly: Boolean(client?.isDeviceOnly),
      notifyGroupId: normalizeNotifyGroupId(client?.notifyGroupId || normalizedClientId) || normalizedClientId,
      clientSecretHash: String(client?.clientSecretHash || '').trim(),
      barkDeviceKey: String(client?.barkDeviceKey || '').trim(),
      serverChan3: normalizeServerChan3Config(client?.serverChan3 || {}),
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
    gcmRegistrations
  };
}

export function buildDefaultClientRecord(clientId = '', clientLabel = '') {
  const normalizedClientId = normalizeClientId(clientId);
  return {
    clientId: normalizedClientId,
    clientLabel: normalizeClientName(clientLabel),
    accountUsername: '',
    ownerUserId: '',
    accountClientId: '',
    isDeviceOnly: false,
    notifyGroupId: normalizeNotifyGroupId(normalizedClientId) || normalizedClientId,
    clientSecretHash: '',
    barkDeviceKey: '',
    serverChan3: normalizeServerChan3Config({}),
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

export function getClientRecord(settings, clientId = '', clientLabel = '') {
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

export function upsertClientRecord(settings, clientId = '', patch = {}) {
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
    accountUsername: normalizeNotifyAccountUsername(patch.accountUsername ?? current.accountUsername ?? ''),
    ownerUserId: normalizeNotifyUserId(patch.ownerUserId ?? current.ownerUserId ?? ''),
    accountClientId: normalizeClientId(patch.accountClientId ?? current.accountClientId ?? ''),
    isDeviceOnly: Boolean(patch.isDeviceOnly ?? current.isDeviceOnly),
    notifyGroupId: normalizeNotifyGroupId(patch.notifyGroupId ?? current.notifyGroupId ?? normalizedClientId) || normalizedClientId,
    clientSecretHash: String(patch.clientSecretHash ?? current.clientSecretHash ?? '').trim(),
    barkDeviceKey: String(patch.barkDeviceKey ?? current.barkDeviceKey ?? '').trim(),
    serverChan3: normalizeServerChan3Config(patch.serverChan3 ?? current.serverChan3 ?? {}),
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

export function buildScopedNotifySettings(settings, clientId = '') {
  const clientRecord = getClientRecord(settings, clientId);

  return {
    ...settings,
    barkDeviceKey: clientRecord.barkDeviceKey,
    serverChan3: clientRecord.serverChan3,
    clientId: clientRecord.clientId,
    clientLabel: clientRecord.clientLabel,
    accountUsername: clientRecord.accountUsername,
    ownerUserId: clientRecord.ownerUserId,
    notifyGroupId: clientRecord.notifyGroupId
  };
}

export function normalizeClientId(value = '') {
  return String(value || '').trim().slice(0, 120);
}

export function normalizeClientName(value = '') {
  return String(value || '').trim().slice(0, 120);
}

export { normalizeNotifyAccountUsername };

export function normalizeClientSecret(value = '') {
  return String(value || '').trim().slice(0, 240);
}

export function normalizeDeviceInstallationId(value = '') {
  return String(value || '').trim().slice(0, 160);
}

export function normalizePairingCode(value = '') {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

export function randomString(length = 16) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

export function buildPairingCode(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => PAIRING_CODE_ALPHABET[value % PAIRING_CODE_ALPHABET.length]).join('');
}

export async function hashText(value = '') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export function isFutureIso(value = '') {
  const normalizedValue = String(value || '').trim();
  const expiresAt = Date.parse(normalizedValue);

  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function readCurrentClientId(request) {
  const url = new URL(request.url);
  return normalizeClientId(url.searchParams.get('clientId'));
}

export function readCurrentClientSecret(request) {
  return normalizeClientSecret(request.headers.get(CLIENT_SECRET_HEADER));
}

export function resolveClientGroupId(settings, clientId = '', clientLabel = '') {
  const clientRecord = getClientRecord(settings, clientId, clientLabel);
  return normalizeNotifyGroupId(clientRecord.notifyGroupId || clientRecord.clientId) || clientRecord.clientId;
}

export function getNotifyGroupMembers(settings, groupId = '') {
  const normalizedGroupId = normalizeNotifyGroupId(groupId);

  if (!normalizedGroupId) {
    return [];
  }

  return Object.values(settings.clients || {}).filter((client) => (
    resolveClientGroupId(settings, client?.clientId, client?.clientLabel) === normalizedGroupId
  ));
}

export function requireMatchingClientId(request, payload = {}) {
  const queryClientId = readCurrentClientId(request);
  const bodyClientId = normalizeClientId(payload.clientId);
  const currentClientId = queryClientId || bodyClientId;

  if (!currentClientId) {
    throw new NotifyClientError('缺少浏览器 clientId。', 400, 'CLIENT_ID_REQUIRED');
  }

  if (queryClientId && bodyClientId && queryClientId !== bodyClientId) {
    throw new NotifyClientError('浏览器 clientId 不匹配。', 400, 'CLIENT_ID_MISMATCH');
  }

  return currentClientId;
}

function emptyDeviceState() {
  return {
    ruleStates: {},
    deliveryFailures: {},
    recentEvents: [],
    deliveryAcks: {},
    lastRunAt: ''
  };
}

function emptyDeviceMeta() {
  return {
    counts: { planRuleCount: 0, dcaRuleCount: 0, totalRuleCount: 0 },
    lastSyncedAt: '',
    lastCheckedAt: '',
    lastTestedAt: ''
  };
}

function recordActivityTime(record = {}) {
  return Math.max(
    Date.parse(String(record?.meta?.lastSyncedAt || '')) || 0,
    Date.parse(String(record?.meta?.lastCheckedAt || '')) || 0,
    Date.parse(String(record?.meta?.lastTestedAt || '')) || 0,
    Date.parse(String(record?.state?.lastRunAt || '')) || 0
  );
}

function hasServerChan3(record = {}) {
  return Boolean(record?.serverChan3?.uid && record?.serverChan3?.sendKey);
}

function chooseAccountSource(existingAccount, candidates = []) {
  if (existingAccount && !existingAccount.isDeviceOnly) return existingAccount;
  return [...candidates]
    .filter((record) => record && !record.isDeviceOnly)
    .sort((left, right) => recordActivityTime(right) - recordActivityTime(left))[0] || null;
}

async function ensureLegacyAuthenticatedClient(request, settings, options, clientId, clientSecret) {
  const desiredClientLabel = normalizeClientName(options?.clientLabel || '');
  const desiredAccountUsername = normalizeNotifyAccountUsername(
    options?.accountUsername
      ?? options?.payload?.accountUsername
      ?? request.headers.get(CLIENT_ACCOUNT_USERNAME_HEADER)
      ?? ''
  );

  if (!clientSecret) {
    throw new NotifyClientError('缺少浏览器鉴权信息，请刷新页面后重试。', 401);
  }

  const existingClient = settings.clients?.[clientId] || null;
  const clientSecretHash = await hashText(clientSecret);

  if (String(existingClient?.clientSecretHash || '').trim() && existingClient.clientSecretHash !== clientSecretHash) {
    throw new NotifyClientError('浏览器鉴权失败，请回到原浏览器页面重新加载后重试。', 401);
  }

  const needsSecretBootstrap = !existingClient || !String(existingClient.clientSecretHash || '').trim();
  const needsLabelUpdate = desiredClientLabel && desiredClientLabel !== String(existingClient?.clientLabel || '').trim();
  const needsAccountUsernameUpdate = desiredAccountUsername && desiredAccountUsername !== String(existingClient?.accountUsername || '').trim();
  const resolvedGroupId = normalizeNotifyGroupId(existingClient?.notifyGroupId || clientId) || clientId;

  if (needsSecretBootstrap || needsLabelUpdate || needsAccountUsernameUpdate) {
    const nextSettings = upsertClientRecord(settings, clientId, {
      clientLabel: needsLabelUpdate ? desiredClientLabel : String(existingClient?.clientLabel || desiredClientLabel || '').trim(),
      ...(needsAccountUsernameUpdate ? { accountUsername: desiredAccountUsername } : {}),
      notifyGroupId: resolvedGroupId,
      clientSecretHash
    });

    return {
      didUpdate: true,
      clientId,
      deviceClientId: clientId,
      clientRecord: getClientRecord(nextSettings, clientId, desiredClientLabel),
      settings: nextSettings
    };
  }

  return {
    didUpdate: false,
    clientId,
    deviceClientId: clientId,
    clientRecord: getClientRecord(settings, clientId, desiredClientLabel),
    settings
  };
}

export async function ensureAuthenticatedClient(request, settings, options = {}) {
  const deviceClientId = requireMatchingClientId(request, options?.payload);
  const clientSecret = readCurrentClientSecret(request);
  const verifiedUserId = normalizeNotifyUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER));
  const verifiedUsername = normalizeNotifyAccountUsername(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER));

  // 兼容内部单元测试和尚未经过账户鉴权包装的非配置路由。生产配置路由会在
  // index.js 中先校验 bearer token 并注入上述两个可信请求头。
  if (!verifiedUserId || !verifiedUsername) {
    return ensureLegacyAuthenticatedClient(request, settings, options, deviceClientId, clientSecret);
  }

  if (!clientSecret) {
    throw new NotifyClientError('缺少浏览器鉴权信息，请刷新页面后重试。', 401, 'CLIENT_AUTH_REQUIRED');
  }

  const originalSettings = normalizeSettings(settings);
  const existingDevice = originalSettings.clients?.[deviceClientId] || null;
  const clientSecretHash = await hashText(clientSecret);
  if (String(existingDevice?.clientSecretHash || '').trim() && existingDevice.clientSecretHash !== clientSecretHash) {
    throw new NotifyClientError('浏览器鉴权失败，请刷新页面后重试。', 401, 'CLIENT_AUTH_INVALID');
  }
  if (existingDevice?.ownerUserId && existingDevice.ownerUserId !== verifiedUserId) {
    throw new NotifyClientError('当前浏览器通知身份已属于其他账号，请清理本地通知配置后重试。', 403, 'CLIENT_ACCOUNT_MISMATCH');
  }

  const accountClientId = buildAccountClientId(verifiedUserId);
  const existingAccount = originalSettings.clients?.[accountClientId] || null;
  if (existingAccount?.ownerUserId && existingAccount.ownerUserId !== verifiedUserId) {
    throw new NotifyClientError('通知账号归属冲突。', 409, 'ACCOUNT_OWNERSHIP_CONFLICT');
  }

  const relatedRecords = Object.values(originalSettings.clients || {}).filter((record) => {
    if (!record?.clientId || record.clientId === accountClientId) return false;
    if (record.clientId === deviceClientId) return true;
    if (record.ownerUserId === verifiedUserId) return true;
    return !record.ownerUserId && verifiedUsername && record.accountUsername === verifiedUsername;
  });
  const source = chooseAccountSource(existingAccount, relatedRecords);
  const channelCandidates = [existingAccount, source, ...relatedRecords].filter(Boolean);
  const barkSource = channelCandidates.find((record) => String(record?.barkDeviceKey || '').trim());
  const serverSource = channelCandidates.find((record) => hasServerChan3(record));
  const desiredClientLabel = normalizeClientName(options?.clientLabel || existingDevice?.clientLabel || '');

  let nextSettings = upsertClientRecord(originalSettings, accountClientId, {
    clientLabel: existingAccount?.clientLabel || `账号通知 · ${verifiedUsername}`,
    accountUsername: verifiedUsername,
    ownerUserId: verifiedUserId,
    accountClientId,
    isDeviceOnly: false,
    notifyGroupId: accountClientId,
    clientSecretHash: '',
    barkDeviceKey: String(existingAccount?.barkDeviceKey || barkSource?.barkDeviceKey || '').trim(),
    serverChan3: hasServerChan3(existingAccount) ? existingAccount.serverChan3 : (serverSource?.serverChan3 || {}),
    payload: existingAccount?.payload || source?.payload || {},
    state: existingAccount?.state || source?.state || emptyDeviceState(),
    meta: existingAccount?.meta || source?.meta || emptyDeviceMeta()
  });

  const deviceRecords = new Map(relatedRecords.map((record) => [record.clientId, record]));
  if (!deviceRecords.has(deviceClientId)) {
    deviceRecords.set(deviceClientId, existingDevice || buildDefaultClientRecord(deviceClientId, desiredClientLabel));
  }

  for (const [clientId, record] of deviceRecords) {
    nextSettings = upsertClientRecord(nextSettings, clientId, {
      clientLabel: clientId === deviceClientId
        ? (desiredClientLabel || record.clientLabel)
        : record.clientLabel,
      accountUsername: verifiedUsername,
      ownerUserId: verifiedUserId,
      accountClientId,
      isDeviceOnly: true,
      notifyGroupId: accountClientId,
      clientSecretHash: clientId === deviceClientId ? clientSecretHash : record.clientSecretHash,
      barkDeviceKey: '',
      serverChan3: {},
      payload: {},
      state: emptyDeviceState(),
      meta: emptyDeviceMeta()
    });
  }

  const didUpdate = JSON.stringify(originalSettings.clients) !== JSON.stringify(nextSettings.clients);
  return {
    didUpdate,
    clientId: accountClientId,
    deviceClientId,
    ownerUserId: verifiedUserId,
    accountUsername: verifiedUsername,
    clientRecord: getClientRecord(nextSettings, accountClientId),
    settings: nextSettings
  };
}
