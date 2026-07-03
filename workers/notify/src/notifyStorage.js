import { normalizeSettings } from './clientSettings.js';

const SETTINGS_KEY = 'notify:settings';
const MAX_RECENT_EVENTS = 30;

export function ensureStateBinding(env) {
  if (!env.NOTIFY_STATE) {
    throw new Error('未配置 NOTIFY_STATE KV 绑定。');
  }
}

export async function readJson(env, key, fallback) {
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

export async function writeJson(env, key, value) {
  ensureStateBinding(env);
  await env.NOTIFY_STATE.put(key, JSON.stringify(value));
}

export async function readSettings(env) {
  return normalizeSettings(await readJson(env, SETTINGS_KEY, {}));
}

function parseIsoTimestamp(value = '') {
  const timestamp = Date.parse(String(value || '').trim());
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeRecentEvents(left = [], right = []) {
  const byId = new Map();
  for (const event of [...left, ...right]) {
    const id = String(event?.id || '').trim();
    if (!id) continue;
    const current = byId.get(id);
    if (!current || parseIsoTimestamp(event?.createdAt) >= parseIsoTimestamp(current?.createdAt)) {
      byId.set(id, event);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => parseIsoTimestamp(b?.createdAt) - parseIsoTimestamp(a?.createdAt))
    .slice(0, MAX_RECENT_EVENTS);
}

function mergeDeliveryFailures(current = {}, incoming = {}) {
  const result = { ...(current && typeof current === 'object' ? current : {}) };
  for (const [key, value] of Object.entries(incoming && typeof incoming === 'object' ? incoming : {})) {
    const existing = result[key];
    result[key] = parseIsoTimestamp(value?.lastFailedAt) >= parseIsoTimestamp(existing?.lastFailedAt)
      ? value
      : existing;
  }
  return result;
}

function mergeDeliveryAcks(current = {}, incoming = {}) {
  return {
    ...(current && typeof current === 'object' ? current : {}),
    ...(incoming && typeof incoming === 'object' ? incoming : {})
  };
}

function pickLatestIso(left = '', right = '') {
  return parseIsoTimestamp(left) > parseIsoTimestamp(right) ? String(left || '') : String(right || '');
}

export function mergeConcurrentClientState(currentSettings = {}, incomingSettings = {}) {
  const current = normalizeSettings(currentSettings);
  const incoming = normalizeSettings(incomingSettings);
  const clients = {
    ...current.clients,
    ...incoming.clients
  };

  for (const [clientId, incomingClient] of Object.entries(incoming.clients || {})) {
    const currentClient = current.clients?.[clientId];
    if (!currentClient) continue;

    clients[clientId] = {
      ...incomingClient,
      state: {
        ...(incomingClient.state || {}),
        recentEvents: mergeRecentEvents(
          currentClient.state?.recentEvents,
          incomingClient.state?.recentEvents
        ),
        deliveryFailures: mergeDeliveryFailures(
          currentClient.state?.deliveryFailures,
          incomingClient.state?.deliveryFailures
        ),
        deliveryAcks: mergeDeliveryAcks(
          currentClient.state?.deliveryAcks,
          incomingClient.state?.deliveryAcks
        ),
        lastRunAt: pickLatestIso(
          currentClient.state?.lastRunAt,
          incomingClient.state?.lastRunAt
        )
      }
    };
  }

  return normalizeSettings({
    ...incoming,
    clients
  });
}

export async function writeSettings(env, settings) {
  const incoming = normalizeSettings(settings);
  const current = await readJson(env, SETTINGS_KEY, null);
  const merged = current ? mergeConcurrentClientState(current, incoming) : incoming;
  await writeJson(env, SETTINGS_KEY, merged);
}
