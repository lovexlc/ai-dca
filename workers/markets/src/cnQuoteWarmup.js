import { CN_ETF_WATCHLIST_DEFAULTS } from './defaults.js';
import { fetchCnQuotesBatchWithFallback, mapLimit } from './marketRuntime.js';
import { attachCnExchangeHighPoint } from './cnKlineHighQuote.js';
import { prepareQuoteCacheValue, quoteCacheTtlSeconds, writeQuoteCache } from './quoteCache.js';
import { redisMSetJson } from './redisCache.js';
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
    return { ok: true, market: 'cn', symbolCount: 0, successCount: 0, failureCount: 0, redisEntries: 0 };
  }

  const ttlSeconds = quoteCacheTtlSeconds('cn');
  const fetched = await fetchCnQuotesBatchWithFallback(env, items);
  const redisEntries = [];
  let successCount = 0;
  let failureCount = 0;

  await mapLimit(items, 8, async (item) => {
    const quote = fetched[item.raw] || fetched[item.code];
    if (!quote || quote.error) {
      failureCount += 1;
      return;
    }
    const withHigh = await attachCnExchangeHighPoint(env, quote, item.code);
    const cachedValue = prepareQuoteCacheValue(withHigh);
    await writeQuoteCache(env, item.code, cachedValue, { ttlSeconds });
    redisEntries.push({ key: 'quote:' + item.code, value: cachedValue });
    successCount += 1;
  });

  const redisOk = await redisMSetJson(env, redisEntries, { ttlSeconds }).catch(() => false);
  return {
    ok: true,
    market: 'cn',
    symbolCount: items.length,
    successCount,
    failureCount,
    redisEntries: redisEntries.length,
    redisOk,
    ttlSeconds,
    generatedAt: new Date().toISOString()
  };
}
