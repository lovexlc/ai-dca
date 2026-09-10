import { normalizeEmailConfig } from './channels/email.js';
import { normalizeSettings } from './clientSettings.js';
import {
  hasNotifyRowStorage,
  isDurableUserKey,
  listDurableUserKeys,
  readDurableUserJson,
  writeDurableUserJson
} from './notifyRowStorage.js';
import {
  loadSettingsWithFeatureItems,
  writeSettingsWithFeatureItems
} from './notifyItemStorage.js';

export const SETTINGS_KEY = 'notify:settings';
const MAX_RECENT_EVENTS = 30;

export function ensureStateBinding(env) {
  if (!env.NOTIFY_STATE) throw new Error('未配置 NOTIFY_STATE KV 绑定。');
}

async function readLegacyJson(env, key, fallback) {
  ensureStateBinding(env);
  const rawValue = await env.NOTIFY_STATE.get(key);
  if (!rawValue) return fallback;
  try { return JSON.parse(rawValue); } catch (_error) { return fallback; }
}

export async function readJson(env, key, fallback) {
  if (hasNotifyRowStorage(env) && key !== SETTINGS_KEY && isDurableUserKey(key)) {
    return readDurableUserJson(env, key, fallback, () => readLegacyJson(env, key, null));
  }
  return readLegacyJson(env, key, fallback);
}

export async function writeJson(env, key, value) {
  if (hasNotifyRowStorage(env) && key !== SETTINGS_KEY && isDurableUserKey(key)) {
    const writtenToRows = await writeDurableUserJson(env, key, value);
    if (writtenToRows) return;
  }
  ensureStateBinding(env);
  await env.NOTIFY_STATE.put(key, JSON.stringify(value));
}

export async function listUserJsonKeys(env, prefix = '') {
  return listDurableUserKeys(env, prefix);
}

function inheritLinkedAccountIdentity(settings = {}) {
  const normalized = normalizeSettings(settings);
  const clients = { ...(normalized.clients || {}) };
  for (const [clientId, client] of Object.entries(clients)) {
    const accountClientId = String(client?.accountClientId || '').trim();
    const account = accountClientId ? clients[accountClientId] : null;
    if (!account || clientId === accountClientId) continue;
    clients[clientId] = {
      ...client,
      ownerUserId: client.ownerUserId || account.ownerUserId || '',
      accountUsername: client.accountUsername || account.accountUsername || ''
    };
  }
  return normalizeSettings({ ...normalized, clients });
}

export async function readSettings(env) {
  if (hasNotifyRowStorage(env)) {
    try {
      const settings = await loadSettingsWithFeatureItems(env, () => readLegacyJson(env, SETTINGS_KEY, {}));
      return inheritLinkedAccountIdentity(settings);
    } catch (error) {
      console.warn('[notify] row storage read failed, falling back to legacy KV:', String(error?.message || error));
    }
  }
  return inheritLinkedAccountIdentity(await readLegacyJson(env, SETTINGS_KEY, {}));
}

