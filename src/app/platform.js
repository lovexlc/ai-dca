export function isNativeApp() {
  if (typeof window === 'undefined') return false;
  const capacitor = window.Capacitor;
  if (capacitor?.isNativePlatform?.()) return true;
  const platform = String(capacitor?.getPlatform?.() || '').trim().toLowerCase();
  return platform === 'android' || platform === 'ios';
}
