import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isNewerOtcQuote,
  quoteCacheKey,
  quoteCacheTtlSeconds,
  readFreshQuoteCache,
  readStaleQuoteCache,
  writeQuoteCache
} from '../workers/markets/src/quoteCache.js';

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

test('quote cache reads fresh CN Xueqiu or Tencent quotes and rejects unknown sources', async () => {
  const { env, store } = createEnv();
  store.set(quoteCacheKey('sh513100'), JSON.stringify({
    symbol: 'sh513100',
    price: 2.1,
    source: 'xueqiu-quote',
    asOf: new Date().toISOString()
  }));

  const cached = await readFreshQuoteCache(env, 'sh513100', 'cn');
  assert.equal(cached.price, 2.1);

  store.set(quoteCacheKey('sh513100'), JSON.stringify({
    symbol: 'sh513100',
    price: 2.2,
    source: 'tencent-quote',
    asOf: new Date().toISOString()
  }));
  assert.equal((await readFreshQuoteCache(env, 'sh513100', 'cn')).price, 2.2);

  store.set(quoteCacheKey('sh513100'), JSON.stringify({
    symbol: 'sh513100',
    price: 2.1,
    source: 'fallback',
    asOf: new Date().toISOString()
  }));
  assert.equal(await readFreshQuoteCache(env, 'sh513100', 'cn'), null);
});

test('quote cache ignores stale quotes and empty writes', async () => {
  const { env, store } = createEnv();
  store.set(quoteCacheKey('QQQ'), JSON.stringify({
    symbol: 'QQQ',
    price: 500,
    asOf: new Date(Date.now() - 120000).toISOString()
  }));
  assert.equal(await readFreshQuoteCache(env, 'QQQ', 'us'), null);

  await writeQuoteCache(env, '', { symbol: 'QQQ', price: 500 });
  assert.equal(store.has(quoteCacheKey('')), false);

  await writeQuoteCache(env, 'QQQ', { symbol: 'QQQ', price: 500, asOf: new Date().toISOString() });
  assert.equal((await readFreshQuoteCache(env, 'QQQ', 'us')).price, 500);
});

test('quote cache reads stale CN quotes only within stale retention', async () => {
  const { env, store } = createEnv();
  store.set(quoteCacheKey('sh513500'), JSON.stringify({
    symbol: 'sh513500',
    price: 2.5,
    premiumPercent: 3.5,
    source: 'xueqiu-quote',
    cachedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString()
  }));
  assert.equal(await readFreshQuoteCache(env, 'sh513500', 'cn', { maxAgeMs: 120 * 1000 }), null);
  assert.equal((await readStaleQuoteCache(env, 'sh513500', 'cn')).premiumPercent, 3.5);

  store.set(quoteCacheKey('sh513500'), JSON.stringify({
    symbol: 'sh513500',
    price: 2.5,
    premiumPercent: 3.5,
    source: 'fallback',
    cachedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString()
  }));
  assert.equal(await readStaleQuoteCache(env, 'sh513500', 'cn'), null);

  store.set(quoteCacheKey('sh513500'), JSON.stringify({
    symbol: 'sh513500',
    price: 2.5,
    premiumPercent: 3.5,
    source: 'xueqiu-quote',
    cachedAt: new Date(Date.now() - 7 * 3600 * 1000).toISOString()
  }));
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

test('quote cache freshness uses cachedAt when market quote time is old', async () => {
  const { env, store } = createEnv();
  store.set(quoteCacheKey('510300'), JSON.stringify({
    symbol: 'sh510300',
    price: 4.8,
    source: 'xueqiu-quote',
    asOf: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    cachedAt: new Date().toISOString()
  }));

  const cached = await readFreshQuoteCache(env, '510300', 'cn', { maxAgeMs: 3600 * 1000 });
  assert.equal(cached.price, 4.8);
});

test('OTC quote cache requires Danjuan source and uses source asOf over wrapper cachedAt', async () => {
  const { env, store } = createEnv();
  const oldAsOf = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  store.set(quoteCacheKey('000834'), JSON.stringify({
    symbol: '000834',
    latestNav: 1.2,
    source: 'danjuan',
    asOf: oldAsOf,
    // This is the timestamp written by the old buggy path. It must not
    // make an old Danjuan result fresh again.
    cachedAt: new Date().toISOString()
  }));
  assert.equal(await readFreshQuoteCache(env, '000834', 'otc'), null);

  store.set(quoteCacheKey('000834'), JSON.stringify({
    symbol: '000834',
    latestNav: 1.2,
    source: 'xueqiu-quote',
    asOf: new Date().toISOString()
  }));
  assert.equal(await readFreshQuoteCache(env, '000834', 'otc'), null);

  store.set(quoteCacheKey('000834'), JSON.stringify({
    symbol: '000834',
    latestNav: 1.2,
    source: 'danjuan',
    asOf: new Date().toISOString()
  }));
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
