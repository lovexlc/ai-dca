import { kvGetJson, kvPutJson } from './storage.js';

export const CACHE_TTL = {
  quote: 120,
  quoteClosed: 24 * 3600,
  fundMetricLive: 120,
  fundMetricClosed: 24 * 3600,
  indices: 120,
  sectors: 120,
  movers: 1800,
  search: 3600,
  news: 1800,
  earnings: 1800,
  profile: 24 * 3600,
  financials: 6 * 3600,
  kline: 120,
  summary: 2 * 3600,
};

export function marketsReadMode(env = {}) {
  const mode = String(env.MARKETS_DATA_READ_MODE || env.MARKETS_API_READ_MODE || 'cache-first').trim().toLowerCase();
  if (mode === 'cache-only') return 'cache-only';
  if (mode === 'cache-first') return 'cache-first';
  return 'live';
}

export function shouldReadCacheFirst(env = {}) {
  const mode = marketsReadMode(env);
  return mode === 'cache-first' || mode === 'cache-only';
}

export function shouldFetchLiveOnMiss(env = {}) {
  return marketsReadMode(env) !== 'cache-only';
}

export function isKvCacheEnabled(env = {}) {
  return Boolean(env.MARKETS_KV) && marketsReadMode(env) !== 'live';
}

export async function kvCacheGetJson(env, key) {
  if (!env.MARKETS_KV || !String(key || '').trim()) return null;
  return await kvGetJson(env, key).catch(() => null);
}

export async function kvCacheSetJson(env, key, value, { ttlSeconds = 300 } = {}) {
  if (!env.MARKETS_KV || !String(key || '').trim() || value == null) return false;
  await kvPutJson(env, key, value, { ttlSeconds });
  return true;
}

function normalizeKeys(keys = []) {
  return Array.from(new Set((Array.isArray(keys) ? keys : [])
    .map((key) => String(key || '').trim())
    .filter(Boolean)));
}

function normalizeJsonValue(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function coerceBatchKvResults(keys = [], value) {
  const out = {};
  if (!value) return out;

  if (value instanceof Map) {
    for (const key of keys) {
      const item = normalizeJsonValue(value.get(key));
      if (item != null) out[key] = item;
    }
    return out;
  }

  if (Array.isArray(value)) {
    keys.forEach((key, index) => {
      const item = normalizeJsonValue(value[index]);
      if (item != null) out[key] = item;
    });
    return out;
  }

  if (typeof value === 'object') {
    for (const key of keys) {
      const item = normalizeJsonValue(value[key]);
      if (item != null) out[key] = item;
    }
  }
  return out;
}

export async function kvCacheMGetJson(env, keys = []) {
  const list = normalizeKeys(keys);
  if (!env.MARKETS_KV || !list.length) return {};

  if (typeof env.MARKETS_KV.get === 'function' && list.length > 1) {
    const batch = await env.MARKETS_KV.get(list, { type: 'json' }).catch(() => null);
    const parsed = coerceBatchKvResults(list, batch);
    if (Object.keys(parsed).length) return parsed;
  }

  const entries = await Promise.all(list.map(async (key) => [key, await kvCacheGetJson(env, key)]));
  const out = {};
  for (const [key, value] of entries) {
    if (value != null) out[key] = value;
  }
  return out;
}

export async function kvCacheMSetJson(env, entries = [], { ttlSeconds = 300 } = {}) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.key && entry.value != null);
  if (!env.MARKETS_KV || !normalized.length) return false;
  await Promise.all(normalized.map((entry) => (
    kvCacheSetJson(env, entry.key, entry.value, { ttlSeconds }).catch(() => false)
  )));
  return true;
}
