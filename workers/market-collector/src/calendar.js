// trading calendar — reusable A-share market-holiday config.
// Extracted from collect.js so both the collector and the notify worker can
// share one definition. To add a future holiday, append a [start, end] range
// (inclusive, 'YYYY-MM-DD') under the right year.

export const HOLIDAY_RANGES = {
  2024: [['2024-01-01','2024-01-01'],['2024-02-09','2024-02-17'],['2024-04-04','2024-04-06'],['2024-05-01','2024-05-05'],['2024-06-10','2024-06-10'],['2024-09-15','2024-09-17'],['2024-10-01','2024-10-07']],
  2025: [['2025-01-01','2025-01-01'],['2025-01-28','2025-02-04'],['2025-04-04','2025-04-06'],['2025-05-01','2025-05-05'],['2025-05-31','2025-06-02'],['2025-10-01','2025-10-08']],
  2026: [['2026-01-01','2026-01-03'],['2026-02-15','2026-02-23'],['2026-04-04','2026-04-06'],['2026-05-01','2026-05-05'],['2026-06-19','2026-06-21'],['2026-09-25','2026-09-27'],['2026-10-01','2026-10-07']],
};

export function shanghaiParts(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short' }).formatToParts(date);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hm: `${get('hour')}:${get('minute')}`, weekday: get('weekday') };
}

/** Return the matched holiday range [start, end] for a 'YYYY-MM-DD' date, or null. */
export function matchHolidayRange(dateStr) {
  const d = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const ranges = HOLIDAY_RANGES[d.slice(0, 4)] || [];
  return ranges.find(([s, e]) => s <= d && d <= e) || null;
}

/** True if the given date falls inside a configured market-holiday range. */
export function isMarketHoliday(date = new Date()) {
  const d = date instanceof Date ? shanghaiParts(date).date : String(date);
  return matchHolidayRange(d) != null;
}

/** Human-readable label for the holiday containing the date, e.g. '2026-10-01~2026-10-07'. Null when not a holiday. */
export function holidayLabel(date = new Date()) {
  const d = date instanceof Date ? shanghaiParts(date).date : String(date);
  const m = matchHolidayRange(d);
  return m ? `${m[0]}~${m[1]}` : null;
}

export function isTradingDay(date = new Date()) {
  const { date: d, weekday } = shanghaiParts(date);
  if (['Sat', 'Sun'].includes(weekday)) return false;
  return matchHolidayRange(d) == null;
}

export function classifySession(date = new Date()) {
  if (!isTradingDay(date)) return 'off_hours';
  const { hm } = shanghaiParts(date);
  if (hm >= '09:30' && hm < '11:30') return 'trading';
  if (hm >= '11:30' && hm < '13:00') return 'lunch';
  if (hm >= '13:00' && hm < '15:31') return 'trading';
  return 'off_hours';
}

/**
 * Build the observable skip record written when collection is skipped.
 * Returned object is JSON-serializable and safe to store in KV / logs.
 */
export function buildSkipRecord(date = new Date()) {
  const { date: d } = shanghaiParts(date);
  const label = holidayLabel(d);
  return {
    at: new Date().toISOString(),
    date: d,
    reason: label ? 'market-holiday' : 'off-hours',
    holiday: label,
    session: classifySession(date),
  };
}
