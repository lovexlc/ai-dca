function shanghaiDateFromEpochSec(sec) {
  const value = Number(sec);
  if (!Number.isFinite(value) || value <= 0) return '';
  try {
    return new Date(value * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date(value * 1000).toISOString().slice(0, 10);
  }
}

export function deriveKlineHighPoint(candles = [], { daysBack = 365, source = 'daily-kline-365d' } = {}) {
  const rows = (Array.isArray(candles) ? candles : [])
    .map((candle) => {
      const t = Number(candle?.t ?? candle?.timestamp);
      const high = Number(candle?.h ?? candle?.high);
      return { t, high };
    })
    .filter((row) => Number.isFinite(row.t) && row.t > 0 && Number.isFinite(row.high) && row.high > 0);
  if (!rows.length) return null;

  const maxT = rows.reduce((max, row) => Math.max(max, row.t), 0);
  const normalizedDaysBack = Number(daysBack);
  const cutoffT = Number.isFinite(normalizedDaysBack) && normalizedDaysBack > 0
    ? maxT - normalizedDaysBack * 86400
    : -Infinity;

  let high = null;
  let highT = 0;
  let count = 0;
  for (const row of rows) {
    if (row.t < cutoffT) continue;
    count += 1;
    if (high == null || row.high > high) {
      high = row.high;
      highT = row.t;
    }
  }
  if (!Number.isFinite(high) || high <= 0) return null;
  return {
    high,
    highDate: highT ? shanghaiDateFromEpochSec(highT) : '',
    source,
    daysBack: Number.isFinite(normalizedDaysBack) && normalizedDaysBack > 0 ? normalizedDaysBack : null,
    count
  };
}

export function pickHigherHighPoint(left, right) {
  const leftHigh = Number(left?.high);
  const rightHigh = Number(right?.high);
  if (Number.isFinite(leftHigh) && leftHigh > 0 && (!Number.isFinite(rightHigh) || rightHigh <= 0 || leftHigh >= rightHigh)) return left;
  if (Number.isFinite(rightHigh) && rightHigh > 0) return right;
  return null;
}

export function attachKlineHighPoint(payload = {}, options = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const interval = String(payload.interval || options.interval || '').trim();
  if (interval !== '1d') return payload;
  if (payload.highPoint && !options.forceDerive) return payload;
  const derived = deriveKlineHighPoint(payload.candles, options);
  const highPoint = pickHigherHighPoint(payload.highPoint, derived);
  return highPoint ? { ...payload, highPoint } : payload;
}
