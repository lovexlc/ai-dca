const DEFAULT_PREFIX = 'ai-dca:markets:';

function redisBaseUrl(env = {}) {
  return String(env.MARKETS_REDIS_REST_URL || env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
}

function redisToken(env = {}) {
  return String(env.MARKETS_REDIS_REST_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '').trim();
}

export function hasRedis(env = {}) {
  return Boolean(redisBaseUrl(env) && redisToken(env));
}

export function redisKey(env = {}, key = '') {
  const prefix = String(env.MARKETS_REDIS_PREFIX || DEFAULT_PREFIX).trim() || DEFAULT_PREFIX;
  return `${prefix}${String(key || '').trim()}`;
}

async function redisCommand(env, command = []) {
  if (!hasRedis(env)) return null;
  const response = await fetch(`${redisBaseUrl(env)}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${redisToken(env)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify([command])
  });
  if (!response.ok) throw new Error(`redis HTTP ${response.status}`);
  const data = await response.json();
  const item = Array.isArray(data) ? data[0] : null;
  if (item?.error) throw new Error(String(item.error));
  return item?.result ?? null;
}

export async function redisGetJson(env, key) {
  const value = await redisCommand(env, ['GET', redisKey(env, key)]).catch(() => null);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function redisSetJson(env, key, value, { ttlSeconds = 300 } = {}) {
  if (!hasRedis(env) || !key || value == null) return false;
  const fullKey = redisKey(env, key);
  const payload = JSON.stringify(value);
  const ttl = Math.max(1, Number.parseInt(String(ttlSeconds || '0'), 10) || 0);
  const command = ttl > 0
    ? ['SET', fullKey, payload, 'EX', ttl]
    : ['SET', fullKey, payload];
  await redisCommand(env, command);
  return true;
}

export async function redisMGetJson(env, keys = []) {
  const list = Array.from(new Set((Array.isArray(keys) ? keys : []).map((key) => String(key || '').trim()).filter(Boolean)));
  if (!list.length || !hasRedis(env)) return {};
  const response = await fetch(`${redisBaseUrl(env)}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${redisToken(env)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(list.map((key) => ['GET', redisKey(env, key)]))
  }).catch(() => null);
  if (!response || !response.ok) return {};
  const data = await response.json().catch(() => []);
  const out = {};
  list.forEach((key, index) => {
    const value = data?.[index]?.result;
    if (!value) return;
    try {
      out[key] = JSON.parse(value);
    } catch {
      // ignore malformed cache entries
    }
  });
  return out;
}

export async function redisMSetJson(env, entries = [], { ttlSeconds = 300 } = {}) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.key && entry.value != null);
  if (!normalized.length || !hasRedis(env)) return false;
  const ttl = Math.max(1, Number.parseInt(String(ttlSeconds || '0'), 10) || 0);
  const commands = normalized.map((entry) => (
    ttl > 0
      ? ['SET', redisKey(env, entry.key), JSON.stringify(entry.value), 'EX', ttl]
      : ['SET', redisKey(env, entry.key), JSON.stringify(entry.value)]
  ));
  const response = await fetch(`${redisBaseUrl(env)}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${redisToken(env)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(commands)
  }).catch(() => null);
  return Boolean(response?.ok);
}

export function marketsReadMode(env = {}) {
  const mode = String(env.MARKETS_DATA_READ_MODE || env.MARKETS_API_READ_MODE || 'cache-first').trim().toLowerCase();
  if (mode === 'cache-only' || mode === 'redis-only') return 'cache-only';
  if (mode === 'cache-first' || mode === 'redis-first') return 'cache-first';
  return 'live';
}

export function shouldReadCacheFirst(env = {}) {
  const mode = marketsReadMode(env);
  return mode === 'cache-first' || mode === 'cache-only';
}

export function shouldFetchLiveOnMiss(env = {}) {
  return marketsReadMode(env) !== 'cache-only';
}

export function isRedisEnabled(env = {}) {
  return hasRedis(env) && marketsReadMode(env) !== 'live';
}

export const REDIS_TTL = {
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
  summary: 7200,
  profile: 7 * 24 * 3600,
  financials: 6 * 3600,
  kline: 24 * 3600
};
