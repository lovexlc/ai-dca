const PRELOAD_RELOAD_STORAGE_KEY = 'ai-dca:preload-reload-at:v1';
const PRELOAD_RELOAD_COOLDOWN_MS = 60_000;

function claimPreloadReload(windowRef, nowMs) {
  try {
    const storage = windowRef.sessionStorage;
    const storedReloadAt = storage.getItem(PRELOAD_RELOAD_STORAGE_KEY);
    const lastReloadAt = storedReloadAt === null ? NaN : Number(storedReloadAt);
    if (Number.isFinite(lastReloadAt) && nowMs - lastReloadAt < PRELOAD_RELOAD_COOLDOWN_MS) {
      return false;
    }
    storage.setItem(PRELOAD_RELOAD_STORAGE_KEY, String(nowMs));
    return true;
  } catch {
    // Without a per-tab marker, reloading could create an infinite loop.
    return false;
  }
}

export function installPreloadErrorRecovery({
  windowRef = typeof window !== 'undefined' ? window : null,
  now = () => Date.now()
} = {}) {
  if (!windowRef?.addEventListener) return () => {};

  const handlePreloadError = (event) => {
    const nowMs = Number(now());
    if (!Number.isFinite(nowMs) || !claimPreloadReload(windowRef, nowMs)) return;
    event?.preventDefault?.();
    windowRef.location.reload();
  };

  windowRef.addEventListener('vite:preloadError', handlePreloadError);
  return () => windowRef.removeEventListener('vite:preloadError', handlePreloadError);
}

export const preloadErrorRecoveryInternals = Object.freeze({
  storageKey: PRELOAD_RELOAD_STORAGE_KEY,
  cooldownMs: PRELOAD_RELOAD_COOLDOWN_MS
});
