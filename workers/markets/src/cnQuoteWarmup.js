import { CN_ETF_WATCHLIST_DEFAULTS } from './defaults.js';
import { fetchCnQuotesBatchWithFallback, mapLimit } from './marketRuntime.js';
import { attachCnExchangeHighPoint } from './cnKlineHighQuote.js';
import { attachHistoricalPercentile } from './historicalPercentile.js';
import { prepareQuoteCacheValue, quoteCacheTtlSeconds, writeQuoteCache } from './quoteCache.js';
import { classifySymbol } from './symbols.js';

function normalizeItems(symbols = []) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(symbols) ? symbols : []) {
    const symbol = String(raw || '').trim();
    if (!symbol) continue;
    const { market, code } = classifySymbol(symbol);
    if (market !== 'cn' || !code || seen.has(code)) continue;
    seen.add(code);
    out.push({ raw: symbol, code });
  }
  return out;
}

export async function refreshCnEtfQuoteCache(env, { symbols = CN_ETF_WATCHLIST_DEFAULTS } = {}) {
  const items = normalizeItems(symbols);
  if (!items.length) {
    return { ok: true, market: 'cn', symbolCount: 0, successCount: 0, failureCount: 0, kvEntries: 0 };
  }

  const ttlSeconds = quoteCacheTtlSeconds('cn');
  const fetched = await fetchCnQuotesBatchWithFallback(env, items);
  let successCount = 0;
  let failureCount = 0;

  await mapLimit(items, 8, async (item) => {
    const quote = fetched[item.raw] || fetched[item.code];
    if (!quote || quote.error) {
      failureCount += 1;
      return;
    }
    const withHigh = await attachCnExchangeHighPoint(env, quote, item.code);
    const withHistory = await attachHistoricalPercentile(env, withHigh, 'cn');
    const cachedValue = prepareQuoteCacheValue(withHistory);
    await writeQuoteCache(env, item.code, cachedValue, { ttlSeconds });
    successCount += 1;
  });

  return {
    ok: true,
    market: 'cn',
    symbolCount: items.length,
    successCount,
    failureCount,
    kvEntries: successCount,
    kvOk: Boolean(env.MARKETS_KV),
    ttlSeconds,
    generatedAt: new Date().toISOString()
  };
}
