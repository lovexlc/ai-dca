export function normalizeCashYield(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const cashAmount = Math.max(Number(source.cashAmount ?? source.cashValue) || 0, 0);
  const annualRate = Number(source.annualRate ?? source.cashYieldRate) || 0;
  return {
    cashAmount,
    annualRate: Number.isFinite(annualRate) ? annualRate : 0,
  };
}

export function cashYieldDailyAmount(value = {}) {
  const cashYield = normalizeCashYield(value);
  return cashYield.cashAmount * cashYield.annualRate / 100 / 365;
}

export function cashYieldDays(fromIso, toIso) {
  const from = Date.parse(String(fromIso || '').slice(0, 10) + 'T00:00:00Z');
  const to = Date.parse(String(toIso || '').slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.floor((to - from) / 86400000) + 1;
}

export function cashYieldIncomeBetween(value = {}, fromIso, toIso) {
  return cashYieldDailyAmount(value) * cashYieldDays(fromIso, toIso);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

export function applyCashYieldToPortfolioSummary(summary = {}, value = {}, inceptionDate = '', asOfDate = '') {
  const dailyIncome = cashYieldDailyAmount(value);
  const cumulativeIncome = inceptionDate && asOfDate
    ? cashYieldIncomeBetween(value, inceptionDate, asOfDate)
    : 0;
  const next = { ...summary };
  next.cashYieldDailyIncome = round(dailyIncome);
  next.cashYieldCumulativeIncome = round(cumulativeIncome);
  next.cashYieldAmount = normalizeCashYield(value).cashAmount;
  next.todayProfit = round((Number(summary.todayProfit) || 0) + dailyIncome);
  next.previousMarketValue = (Number(summary.previousMarketValue) || 0) + next.cashYieldAmount;
  next.unrealizedProfit = round((Number(summary.unrealizedProfit) || 0) + cumulativeIncome);
  next.cumulativeProfit = round((Number(summary.cumulativeProfit) || 0) + cumulativeIncome);
  next.cumulativeCostBasis = (Number(summary.cumulativeCostBasis) || 0) + next.cashYieldAmount;
  next.todayReturnRate = next.previousMarketValue > 0 ? round((next.todayProfit / next.previousMarketValue) * 100) : 0;
  next.cumulativeReturnRate = next.cumulativeCostBasis > 0 ? round((next.cumulativeProfit / next.cumulativeCostBasis) * 100) : 0;
  return next;
}

export function addCashYieldToDailyPnlMap(dailyPnlByDate = {}, value = {}, fromIso = '', toIso = '') {
  const dailyIncome = cashYieldDailyAmount(value);
  if (!dailyIncome) return { ...dailyPnlByDate };
  const next = { ...dailyPnlByDate };
  const dates = Object.keys(next);
  const totalDays = cashYieldDays(fromIso, toIso);
  if (!dates.length && totalDays > 0) {
    const start = Date.parse(String(fromIso).slice(0, 10) + 'T00:00:00Z');
    for (let index = 0; index < totalDays; index += 1) {
      const date = new Date(start + index * 86400000).toISOString().slice(0, 10);
      next[date] = dailyIncome;
    }
    return next;
  }
  dates.forEach((date) => {
    next[date] = (Number(next[date]) || 0) + dailyIncome;
  });
  return next;
}
