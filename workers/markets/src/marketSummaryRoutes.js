import { errorJson, json, mapLimit } from './marketRuntime.js';
import { fetchYahooMarketSummary, fetchYahooSparkline, shouldFetchPreferredUsMarketSummary } from './fetchers.js';
import { kvGetJson, kvPutJson } from './storage.js';
import { CACHE_TTL, isKvCacheEnabled, shouldFetchLiveOnMiss } from './kvCache.js';

const MAX_MARKET_SUMMARY_CACHE_AGE_MS = CACHE_TTL.marketSummary * 1000 * 3;
const MARKET_SUMMARY_SPARKLINE_LIMIT = 12;
const MARKET_SUMMARY_SPARKLINE_CONCURRENCY = 4;
const MARKET_SUMMARY_CONFIG = {
  US: { market: 'US', yahooRegion: 'US', title: 'US Markets' },
  ASIA: { market: 'ASIA', yahooRegion: 'US', title: 'Asia Markets' }
};

function isValidMarketSummaryCache(value, region) {
  if (!value || value.source !== 'yahoo-market-summary') return false;
  if (String(value.region || '').toUpperCase() !== region) return false;
  if (!Array.isArray(value.items)) return false;
  if (region === 'US' && shouldFetchPreferredUsMarketSummary(value.items)) return false;
  const generatedAtMs = Date.parse(value.generatedAt || '');
  if (!Number.isFinite(generatedAtMs)) return false;
  const ageMs = Date.now() - generatedAtMs;
  return ageMs >= -60_000 && ageMs <= MAX_MARKET_SUMMARY_CACHE_AGE_MS;
}

async function enrichMarketSummarySparklines(items = []) {
  const list = Array.isArray(items) ? items : [];
  const enriched = list.map((item) => ({ ...item }));
  const targets = enriched
    .slice(0, MARKET_SUMMARY_SPARKLINE_LIMIT)
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item?.symbol && !(Array.isArray(item.sparkline) && item.sparkline.length >= 2));

  await mapLimit(targets, MARKET_SUMMARY_SPARKLINE_CONCURRENCY, async ({ item, index }) => {
    try {
      const sparkline = await fetchYahooSparkline(item.symbol, {
        range: '1d',
        interval: '15m',
        maxPoints: 80
      });
      enriched[index] = {
        ...item,
        sparkline,
        sparklineRange: '1d',
        sparklineInterval: '15m'
      };
    } catch (err) {
      console.log('[markets:market-summary] sparkline fetch failed', JSON.stringify({
        symbol: item.symbol,
        message: err instanceof Error ? err.message : String(err)
      }));
      enriched[index] = {
        ...item,
        sparkline: [],
        sparklineRange: '1d',
        sparklineInterval: '15m'
      };
    }
  });

  return enriched;
}

export async function handleMarketSummary(env, region, forceRefresh) {
  const normalizedRegion = String(region || 'US').trim().toUpperCase() || 'US';
  if (!/^[A-Z_]{2,24}$/.test(normalizedRegion)) {
    return errorJson('invalid region', 400);
  }
  const key = 'market-summary:' + normalizedRegion;
  if (!forceRefresh) {
    const cached = await kvGetJson(env, key);
    if (isValidMarketSummaryCache(cached, normalizedRegion)) {
      return json({ ...cached, cached: true, cache: { hit: true, source: 'kv' } });
    }
    if (isKvCacheEnabled(env) && !shouldFetchLiveOnMiss(env)) {
      return errorJson('kv cache miss', 503, { key });
    }
  }
  const payload = {
    ...(await fetchYahooMarketSummary({
      market: MARKET_SUMMARY_CONFIG[normalizedRegion]?.market || normalizedRegion,
      region: normalizedRegion,
      yahooRegion: MARKET_SUMMARY_CONFIG[normalizedRegion]?.yahooRegion,
      title: MARKET_SUMMARY_CONFIG[normalizedRegion]?.title
    })),
    source: 'yahoo-market-summary'
  };
  payload.items = await enrichMarketSummarySparklines(payload.items);
  await kvPutJson(env, key, payload, { ttlSeconds: CACHE_TTL.marketSummary });
  return json({ ...payload, cached: false });
}
