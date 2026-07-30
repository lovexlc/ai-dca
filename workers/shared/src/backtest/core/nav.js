export function buildNavLookup(navHistory = []) {
  const sorted = (Array.isArray(navHistory) ? navHistory : [])
    .map((item) => ({ date: String(item?.date || '').slice(0, 10), nav: Number(item?.nav) }))
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(item.nav) && item.nav > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  return (date) => {
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      if (sorted[index].date <= date) return sorted[index].nav;
    }
    return null;
  };
}
