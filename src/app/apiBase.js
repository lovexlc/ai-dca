const API_ORIGIN = String(import.meta.env?.VITE_API_ORIGIN || '').replace(/\/$/, '');

export function apiUrl(path = '', query = {}) {
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
  const base = API_ORIGIN || (typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  const url = new URL(normalizedPath, base);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  if (API_ORIGIN) return url.toString();
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
