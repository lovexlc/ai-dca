import { errorJson, json } from './marketRuntime.js';
import { fetchYahooMarketSummary } from './fetchers.js';
import { kvGetJson, kvPutJson } from './storage.js';
import { CACHE_TTL, isKvCacheEnabled, shouldFetchLiveOnMiss } from './kvCache.js';

const MAX_MARKET_SUMMARY_CACHE_AGE_MS = CACHE_TTL.marketSummary * 1000 * 3;

function isValidMarketSummaryCache(value, region) {
  if (!value || value.source !== 'yahoo-market-summary') return false;
  if (String(value.region || '').toUpperCase() !== region) return false;
  if (!Array.isArray(value.items)) return false;
  const generatedAtMs = Date.parse(value.generatedAt || '');
  if (!Number.isFinite(generatedAtMs)) return false;
  const ageMs = Date.now() - generatedAtMs;
  return ageMs >= -60_000 && ageMs <= MAX_MARKET_SUMMARY_CACHE_AGE_MS;
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
    ...(await fetchYahooMarketSummary({ market: normalizedRegion, region: normalizedRegion })),
    source: 'yahoo-market-summary'
  };
  await kvPutJson(env, key, payload, { ttlSeconds: CACHE_TTL.marketSummary });
  return json({ ...payload, cached: false });
}
