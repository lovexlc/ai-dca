import { errorJson, fetchCnQuotesBatchWithFallback, json } from './marketRuntime.js';
import { fetchYahooQuotesBatch, searchEastmoneySymbols, searchYahooSymbols } from './fetchers.js';
import { fetchCnnFearGreed } from './newsFetchers.js';
import { CN_INDICES, US_INDICES, US_SECTORS } from './symbols.js';
import { kvGetJson, kvPutJson } from './storage.js';
import {
  REDIS_TTL,
  isRedisEnabled,
  redisGetJson,
  redisSetJson,
  shouldFetchLiveOnMiss
} from './redisCache.js';

export async function handleIndices(env, market, forceRefresh) {
  const key = 'idx:' + market;
  const redisKeyName = 'indices:' + market;
  if (!forceRefresh) {
    const redisCached = await redisGetJson(env, redisKeyName);
    if (redisCached && Array.isArray(redisCached.indexes) && redisCached.indexes.length) {
      return json({ ...redisCached, cached: true, cache: { hit: true, source: 'redis' } });
    }
    if (isRedisEnabled(env) && !shouldFetchLiveOnMiss(env)) {
      return errorJson('redis cache miss', 503, { key: redisKeyName });
    }
    const cached = await kvGetJson(env, key);
    if (cached && cached.indexes && cached.indexes.length) {
      await redisSetJson(env, redisKeyName, cached, { ttlSeconds: REDIS_TTL.indices }).catch(() => false);
      return json({ ...cached, cached: true });
    }
  }
  const fresh = await refreshIndices(env, market);
  return json({ ...fresh, cached: false });
}

async function refreshIndices(env, market) {
  let indexes = [];
  if (market === 'us') {
    const symbols = US_INDICES.map((it) => it.symbol);
    const quoteMap = await fetchYahooQuotesBatch(symbols, { range: '1d', interval: '5m' });
    indexes = US_INDICES.map((it) => {
      const q = quoteMap[it.symbol] || {};
      return { ...q, key: it.key, name: it.name, symbol: it.symbol };
    });
    try {
      const fng = await fetchCnnFearGreed();
      if (fng) indexes.push({ ...fng, key: 'cnn_fng' });
    } catch (err) {
      console.warn('cnn fng fetch failed', (err && err.message) || err);
    }
  } else if (market === 'cn') {
    const cnIndexItems = CN_INDICES.map((it) => ({ raw: it.symbol, code: it.symbol }));
    const quoteMap = await fetchCnQuotesBatchWithFallback(env, cnIndexItems);
    indexes = CN_INDICES.map((it) => {
      const q = quoteMap[it.symbol] || {};
      return { ...q, key: it.key, name: it.name, symbol: it.symbol };
    });
  } else {
    throw new Error('unknown market ' + market);
  }
  const payload = { market, generatedAt: new Date().toISOString(), indexes };
  await kvPutJson(env, 'idx:' + market, payload, { ttlSeconds: 120 });
  await redisSetJson(env, 'indices:' + market, payload, { ttlSeconds: REDIS_TTL.indices }).catch(() => false);
  return payload;
}

export async function handleSectors(env, market, forceRefresh) {
  if (market !== 'us') {
    return json({ market, generatedAt: new Date().toISOString(), sectors: [], cached: false });
  }
  const key = 'sec:' + market;
  const redisKeyName = 'sectors:' + market;
  if (!forceRefresh) {
    const redisCached = await redisGetJson(env, redisKeyName);
    if (redisCached && Array.isArray(redisCached.sectors) && redisCached.sectors.length) {
      return json({ ...redisCached, cached: true, cache: { hit: true, source: 'redis' } });
    }
    if (isRedisEnabled(env) && !shouldFetchLiveOnMiss(env)) {
      return errorJson('redis cache miss', 503, { key: redisKeyName });
    }
    const cached = await kvGetJson(env, key);
    if (cached && Array.isArray(cached.sectors) && cached.sectors.length) {
      await redisSetJson(env, redisKeyName, cached, { ttlSeconds: REDIS_TTL.sectors }).catch(() => false);
      return json({ ...cached, cached: true });
    }
  }
  const fresh = await refreshSectors(env, market);
  return json({ ...fresh, cached: false });
}

async function refreshSectors(env, market) {
  const symbols = US_SECTORS.map((it) => it.symbol);
  const quoteMap = await fetchYahooQuotesBatch(symbols, { range: '1d', interval: '5m' });
  const sectors = US_SECTORS.map((it) => {
    const q = quoteMap[it.symbol] || {};
    return {
      ...q,
      key: it.key,
      name: it.name,
      symbol: it.symbol,
      shortCode: it.shortCode
    };
  });
  const payload = { market, generatedAt: new Date().toISOString(), sectors };
  await kvPutJson(env, 'sec:' + market, payload, { ttlSeconds: 120 });
  await redisSetJson(env, 'sectors:' + market, payload, { ttlSeconds: REDIS_TTL.sectors }).catch(() => false);
  return payload;
}

export async function handleSearch(env, market, query, limitParam) {
  const q = String(query || '').trim();
  const limit = Math.max(1, Math.min(Number(limitParam) || 8, 12));
  if (!q) return json({ market, query: q, results: [] });
  if (market !== 'us' && market !== 'cn') return errorJson('unknown market ' + market, 400);
  const cacheKey = 'search:' + market + ':' + q.toLowerCase() + ':' + limit;
  const redisCached = await redisGetJson(env, cacheKey);
  if (redisCached && Array.isArray(redisCached.results)) return json({ ...redisCached, cached: true, cache: { hit: true, source: 'redis' } });
  if (isRedisEnabled(env) && !shouldFetchLiveOnMiss(env)) {
    return errorJson('redis cache miss', 503, { key: cacheKey });
  }
  const cached = await kvGetJson(env, cacheKey);
  if (cached && Array.isArray(cached.results)) {
    await redisSetJson(env, cacheKey, cached, { ttlSeconds: REDIS_TTL.search }).catch(() => false);
    return json({ ...cached, cached: true });
  }
  const results = market === 'cn'
    ? await searchEastmoneySymbols(q, { limit })
    : await searchYahooSymbols(q, { limit });
  const payload = { market, query: q, generatedAt: new Date().toISOString(), results };
  await kvPutJson(env, cacheKey, payload, { ttlSeconds: 3600 });
  await redisSetJson(env, cacheKey, payload, { ttlSeconds: REDIS_TTL.search }).catch(() => false);
  return json({ ...payload, cached: false });
}
