const API_ORIGIN = String(import.meta.env?.VITE_API_ORIGIN || '').replace(/\/$/, '');
const MARKETS_API_ORIGIN = String(import.meta.env?.VITE_MARKETS_API_ORIGIN || '').replace(/\/$/, '');
const NOTIFY_API_ORIGIN = String(import.meta.env?.VITE_NOTIFY_API_ORIGIN || '').replace(/\/$/, '');
const SYNC_API_ORIGIN = String(import.meta.env?.VITE_SYNC_API_ORIGIN || '').replace(/\/$/, '');

function originForPath(path = '') {
  const normalized = String(path || '');
  if (MARKETS_API_ORIGIN && normalized.startsWith('/api/markets')) return MARKETS_API_ORIGIN;
  if (NOTIFY_API_ORIGIN && (normalized.startsWith('/api/notify') || normalized.startsWith('/api/wechat'))) return NOTIFY_API_ORIGIN;
  if (SYNC_API_ORIGIN && normalized.startsWith('/api/sync')) return SYNC_API_ORIGIN;
  return API_ORIGIN;
}

export function apiUrl(path = '', query = {}) {
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
  const base = originForPath(normalizedPath) || (typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  const url = new URL(normalizedPath, base);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  if (originForPath(normalizedPath)) return url.toString();
  return `${url.pathname}${url.search}`;
}

export function wsApiUrl(path = '') {
  const httpUrl = apiUrl(path);
  if (httpUrl.startsWith('https://')) return `wss://${httpUrl.slice('https://'.length)}`;
  if (httpUrl.startsWith('http://')) return `ws://${httpUrl.slice('http://'.length)}`;

  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
  return `${protocol}//${host}${httpUrl}`;
}
