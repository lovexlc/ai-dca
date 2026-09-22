const openSources = new Set();

export const MOBILE_BOTTOM_SHEET_EVENT = 'workspace:mobile-bottom-sheet';

export function setMobileBottomSheetOpen(source, open) {
  const key = String(source || '').trim();
  if (!key) return;
  if (open) openSources.add(key);
  else openSources.delete(key);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MOBILE_BOTTOM_SHEET_EVENT, {
    detail: { open: openSources.size > 0, source: key },
  }));
}

export function isMobileBottomSheetOpen() {
  return openSources.size > 0;
}
