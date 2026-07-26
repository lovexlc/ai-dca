import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isUsableQuoteCache,
  isNewerOtcQuote,
  quoteCacheKey,
  quoteCacheTtlSeconds,
  readFreshQuoteCacheMap,
  readQuoteCacheEntry,
  readFreshQuoteCache,
  readStaleQuoteCache,
  writeQuoteCache
} from '../workers/markets/src/quoteCache.js';
import { createCacheEnvelope } from '../workers/markets/src/cachePolicy.js';

function createEnv() {
  const store = new Map();
  return {
    store,
    puts: [],
    env: {
      MARKETS_KV: {
        async get(key) { return store.get(key) || null; },
        async put(key, value, opts) {
          store.set(key, value);
          this.puts?.push?.({ key, value, opts });
        },
        puts: []
      }
    }
  };
}

function setQuote(store, code, market, payload) {
  const fetchedAt = Date.parse(String(
    market === 'otc' || market === 'qdii'
      ? (payload.asOf || payload.cachedAt || '')
      : (payload.cachedAt || payload.asOf || '')
  )) || Date.now();
  const validMs = market === 'cn' ? 120 * 1000 : market === 'us' ? 30 * 60 * 1000 : 24 * 3600 * 1000;
  const staleMs = market === 'cn' ? 6 * 3600 * 1000 : market === 'us' ? 2 * 3600 * 1000 : 7 * 24 * 3600 * 1000;
  const envelope = createCacheEnvelope({
    key: quoteCacheKey(code),
    market,
    fundKind: market === 'otc' || market === 'qdii' ? market : '',
    source: payload.source || 'test',
    fetchedAt: new Date(fetchedAt),
    asOf: payload.asOf || payload.cachedAt || new Date(fetchedAt),
    validUntil: new Date(fetchedAt + validMs),
    staleUntil: new Date(fetchedAt + staleMs),
    payload
  });
  store.set(quoteCacheKey(code), JSON.stringify(envelope));
}

test('quote cache reads fresh CN Xueqiu or Tencent quotes and rejects unknown sources', async () => {
  const { env, store } = createEnv();
  setQuote(store, 'sh513100', 'cn', {
    symbol: 'sh513100',
    price: 2.1,
    source: 'xueqiu-quote',
    asOf: new Date().toISOString()
  });

  const cached = await readFreshQuoteCache(env, 'sh513100', 'cn');
  assert.equal(cached.price, 2.1);

  setQuote(store, 'sh513100', 'cn', {
    symbol: 'sh513100',
    price: 2.2,
    source: 'tencent-quote',
    asOf: new Date().toISOString()
  });
  assert.equal((await readFreshQuoteCache(env, 'sh513100', 'cn')).price, 2.2);

  setQuote(store, 'sh513100', 'cn', {
    symbol: 'sh513100',
    price: 2.1,
    source: 'fallback',
    asOf: new Date().toISOString()
  });
  assert.equal(await readFreshQuoteCache(env, 'sh513100', 'cn'), null);
});

test('quote cache ignores stale quotes and empty writes', async () => {
  const { env, store } = createEnv();
  setQuote(store, 'QQQ', 'us', {
    symbol: 'QQQ',
    price: 500,
    asOf: new Date(Date.now() - 31 * 60 * 1000).toISOString()
  });
  assert.equal(await readFreshQuoteCache(env, 'QQQ', 'us'), null);

  await writeQuoteCache(env, '', { symbol: 'QQQ', price: 500 });
  assert.equal(store.has(quoteCacheKey('')), false);

  await writeQuoteCache(env, 'QQQ', { symbol: 'QQQ', price: 500, asOf: new Date().toISOString() });
  assert.equal((await readFreshQuoteCache(env, 'QQQ', 'us')).price, 500);
});

test('quote cache reads stale CN quotes only within stale retention', async () => {
  const { env, store } = createEnv();
  setQuote(store, 'sh513500', 'cn', {
    symbol: 'sh513500',
    price: 2.5,
    premiumPercent: 3.5,
    source: 'xueqiu-quote',
    cachedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString()
  });
  assert.equal(await readFreshQuoteCache(env, 'sh513500', 'cn', { maxAgeMs: 120 * 1000 }), null);
  assert.equal((await readStaleQuoteCache(env, 'sh513500', 'cn')).premiumPercent, 3.5);

  setQuote(store, 'sh513500', 'cn', {
    symbol: 'sh513500',
    price: 2.5,
    premiumPercent: 3.5,
    source: 'fallback',
    cachedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString()
  });
  assert.equal(await readStaleQuoteCache(env, 'sh513500', 'cn'), null);

  setQuote(store, 'sh513500', 'cn', {
    symbol: 'sh513500',
    price: 2.5,
    premiumPercent: 3.5,
    source: 'xueqiu-quote',
    cachedAt: new Date(Date.now() - 7 * 3600 * 1000).toISOString()
  });
  assert.equal(await readStaleQuoteCache(env, 'sh513500', 'cn'), null);
});

test('quote cache stores CN quotes long enough for stale fallback', async () => {
  const { env } = createEnv();
  await writeQuoteCache(env, 'sh513500', {
    symbol: 'sh513500',
    market: 'cn',
    price: 2.5,
    source: 'xueqiu-quote'
  }, { ttlSeconds: 120 });
  const put = env.MARKETS_KV.puts.at(-1);
  assert.equal(put.key, quoteCacheKey('sh513500'));
  assert.equal(put.opts.expirationTtl, 6 * 3600);
});

