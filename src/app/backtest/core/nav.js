/**
 * NAV lookup helpers - backtest single source.
 */

/**
 * Build a point-in-time NAV lookup.
 * The returned function uses the latest NAV whose date is <= the requested date.
 */
export function buildNavLookup(navHistory = []) {
  const sorted = (Array.isArray(navHistory) ? navHistory : [])
    .map((item) => {
      const date = String(item?.date || '').slice(0, 10);
      const nav = Number(item?.nav);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(nav) && nav > 0
        ? { date, nav }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));

  return (date) => {
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      if (sorted[i].date <= date) return sorted[i].nav;
    }
    return 0;
  };
}
