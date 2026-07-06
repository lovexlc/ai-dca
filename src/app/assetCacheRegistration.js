function collectLoadedAssetUrls() {
  const urls = new Set();
  const addUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return;
    try {
      const url = new URL(raw, window.location.href);
      if (/\/react-assets(?:-v2)?\/[^?#]+\.(?:css|js|png|jpg|jpeg|svg|webp|woff2?)$/.test(url.pathname)) {
        urls.add(url.href);
      }
    } catch {
      // ignore malformed asset URLs
    }
  };
  document.querySelectorAll('script[src],link[href]').forEach((node) => {
    addUrl(node.getAttribute('src') || node.getAttribute('href'));
  });
  try {
    performance.getEntriesByType('resource').forEach((entry) => addUrl(entry.name));
  } catch {
    // ignore performance entry access errors
  }
  return Array.from(urls);
}

async function seedAssetCache(registration) {
  const worker = registration.active || await navigator.serviceWorker.ready.then((ready) => ready.active);
  if (!worker) return;
  const urls = collectLoadedAssetUrls();
  if (!urls.length) return;
  worker.postMessage({ type: 'CACHE_ASSET_URLS', urls });
}

export function registerAssetCacheWhenIdle(runWhenIdle) {
  if (!import.meta.env.PROD) return;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const schedule = typeof runWhenIdle === 'function'
    ? runWhenIdle
    : (callback) => window.setTimeout(callback, 1500);
  schedule(() => {
    navigator.serviceWorker.register('./asset-cache-sw.js')
      .then(seedAssetCache)
      .catch(() => {
        // Static asset caching is an acceleration layer; page loading must not depend on it.
      });
  }, { timeout: 5000, delayMs: 3000 });
}
