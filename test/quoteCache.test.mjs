import { test } from 'node:test';
import assert from 'node:assert/strict';

import { quoteCacheKey, readFreshQuoteCache, writeQuoteCache } from '../workers/markets/src/quoteCache.js';

function createEnv() {
  const store = new Map();
  return {
    store,
    env: {
      MARKETS_KV: {
        async get(key) { return store.get(key) || null; },
        async put(key, value) { store.set(key, value); }
      }
    }
  };
}

test('quote cache reads fresh CN xueqiu quotes only', async () => {
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
