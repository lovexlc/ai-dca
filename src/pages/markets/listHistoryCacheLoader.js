import { readCachedKline } from '../../app/marketHistoryCache.js';
import { deriveMarketListHistoryMetrics } from './marketListHistoryMetrics.js';

export const LIST_HISTORY_CACHE_LIMIT = 365;
export const MAX_LIST_HISTORY_CACHE_READS = 60;

function normalizeSymbols(symbols = []) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(symbols) ? symbols : []) {
    const symbol = String(raw || '').trim();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

export async function loadCachedListHistoryMetrics(
  symbols = [],
  {
    existingMap = {},
    readCachedKlineFn = readCachedKline,
    limit = LIST_HISTORY_CACHE_LIMIT,
    maxSymbols = MAX_LIST_HISTORY_CACHE_READS,
  } = {}
) {
  const candidates = normalizeSymbols(symbols)
    .filter((symbol) => !existingMap?.[symbol]?.candles?.length)
    .slice(0, maxSymbols);
  if (!candidates.length) return {};

  const entries = await Promise.all(candidates.map(async (symbol) => {
    try {
      const payload = await readCachedKlineFn({
        symbol,
        timeframe: '1d',
        minCandles: limit,
      });
      const candles = Array.isArray(payload?.candles) ? payload.candles.slice(-limit) : [];
      const metrics = deriveMarketListHistoryMetrics(candles);
      return metrics ? [symbol, metrics] : null;
    } catch {
      return null;
    }
  }));

  return Object.fromEntries(entries.filter(Boolean));
}
