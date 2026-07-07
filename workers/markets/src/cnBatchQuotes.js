import { mapLimit, fetchCnQuoteWithFallback, fetchCnQuotesBatchWithFallback } from './marketRuntime.js';
import { attachCnExchangeHighPoint } from './cnKlineHighQuote.js';
import { quoteCacheTtlSeconds, readFreshQuoteCache, readStaleQuoteCache, writeQuoteCache } from './quoteCache.js';

export async function fetchCnQuoteWithStaleFallback(env, code, context = {}) {
  try {
    const quote = await fetchCnQuoteWithFallback(env, code, context);
    return await attachCnExchangeHighPoint(env, quote, code);
  } catch (err) {
    const stale = await readStaleQuoteCache(env, code, 'cn');
    if (!stale) throw err;
    const staleWithHigh = await attachCnExchangeHighPoint(env, stale, code);
    return {
      ...staleWithHigh,
      cached: true,
      stale: true,
      cache: { hit: true, source: 'kv-stale', liveError: String((err && err.message) || err), context }
    };
  }
}

export async function fillCnBatchQuotes(env, cnItems = [], out = {}) {
  const fetchItems = [];
  const staleQuotes = {};
  await mapLimit(cnItems, 8, async (item) => {
    const cached = await readFreshQuoteCache(env, item.code, 'cn');
    if (!cached) {
      const stale = await readStaleQuoteCache(env, item.code, 'cn');
      if (stale) staleQuotes[item.raw] = stale;
      fetchItems.push(item);
      return;
    }
    const withHigh = await attachCnExchangeHighPoint(env, cached, item.code);
    out[item.raw] = { ...withHigh, cached: true };
  });
  if (!fetchItems.length) return out;

  const quotes = await fetchCnQuotesBatchWithFallback(env, fetchItems);
  const codeByRaw = Object.fromEntries(fetchItems.map((item) => [item.raw, item.code]));
  await mapLimit(Object.entries(quotes), 8, async ([key, quote]) => {
    const stale = staleQuotes[key] || null;
    const liveOk = quote && !quote.error;
    const selected = liveOk ? quote : stale;
    if (!selected) {
      out[key] = quote;
      return;
    }
    const withHigh = await attachCnExchangeHighPoint(env, selected, key);
    out[key] = liveOk ? withHigh : {
      ...withHigh,
      cached: true,
      stale: true,
      cache: { hit: true, source: 'kv-stale', liveError: quote?.error || 'xueqiu quote unavailable' }
    };
    if (liveOk) await writeQuoteCache(env, codeByRaw[key], withHigh, { ttlSeconds: quoteCacheTtlSeconds('cn') });
  });
  return out;
}