test('CN quote cache TTL follows trading sessions', () => {
  assert.equal(
    quoteCacheTtlSeconds('cn', { date: new Date('2026-07-07T02:00:00Z') }),
    120
  );
  assert.equal(
    quoteCacheTtlSeconds('cn', { date: new Date('2026-07-07T00:20:00Z') }),
    70 * 60
  );
  assert.equal(
    quoteCacheTtlSeconds('cn', { date: new Date('2026-07-07T04:00:00Z') }),
    60 * 60
  );
});

test('CN intraday quote cache expires after close while stale fallback remains available', () => {
  const cached = {
    source: 'xueqiu-quote',
    price: 2.131,
    cachedAt: '2026-07-23T06:58:42.481Z' // 14:58:42 Shanghai
  };
  const afterClose = Date.parse('2026-07-23T10:58:00.000Z'); // 18:58 Shanghai

  assert.equal(isUsableQuoteCache(cached, 'cn', { now: afterClose }), false);
  assert.equal(isUsableQuoteCache(cached, 'cn', { allowStale: true, now: afterClose }), true);
  assert.equal(
    isUsableQuoteCache({ ...cached, cachedAt: '2026-07-23T07:10:00.000Z' }, 'cn', { now: afterClose }),
    true
  );
});

test('quote cache freshness uses cachedAt when market quote time is old', async () => {
  const { env, store } = createEnv();
  setQuote(store, '510300', 'cn', {
    symbol: 'sh510300',
    price: 4.8,
    source: 'xueqiu-quote',
    asOf: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    cachedAt: new Date().toISOString()
  });

  const cached = await readFreshQuoteCache(env, '510300', 'cn', { maxAgeMs: 3600 * 1000 });
  assert.equal(cached.price, 4.8);
});

test('OTC quote cache requires Danjuan source and uses source asOf over wrapper cachedAt', async () => {
  const { env, store } = createEnv();
  const oldAsOf = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  setQuote(store, '000834', 'otc', {
    symbol: '000834',
    latestNav: 1.2,
    source: 'danjuan',
    asOf: oldAsOf,
    // This is the timestamp written by the old buggy path. It must not
    // make an old Danjuan result fresh again.
    cachedAt: new Date().toISOString()
  });
  assert.equal(await readFreshQuoteCache(env, '000834', 'otc'), null);

  setQuote(store, '000834', 'otc', {
    symbol: '000834',
    latestNav: 1.2,
    source: 'xueqiu-quote',
    asOf: new Date().toISOString()
  });
  assert.equal(await readFreshQuoteCache(env, '000834', 'otc'), null);

  setQuote(store, '000834', 'otc', {
    symbol: '000834',
    latestNav: 1.2,
    source: 'danjuan',
    asOf: new Date().toISOString()
  });
  assert.equal((await readFreshQuoteCache(env, '000834', 'otc')).latestNav, 1.2);
});

test('OTC cache write waits for a newer published NAV date', () => {
  const previous = {
    source: 'danjuan',
    latestNav: 1.2,
    latestNavDate: '2026-07-21',
    asOf: '2026-07-21T12:30:00.000Z'
  };
  assert.equal(isNewerOtcQuote({
    source: 'danjuan',
    latestNav: 1.2,
    latestNavDate: '2026-07-21',
    asOf: '2026-07-22T12:30:00.000Z'
  }, previous), false);
  assert.equal(isNewerOtcQuote({
    source: 'danjuan',
    latestNav: 1.21,
    latestNavDate: '2026-07-22',
    asOf: '2026-07-22T12:30:00.000Z'
  }, previous), true);
});

test('batch and single quote reads share one canonical CN key', async () => {
  const { env, store } = createEnv();
  await writeQuoteCache(env, 'sh513100', {
    code: '513100',
    symbol: 'sh513100',
    market: 'cn',
    price: 1.2,
    source: 'xueqiu-quote'
  }, { ttlSeconds: 120 });

  assert.equal(store.has('quote:513100'), true);
  assert.equal(store.has('quote:sh513100'), false);
  assert.equal((await readFreshQuoteCache(env, '513100', 'cn')).price, 1.2);
  assert.equal((await readFreshQuoteCacheMap(env, [{ code: 'sh513100', market: 'cn' }]))['quote:513100'].price, 1.2);
});

test('version 2 quote cache exposes delayed and rejects malformed envelopes', async () => {
  const { env, store } = createEnv();
  await writeQuoteCache(env, '000834', {
    code: '000834',
    symbol: '000834',
    market: 'otc',
    latestNav: 1.2,
    latestNavDate: '2026-07-20',
    source: 'danjuan',
    asOf: new Date().toISOString()
  }, { ttlSeconds: 24 * 3600, fundKind: 'otc' });
  const entry = await readQuoteCacheEntry(env, '000834', 'otc');
  assert.equal(entry.status, 'delayed');
  assert.equal(entry.payload.latestNav, 1.2);

  const raw = JSON.parse(store.get('quote:000834'));
  store.set('quote:000834', JSON.stringify({ ...raw, source: 'wrong-source' }));
  assert.equal((await readQuoteCacheEntry(env, '000834', 'otc')).status, 'miss');
});
