import { readCachedKline } from '../../app/marketHistoryCache.js';
import { fetchKline } from './marketsApiLoader.js';
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

async function loadHistoryCandles(symbol, { readCachedKlineFn, fetchKlineFn, limit }) {
  try {
    const cached = await readCachedKlineFn({
      symbol,
      timeframe: '1d',
      minCandles: limit,
    });
    const candles = Array.isArray(cached?.candles) ? cached.candles.slice(-limit) : [];
    if (candles.length >= 2) return candles;
  } catch {
    // Browser cache is optional; continue with fund_collector's local cache.
  }

  try {
    const payload = await fetchKlineFn(symbol, {
      timeframe: '1d',
      limit,
      market: 'cn',
    });
    return Array.isArray(payload?.candles) ? payload.candles.slice(-limit) : [];
  } catch {
    return [];
  }
}

export async function loadCachedListHistoryMetrics(
  symbols = [],
  {
    existingMap = {},
    readCachedKlineFn = readCachedKline,
    fetchKlineFn = fetchKline,
    limit = LIST_HISTORY_CACHE_LIMIT,
    maxSymbols = MAX_LIST_HISTORY_CACHE_READS,
  } = {}
) {
  const candidates = normalizeSymbols(symbols)
    .filter((symbol) => !existingMap?.[symbol]?.candles?.length)
    .slice(0, maxSymbols);
  if (!candidates.length) return {};

  const entries = await Promise.all(candidates.map(async (symbol) => {
    const candles = await loadHistoryCandles(symbol, { readCachedKlineFn, fetchKlineFn, limit });
    const metrics = deriveMarketListHistoryMetrics(candles);
    return metrics ? [symbol, metrics] : null;
  }));

  return Object.fromEntries(entries.filter(Boolean));
}
