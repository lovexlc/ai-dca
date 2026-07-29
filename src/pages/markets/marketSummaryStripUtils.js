export function resolveMarketSummaryStripTitle(value = '', fallback = 'A股') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (normalized.includes('us markets') || normalized.includes('asia markets')) {
    return fallback;
  }
  if (normalized.includes('market')) {
    return raw;
  }
  return raw;
}
