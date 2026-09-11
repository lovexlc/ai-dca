import { normalizeEmailConfig } from './channels/email.js';
import { normalizeSettings } from './clientSettings.js';
import { deleteNotifyClientChannels, hasNotifyRowStorage, isDurableUserKey, listDurableUserKeys, readDurableUserJson, writeDurableUserJson } from './notifyRowStorage.js';
import { loadSettingsWithFeatureItems, writeSettingsWithFeatureItems } from './notifyItemStorage.js';

export const SETTINGS_KEY = 'notify:settings';
const MAX_RECENT_EVENTS = 30;

export function ensureStateBinding(env) { if (!env.NOTIFY_STATE) throw new Error('未配置 NOTIFY_STATE KV 绑定。'); }
async function readLegacyJson(env, key, fallback) { ensureStateBinding(env); const raw = await env.NOTIFY_STATE.get(key); if (!raw) return fallback; try { return JSON.parse(raw); } catch (_error) { return fallback; } }
export async function readJson(env, key, fallback) { if (hasNotifyRowStorage(env) && key !== SETTINGS_KEY && isDurableUserKey(key)) return readDurableUserJson(env, key, fallback, () => readLegacyJson(env, key, null)); return readLegacyJson(env, key, fallback); }
export async function writeJson(env, key, value) { if (hasNotifyRowStorage(env) && key !== SETTINGS_KEY && isDurableUserKey(key)) { const written = await writeDurableUserJson(env, key, value); if (written) return; } ensureStateBinding(env); await env.NOTIFY_STATE.put(key, JSON.stringify(value)); }
export async function listUserJsonKeys(env, prefix = '') { return listDurableUserKeys(env, prefix); }

function inheritLinkedAccountIdentity(settings = {}) {
  // readSettings 的两个入口（行读取 / KV legacy）都会在收尾统一 normalize，
  // 这里跳过入口归一化，省一次全量拷贝。
  const source = settings && typeof settings === 'object' ? settings : {};
  const clients = { ...(source.clients || {}) };
  const accountRecords = Object.values(clients).filter((record) => (
    record && !record.isDeviceOnly && record.ownerUserId && record.accountUsername
  ));
  for (const [clientId, client] of Object.entries(clients)) {
    const accountClientId = String(client?.accountClientId || '').trim();
    const linkedAccount = accountClientId ? clients[accountClientId] : null;
    const usernameAccount = client?.accountUsername
      ? accountRecords.find((record) => record.accountUsername === client.accountUsername)
      : null;
    const account = linkedAccount || usernameAccount;
    if (!account || clientId === account.clientId) continue;
    clients[clientId] = {
      ...client,
      ownerUserId: account.ownerUserId || client.ownerUserId || '',
      accountClientId: account.clientId || client.accountClientId || '',
      accountUsername: account.accountUsername || client.accountUsername || ''
    };
  }
  return normalizeSettings({ ...source, clients });
}

export async function readSettings(env) {
  if (hasNotifyRowStorage(env)) {
    try { return inheritLinkedAccountIdentity(await loadSettingsWithFeatureItems(env, () => readLegacyJson(env, SETTINGS_KEY, {}))); }
    catch (error) { console.warn('[notify] row storage read failed, falling back to legacy KV:', String(error?.message || error)); }
  }
  return inheritLinkedAccountIdentity(await readLegacyJson(env, SETTINGS_KEY, {}));
}

function parseIsoTimestamp(value = '') { const timestamp = Date.parse(String(value || '').trim()); return Number.isFinite(timestamp) ? timestamp : 0; }
function mergeRecentEvents(left = [], right = []) { const byId = new Map(); for (const event of [...left, ...right]) { const id = String(event?.id || event?.eventId || event?.messageId || '').trim(); if (!id) continue; const current = byId.get(id); if (!current || parseIsoTimestamp(event?.createdAt) >= parseIsoTimestamp(current?.createdAt)) byId.set(id, event); } return Array.from(byId.values()).sort((a, b) => parseIsoTimestamp(b?.createdAt) - parseIsoTimestamp(a?.createdAt)).slice(0, MAX_RECENT_EVENTS); }
function mergeDeliveryFailures(current = {}, incoming = {}) { const result = { ...(current && typeof current === 'object' ? current : {}) }; for (const [key, value] of Object.entries(incoming && typeof incoming === 'object' ? incoming : {})) { const existing = result[key]; result[key] = parseIsoTimestamp(value?.lastFailedAt) >= parseIsoTimestamp(existing?.lastFailedAt) ? value : existing; } return result; }
function mergeDeliveryAcks(current = {}, incoming = {}) { const result = { ...(current && typeof current === 'object' ? current : {}) }; for (const [key, value] of Object.entries(incoming && typeof incoming === 'object' ? incoming : {})) { const existing = result[key]; result[key] = parseIsoTimestamp(value?.updatedAt || value?.lastAckAt) >= parseIsoTimestamp(existing?.updatedAt || existing?.lastAckAt) ? value : existing; } return result; }
function pickLatestIso(left = '', right = '') { return parseIsoTimestamp(left) > parseIsoTimestamp(right) ? String(left || '') : String(right || ''); }
function pickLatestPayload(current = {}, incoming = {}) { const currentAt = parseIsoTimestamp(current?.syncedAt), incomingAt = parseIsoTimestamp(incoming?.syncedAt); if (currentAt && incomingAt && currentAt > incomingAt) return current; return incomingAt || !currentAt ? incoming : current; }
function mergeClientMeta(current = {}, incoming = {}) { const currentAt = parseIsoTimestamp(current?.lastSyncedAt), incomingAt = parseIsoTimestamp(incoming?.lastSyncedAt); return { ...(current || {}), ...(incoming || {}), counts: incomingAt >= currentAt ? (incoming?.counts || current?.counts || {}) : (current?.counts || incoming?.counts || {}), lastSyncedAt: pickLatestIso(current?.lastSyncedAt, incoming?.lastSyncedAt), lastCheckedAt: pickLatestIso(current?.lastCheckedAt, incoming?.lastCheckedAt), lastTestedAt: pickLatestIso(current?.lastTestedAt, incoming?.lastTestedAt) }; }
function hasConfiguredBark(client = {}) { return Boolean(String(client?.barkDeviceKey || '').trim()); }
function hasConfiguredServerChan3(client = {}) { return Boolean(String(client?.serverChan3?.uid || '').trim() && String(client?.serverChan3?.sendKey || '').trim()); }
function hasVerifiedEmail(client = {}) { const email = normalizeEmailConfig(client?.email || {}); return Boolean(email.address && email.verified); }
function mergeStaleChannelConfig(current = {}, incoming = {}) { const merged = { ...incoming }; if (hasConfiguredBark(current) && !hasConfiguredBark(incoming)) merged.barkDeviceKey = current.barkDeviceKey; if (hasConfiguredServerChan3(current) && !hasConfiguredServerChan3(incoming)) merged.serverChan3 = current.serverChan3; if (hasVerifiedEmail(current) && !hasVerifiedEmail(incoming)) merged.email = current.email; return merged; }

