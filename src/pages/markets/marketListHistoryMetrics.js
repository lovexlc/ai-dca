import { deriveCandlestickExtrema, shanghaiDateFromEpochSec } from './marketFundMetrics.js';

const RETURN_WINDOWS = [
  ['return1w', 7],
  ['return1m', 31],
  ['return3m', 93],
  ['return6m', 186],
  ['return1y', 365],
];

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCandle(candle = {}) {
  const t = finiteNumber(candle.t ?? candle.timestamp);
  const close = finiteNumber(candle.c ?? candle.close);
  const high = finiteNumber(candle.h ?? candle.high);
  const low = finiteNumber(candle.l ?? candle.low);
  const date = String(candle.date || candle.day || (t ? shanghaiDateFromEpochSec(t) : '')).slice(0, 10);
  if (!t || close == null || !date) return null;
  return { ...candle, t, date, c: close, h: high ?? close, l: low ?? close };
}

export function normalizeListHistoryCandles(candles = []) {
  const byDate = new Map();
  for (const candle of Array.isArray(candles) ? candles : []) {
    const normalized = normalizeCandle(candle);
    if (!normalized) continue;
    byDate.set(normalized.date, normalized);
  }
  return Array.from(byDate.values()).sort((a, b) => a.t - b.t);
}

function percentChange(current, base) {
  const c = finiteNumber(current);
  const b = finiteNumber(base);
  if (c == null || b == null || b <= 0) return null;
  return Math.round(((c - b) / b) * 10000) / 100;
}

function closeAtOrBefore(candles, targetT) {
  let selected = null;
  for (const candle of candles) {
    if (candle.t <= targetT) selected = candle;
    else break;
  }
  return selected;
}

function firstCloseOnOrAfter(candles, datePrefix) {
  const found = candles.find((candle) => String(candle.date || '') >= datePrefix);
  return found?.c ?? null;
}

function historicalPercentile(candles, currentPrice) {
  const current = finiteNumber(currentPrice);
  const closes = candles.map((candle) => finiteNumber(candle.c)).filter((value) => value != null);
  if (current == null || !closes.length) return null;
  const belowOrEqual = closes.filter((value) => value <= current).length;
  return Math.round((belowOrEqual / closes.length) * 10000) / 100;
}

function deriveCloseHighPoint(candles, { daysBack = 365 } = {}) {
  const maxT = candles.reduce((max, candle) => Math.max(max, Number(candle.t) || 0), 0);
  const normalizedDaysBack = Number(daysBack);
  const cutoffT = Number.isFinite(normalizedDaysBack) && normalizedDaysBack > 0
    ? maxT - normalizedDaysBack * 86400
    : -Infinity;
  let high = null;
  let highDate = '';
  let count = 0;
  for (const candle of candles) {
    const t = Number(candle.t);
    if (!Number.isFinite(t) || t < cutoffT) continue;
    count += 1;
    const close = finiteNumber(candle.c);
    if (close != null && close > 0 && (high == null || close > high)) {
      high = close;
      highDate = candle.date || '';
    }
  }
  return high ? { high, highDate, count } : null;
}

export function deriveMarketListHistoryMetrics(candles = [], { currentPrice = null, daysBack = 365 } = {}) {
  const normalized = normalizeListHistoryCandles(candles);
  if (normalized.length < 2) return null;

  const last = normalized[normalized.length - 1];
  const current = finiteNumber(currentPrice) ?? last.c;
  const latestT = last.t;
  const extrema = deriveCandlestickExtrema(normalized, { daysBack });
  const closeHighPoint = deriveCloseHighPoint(normalized, { daysBack });
  const out = {
    candles: normalized,
    historicalPercentile: historicalPercentile(normalized, current),
    highPoint: extrema.high
      ? { high: extrema.high, highDate: extrema.highDate, source: `local-kline-${daysBack}d` }
      : null,
    closeHighPoint: closeHighPoint
      ? { high: closeHighPoint.high, highDate: closeHighPoint.highDate, source: `local-close-kline-${daysBack}d`, count: closeHighPoint.count }
      : null,
    returnBase: percentChange(current, normalized[0]?.c),
  };

  for (const [key, days] of RETURN_WINDOWS) {
    out[key] = percentChange(current, closeAtOrBefore(normalized, latestT - days * 86400)?.c);
  }

  const year = String(last.date || '').slice(0, 4);
  out.ytdReturn = year ? percentChange(current, firstCloseOnOrAfter(normalized, `${year}-01-01`)) : null;
  return out;
}
