const DEFAULT_PREFIX = 'ai-dca:markets:';

function redisBaseUrl(env = {}) {
  return String(env.MARKETS_REDIS_REST_URL || env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
}

function redisToken(env = {}) {
  return String(env.MARKETS_REDIS_READ_TOKEN || env.MARKETS_REDIS_REST_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '').trim();
}

function redisKey(env = {}, key = '') {
  const prefix = String(env.MARKETS_REDIS_PREFIX || DEFAULT_PREFIX).trim() || DEFAULT_PREFIX;
  return `${prefix}${String(key || '').trim()}`;
}

export function hasMarketsRedis(env = {}) {
  return Boolean(redisBaseUrl(env) && redisToken(env));
}

export function marketsWsReadMode(env = {}) {
  const mode = String(env.MARKETS_WS_DATA_READ_MODE || env.MARKETS_DATA_READ_MODE || 'cache-first').trim().toLowerCase();
  if (mode === 'cache-only' || mode === 'redis-only') return 'cache-only';
  if (mode === 'live') return 'live';
  return 'cache-first';
}

export function shouldFetchMarketsOnRedisMiss(env = {}) {
  return marketsWsReadMode(env) !== 'cache-only';
}

export async function redisMGetJson(env, keys = []) {
  const list = Array.from(new Set((Array.isArray(keys) ? keys : []).map((key) => String(key || '').trim()).filter(Boolean)));
  if (!list.length || !hasMarketsRedis(env) || marketsWsReadMode(env) === 'live') return {};
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
