import { isTradingDayShanghai } from '../holidaysCN.js';

export function normalizeDateKey(value) {
  const iso = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
}

export function resolveIncomeEffectiveDate(portfolio, fallbackDate) {
  const today = normalizeDateKey(fallbackDate);
  const latest = normalizeDateKey(portfolio?.latestNavDate);
  if (!today) return latest;

  if (!isTradingDayShanghai(today)) {
    return latest && latest <= today ? latest : today;
  }

  const readyCount = Number(portfolio?.todayReadyCount) || 0;
  const todayProfit = Number(portfolio?.todayProfit);
  if (readyCount > 0 || (Number.isFinite(todayProfit) && todayProfit !== 0)) {
    return today;
  }

  return latest && latest <= today ? latest : today;
}

export function applyCurrentSnapshotDailyPnl(daily = {}, {
  portfolio,
  currentSnapshotDate,
  fromIso,
  toIso
} = {}) {
  const targetDate = normalizeDateKey(currentSnapshotDate);
  const from = normalizeDateKey(fromIso);
  const to = normalizeDateKey(toIso);
  const value = Number(portfolio?.todayProfit);
  if (!targetDate || !Number.isFinite(value)) return { ...(daily || {}) };
  if ((from && targetDate < from) || (to && targetDate > to)) return { ...(daily || {}) };
  if (value === 0 && daily?.[targetDate] !== undefined) return { ...(daily || {}) };

  const next = { ...(daily || {}) };
  const latestDate = normalizeDateKey(portfolio?.latestNavDate);
  if (latestDate && latestDate !== targetDate && next[latestDate] !== undefined) {
    const previousValue = Number(next[latestDate]);
    if (Number.isFinite(previousValue) && Math.abs(previousValue - value) < 0.01) {
      delete next[latestDate];
    }
  }
  next[targetDate] = value;
  return next;
}
