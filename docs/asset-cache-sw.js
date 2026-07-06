const CACHE_NAME = 'ai-dca-static-assets-v1';
const MAX_CACHE_ENTRIES = 120;
const ASSET_PATH_PATTERN = /\/react-assets(?:-v2)?\/[^/?#]+\.(?:css|js|png|jpg|jpeg|svg|webp|woff2?)$/;

function shouldCacheAsset(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return ASSET_PATH_PATTERN.test(url.pathname);
}

function normalizeCacheableUrl(value) {
  try {
    const url = new URL(value, self.location.href);
    if (url.origin !== self.location.origin) return '';
    if (!ASSET_PATH_PATTERN.test(url.pathname)) return '';
    return url.href;
  } catch {
    return '';
  }
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_CACHE_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_CACHE_ENTRIES).map((request) => cache.delete(request)));
}

async function cacheAssetUrls(urls = []) {
  const cache = await caches.open(CACHE_NAME);
  const uniqueUrls = Array.from(new Set((Array.isArray(urls) ? urls : []).map(normalizeCacheableUrl).filter(Boolean)));
  await Promise.all(uniqueUrls.map(async (url) => {
    const request = new Request(url, { credentials: 'same-origin' });
    if (await cache.match(request)) return;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response);
  }));
  await trimCache(cache);
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('ai-dca-static-assets-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (!shouldCacheAsset(event.request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) {
      cache.put(event.request, response.clone())
        .then(() => trimCache(cache))
        .catch(() => {});
    }
    return response;
  })());
});

self.addEventListener('message', (event) => {
  if (event?.data?.type !== 'CACHE_ASSET_URLS') return;
  event.waitUntil(cacheAssetUrls(event.data.urls));
});
