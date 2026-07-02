import { attachHistoricalPercentile } from './historicalPercentile.js';
import { mapLimit, fetchCnQuotesBatchWithFallback } from './marketRuntime.js';
import { attachCnExchangeHighPoint } from './cnKlineHighQuote.js';
import { readFreshQuoteCache, writeQuoteCache } from './quoteCache.js';

export async function fillCnBatchQuotes(env, cnItems = [], out = {}) {
  const fetchItems = [];
  await mapLimit(cnItems, 8, async (item) => {
    const cached = await readFreshQuoteCache(env, item.code, 'cn');
    if (!cached) {
      fetchItems.push(item);
      return;
    }
    const withHigh = await attachCnExchangeHighPoint(env, cached, item.code);
    out[item.raw] = { ...await attachHistoricalPercentile(env, withHigh, 'cn'), cached: true };
  });
  if (!fetchItems.length) return out;

  const quotes = await fetchCnQuotesBatchWithFallback(env, fetchItems);
  const codeByRaw = Object.fromEntries(fetchItems.map((item) => [item.raw, item.code]));
  await mapLimit(Object.entries(quotes), 8, async ([key, quote]) => {
    const withHigh = await attachCnExchangeHighPoint(env, quote, key);
    const enriched = await attachHistoricalPercentile(env, withHigh, 'cn');
    out[key] = enriched;
    await writeQuoteCache(env, codeByRaw[key], enriched);
  });
  return out;
}
