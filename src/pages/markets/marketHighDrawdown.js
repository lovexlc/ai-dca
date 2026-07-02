function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

export function resolveHighDrawdown(row = {}) {
  const high = firstPositiveNumber(
    row.allTimeHigh,
    row.all_time_high,
    row.historyHigh,
    row.history_high,
    row.historicalHigh,
    row.highest,
    row.highestPrice,
    row.highest_price,
    row.maxPrice,
    row.max_price,
    row.yearHigh,
    row.high52w,
    row.high_52w,
    row.high52Week,
    row.fiftyTwoWeekHigh
  );
  const current = firstPositiveNumber(row.price, row.currentPrice, row.close, row.latestNav);

  if (!high || !current) return null;

  return {
    high,
    highDate: String(row.highDate || row.yearHighDate || row.high52wDate || '').trim(),
    current,
    drawdownPct: Math.max(((high - current) / high) * 100, 0)
  };
}