function parseIsoTimestamp(value = '') {
  const timestamp = Date.parse(String(value || '').trim());
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeRecentEvents(left = [], right = []) {
  const byId = new Map();
  for (const event of [...left, ...right]) {
    const id = String(event?.id || event?.eventId || event?.messageId || '').trim();
    if (!id) continue;
    const current = byId.get(id);
    if (!current || parseIsoTimestamp(event?.createdAt) >= parseIsoTimestamp(current?.createdAt)) byId.set(id, event);
  }
  return Array.from(byId.values()).sort((a, b) => parseIsoTimestamp(b?.createdAt) - parseIsoTimestamp(a?.createdAt)).slice(0, MAX_RECENT_EVENTS);
}

function mergeDeliveryFailures(current = {}, incoming = {}) {
  const result = { ...(current && typeof current === 'object' ? current : {}) };
  for (const [key, value] of Object.entries(incoming && typeof incoming === 'object' ? incoming : {})) {
    const existing = result[key];
    result[key] = parseIsoTimestamp(value?.lastFailedAt) >= parseIsoTimestamp(existing?.lastFailedAt) ? value : existing;
  }
  return result;
}

function mergeDeliveryAcks(current = {}, incoming = {}) {
  const result = { ...(current && typeof current === 'object' ? current : {}) };
  for (const [key, value] of Object.entries(incoming && typeof incoming === 'object' ? incoming : {})) {
    const existing = result[key];
    const incomingAt = parseIsoTimestamp(value?.updatedAt || value?.lastAckAt);
    const existingAt = parseIsoTimestamp(existing?.updatedAt || existing?.lastAckAt);
    result[key] = incomingAt >= existingAt ? value : existing;
  }
  return result;
}

function pickLatestIso(left = '', right = '') {
  return parseIsoTimestamp(left) > parseIsoTimestamp(right) ? String(left || '') : String(right || '');
}

function pickLatestPayload(current = {}, incoming = {}) {
  const currentAt = parseIsoTimestamp(current?.syncedAt);
  const incomingAt = parseIsoTimestamp(incoming?.syncedAt);
  if (currentAt && incomingAt && currentAt > incomingAt) return current;
  return incomingAt || !currentAt ? incoming : current;
}

function mergeClientMeta(current = {}, incoming = {}) {
  const currentSyncedAt = parseIsoTimestamp(current?.lastSyncedAt);
  const incomingSyncedAt = parseIsoTimestamp(incoming?.lastSyncedAt);
  const latestCounts = incomingSyncedAt >= currentSyncedAt ? (incoming?.counts || current?.counts || {}) : (current?.counts || incoming?.counts || {});
  return {
    ...(current || {}), ...(incoming || {}), counts: latestCounts,
    lastSyncedAt: pickLatestIso(current?.lastSyncedAt, incoming?.lastSyncedAt),
    lastCheckedAt: pickLatestIso(current?.lastCheckedAt, incoming?.lastCheckedAt),
    lastTestedAt: pickLatestIso(current?.lastTestedAt, incoming?.lastTestedAt)
  };
}

function hasConfiguredBark(client = {}) { return Boolean(String(client?.barkDeviceKey || '').trim()); }
function hasConfiguredServerChan3(client = {}) { return Boolean(String(client?.serverChan3?.uid || '').trim() && String(client?.serverChan3?.sendKey || '').trim()); }
function hasVerifiedEmail(client = {}) {
  const email = normalizeEmailConfig(client?.email || {});
  return Boolean(email.address && email.verified);
}
function mergeStaleChannelConfig(currentClient = {}, incomingClient = {}) {
  const mergedClient = { ...incomingClient };
  if (hasConfiguredBark(currentClient) && !hasConfiguredBark(incomingClient)) mergedClient.barkDeviceKey = currentClient.barkDeviceKey;
  if (hasConfiguredServerChan3(currentClient) && !hasConfiguredServerChan3(incomingClient)) mergedClient.serverChan3 = currentClient.serverChan3;
  if (hasVerifiedEmail(currentClient) && !hasVerifiedEmail(incomingClient)) mergedClient.email = currentClient.email;
  return mergedClient;
}

export function mergeConcurrentClientState(currentSettings = {}, incomingSettings = {}, options = {}) {
  const current = normalizeSettings(currentSettings);
  const incoming = normalizeSettings(incomingSettings);
  const preserveStaleChannels = options?.preserveStaleChannels === true;
  const clients = { ...current.clients, ...incoming.clients };
  for (const [clientId, incomingClient] of Object.entries(incoming.clients || {})) {
    const currentClient = current.clients?.[clientId];
    if (!currentClient) continue;
    const mergedClient = preserveStaleChannels ? mergeStaleChannelConfig(currentClient, incomingClient) : incomingClient;
    clients[clientId] = {
      ...mergedClient,
      payload: pickLatestPayload(currentClient.payload, mergedClient.payload),
      meta: mergeClientMeta(currentClient.meta, mergedClient.meta),
      state: {
        ...(mergedClient.state || {}),
        recentEvents: mergeRecentEvents(currentClient.state?.recentEvents, incomingClient.state?.recentEvents),
        deliveryFailures: mergeDeliveryFailures(currentClient.state?.deliveryFailures, incomingClient.state?.deliveryFailures),
        deliveryAcks: mergeDeliveryAcks(currentClient.state?.deliveryAcks, incomingClient.state?.deliveryAcks),
        lastRunAt: pickLatestIso(currentClient.state?.lastRunAt, incomingClient.state?.lastRunAt)
      }
    };
  }
  return normalizeSettings({ ...incoming, clients });
}

export async function writeSettings(env, settings, options = {}) {
  const incoming = normalizeSettings(settings);
  if (hasNotifyRowStorage(env)) {
    try {
      const current = await loadSettingsWithFeatureItems(env, () => readLegacyJson(env, SETTINGS_KEY, {}));
      const preserveConfiguredChannels = options?.preserveStaleChannels !== false;
      const merged = current ? mergeConcurrentClientState(current, incoming, { preserveStaleChannels: preserveConfiguredChannels }) : incoming;
      await writeSettingsWithFeatureItems(env, merged, { preserveConfiguredChannels });
      return;
    } catch (error) {
      console.error('[notify] row storage write failed:', String(error?.message || error));
      throw error;
    }
  }
  ensureStateBinding(env);
  await env.NOTIFY_STATE.put(SETTINGS_KEY, JSON.stringify(incoming));
}
