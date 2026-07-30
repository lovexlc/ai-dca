const DEFAULT_PUBLIC_DATA_BASE_URL = 'https://api.freebacktrack.tech';

function stripTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

export function buildMarketsApiUrl(env = null, path = '') {
  const base = stripTrailingSlash(env?.PUBLIC_DATA_BASE_URL || DEFAULT_PUBLIC_DATA_BASE_URL);
  const rawPath = String(path || '').trim();
  if (/^https?:\/\//i.test(rawPath)) return rawPath;
  const normalizedPath = rawPath.startsWith('/api/markets')
    ? rawPath
    : `/api/markets/${rawPath.replace(/^\/+/, '')}`;
  return `${base}${normalizedPath}`;
}

/**
 * One internal Markets service boundary for Workers that need market data.
 * The service binding is preferred in production; the public URL remains a
 * local/test fallback. Callers choose whether a non-2xx response is fatal.
 */
export async function fetchMarketsResponse(env, path, init = {}) {
  const url = buildMarketsApiUrl(env, path);
  const request = new Request(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.headers || {})
    }
  });
  return env?.MARKETS && typeof env.MARKETS.fetch === 'function'
    ? env.MARKETS.fetch(request)
    : fetch(request);
}

export async function fetchMarketsJson(env, path, init = {}) {
  const url = buildMarketsApiUrl(env, path);
  const response = await fetchMarketsResponse(env, path, init);
  if (!response.ok) {
    throw new Error(`请求 ${url} 失败：状态 ${response.status}`);
  }
  return response.json();
}