function applyChannelClears(settings = {}, clears = []) {
  const normalized = normalizeSettings(settings);
  if (!Array.isArray(clears) || !clears.length) return normalized;
  const clients = { ...(normalized.clients || {}) };
  for (const clear of clears) {
    const clientId = String(clear?.clientId || '').trim();
    const channel = String(clear?.channel || '').trim().toLowerCase();
    const client = clients[clientId];
    if (!client) continue;
    if (channel === 'bark') clients[clientId] = { ...client, barkDeviceKey: '' };
    if (channel === 'serverchan3') clients[clientId] = { ...client, serverChan3: {} };
    if (channel === 'email') clients[clientId] = { ...client, email: {} };
  }
  return normalizeSettings({ ...normalized, clients });
}

export function mergeConcurrentClientState(currentSettings = {}, incomingSettings = {}, options = {}) {
  // preNormalized：调用方保证两侧都已是 normalizeSettings 产物（writeSettings 的 D1 链路），
  // 跳过入口两份全量拷贝，出口直接拼接。
  const preNormalized = options?.preNormalized === true;
  const current = preNormalized ? currentSettings : normalizeSettings(currentSettings);
  const incoming = preNormalized ? incomingSettings : normalizeSettings(incomingSettings);
  const clients = { ...current.clients, ...incoming.clients };
  for (const [clientId, incomingClient] of Object.entries(incoming.clients || {})) {
    const currentClient = current.clients?.[clientId]; if (!currentClient) continue;
    const merged = options?.preserveStaleChannels === true ? mergeStaleChannelConfig(currentClient, incomingClient) : incomingClient;
    clients[clientId] = { ...merged, payload: pickLatestPayload(currentClient.payload, merged.payload), meta: mergeClientMeta(currentClient.meta, merged.meta), state: { ...(merged.state || {}), recentEvents: mergeRecentEvents(currentClient.state?.recentEvents, incomingClient.state?.recentEvents), deliveryFailures: mergeDeliveryFailures(currentClient.state?.deliveryFailures, incomingClient.state?.deliveryFailures), deliveryAcks: mergeDeliveryAcks(currentClient.state?.deliveryAcks, incomingClient.state?.deliveryAcks), lastRunAt: pickLatestIso(currentClient.state?.lastRunAt, incomingClient.state?.lastRunAt) } };
  }
  return preNormalized ? { ...incoming, clients } : normalizeSettings({ ...incoming, clients });
}

export async function writeSettings(env, settings, options = {}) {
  const incoming = normalizeSettings(settings);
  if (hasNotifyRowStorage(env)) {
    try {
      let current = await loadSettingsWithFeatureItems(env, () => readLegacyJson(env, SETTINGS_KEY, {}));
      const channelClears = Array.isArray(options?.channelClears) ? options.channelClears : [];
      if (channelClears.length) {
        await deleteNotifyClientChannels(env, channelClears);
        current = applyChannelClears(current, channelClears);
      }
      const preserve = options?.preserveStaleChannels !== false;
      const merged = current ? mergeConcurrentClientState(current, incoming, { preserveStaleChannels: preserve, preNormalized: true }) : incoming;
      await writeSettingsWithFeatureItems(env, merged, { preserveConfiguredChannels: preserve });
      return;
    } catch (error) {
      console.error('[notify] row storage write failed:', String(error?.message || error));
      throw error;
    }
  }
  ensureStateBinding(env);
  const channelClears = Array.isArray(options?.channelClears) ? options.channelClears : [];
  let current = await readLegacyJson(env, SETTINGS_KEY, {});
  if (channelClears.length) current = applyChannelClears(current, channelClears);
  const preserve = options?.preserveStaleChannels !== false;
  const merged = current ? mergeConcurrentClientState(current, incoming, { preserveStaleChannels: preserve }) : incoming;
  await env.NOTIFY_STATE.put(SETTINGS_KEY, JSON.stringify(merged));
}
