const MOBILE_FALLBACK_PAINT_DELAY_MS = 240;

export function loadMarketsSidebarForFirstPaint() {
  const modulePromise = import('./MarketsSidebar.jsx');
  if (typeof window === 'undefined' || !window.matchMedia?.('(max-width: 1023px)').matches) return modulePromise;
  return new Promise((resolve, reject) => {
    window.setTimeout(() => {
      modulePromise.then(resolve, reject);
    }, MOBILE_FALLBACK_PAINT_DELAY_MS);
  });
}
