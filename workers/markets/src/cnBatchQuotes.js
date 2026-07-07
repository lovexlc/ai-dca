import { mapLimit, fetchCnQuotesBatchWithFallback } from './marketRuntime.js';
import { attachCnExchangeHighPoint } from './cnKlineHighQuote.js';
import { quoteCacheTtlSeconds, readFreshQuoteCache, writeQuoteCache } from './quoteCache.js';

export async function fillCnBatchQuotes(env, cnItems = [], out = {}) {
  const fetchItems = [];
  await mapLimit(cnItems, 8, async (item) => {
    const cached = await readFreshQuoteCache(env, item.code, 'cn');
    if (!cached) {
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
    const withHigh = await attachCnExchangeHighPoint(env, quote, key);
    out[key] = withHigh;
    await writeQuoteCache(env, codeByRaw[key], withHigh, { ttlSeconds: quoteCacheTtlSeconds('cn') });
  });
  return out;
}
