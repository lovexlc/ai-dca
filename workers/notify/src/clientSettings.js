import { normalizeNotifyGroupId, normalizeGcmRegistrations } from './gcm.js';
import { normalizeNotifyPayload } from './rules.js';

export const CLIENT_SECRET_HEADER = 'x-notify-client-secret';
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

export function buildDefaultClientRecord(clientId = '', clientLabel = '') {
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

export function buildScopedNotifySettings(settings, clientId = '') {
  const clientRecord = getClientRecord(settings, clientId);

  return {
    ...settings,
    barkDeviceKey: clientRecord.barkDeviceKey,
    clientId: clientRecord.clientId,
    clientLabel: clientRecord.clientLabel,
    notifyGroupId: clientRecord.notifyGroupId
  };
}

export function normalizeClientId(value = '') {
  return String(value || '').trim().slice(0, 120);
}

export function normalizeClientName(value = '') {
  return String(value || '').trim().slice(0, 120);
}

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
    throw new Error('缺少浏览器 clientId。');
  }

  if (queryClientId && bodyClientId && queryClientId !== bodyClientId) {
    throw new Error('浏览器 clientId 不匹配。');
  }

  return currentClientId;
}

export async function ensureAuthenticatedClient(request, settings, options = {}) {
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
