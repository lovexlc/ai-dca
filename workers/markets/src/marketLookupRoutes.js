import { errorJson, fetchCnQuotesBatchWithFallback, json } from './marketRuntime.js';
import { fetchYahooQuotesBatch, searchEastmoneySymbols, searchYahooSymbols } from './fetchers.js';
import { fetchCnnFearGreed } from './newsFetchers.js';
import { CN_INDICES, US_INDICES, US_SECTORS } from './symbols.js';
import { kvGetJson, kvPutJson } from './storage.js';
import {
  CACHE_TTL,
  isKvCacheEnabled,
  kvCacheGetJson,
  kvCacheSetJson,
  shouldFetchLiveOnMiss
} from './kvCache.js';

export async function handleIndices(env, market, forceRefresh) {
  const key = 'idx:' + market;
  if (!forceRefresh) {
    const cached = await kvGetJson(env, key);
    if (cached && cached.indexes && cached.indexes.length) {
      return json({ ...cached, cached: true, cache: { hit: true, source: 'kv' } });
    }
    if (isKvCacheEnabled(env) && !shouldFetchLiveOnMiss(env)) {
      return errorJson('kv cache miss', 503, { key });
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
  await kvPutJson(env, 'idx:' + market, payload, { ttlSeconds: CACHE_TTL.indices });
  return payload;
}

export async function handleSectors(env, market, forceRefresh) {
  if (market !== 'us') {
    return json({ market, generatedAt: new Date().toISOString(), sectors: [], cached: false });
  }
  const key = 'sec:' + market;
  if (!forceRefresh) {
    const cached = await kvGetJson(env, key);
    if (cached && Array.isArray(cached.sectors) && cached.sectors.length) {
      return json({ ...cached, cached: true, cache: { hit: true, source: 'kv' } });
    }
    if (isKvCacheEnabled(env) && !shouldFetchLiveOnMiss(env)) {
      return errorJson('kv cache miss', 503, { key });
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
  await kvPutJson(env, 'sec:' + market, payload, { ttlSeconds: CACHE_TTL.sectors });
  return payload;
}

export async function handleSearch(env, market, query, limitParam) {
  const q = String(query || '').trim();
  const limit = Math.max(1, Math.min(Number(limitParam) || 8, 12));
  if (!q) return json({ market, query: q, results: [] });
  if (market !== 'us' && market !== 'cn') return errorJson('unknown market ' + market, 400);
  const cacheKey = 'search:' + market + ':' + q.toLowerCase() + ':' + limit;
  const cached = await kvCacheGetJson(env, cacheKey);
  if (cached && Array.isArray(cached.results)) {
    return json({ ...cached, cached: true, cache: { hit: true, source: 'kv' } });
  }
  if (isKvCacheEnabled(env) && !shouldFetchLiveOnMiss(env)) {
    return errorJson('kv cache miss', 503, { key: cacheKey });
  }
  const results = market === 'cn'
    ? await searchEastmoneySymbols(q, { limit })
    : await searchYahooSymbols(q, { limit });
  const payload = { market, query: q, generatedAt: new Date().toISOString(), results };
  await kvCacheSetJson(env, cacheKey, payload, { ttlSeconds: CACHE_TTL.search }).catch(() => false);
  return json({ ...payload, cached: false });
}
