import { test } from 'node:test';
import assert from 'node:assert/strict';

import marketsWorker from '../workers/markets/src/index.js';
import { quoteCacheKey, writeQuoteCache } from '../workers/markets/src/quoteCache.js';
import { klineMetaCacheKey, writeKlineMetaCache } from '../workers/markets/src/klineMetaCache.js';

function createEnv() {
  const store = new Map();
  let r2Reads = 0;
  const env = {
    store,
    MARKETS_DATA_READ_MODE: 'cache-first',
    MARKETS_KV: {
      async get(key, options) {
        if (Array.isArray(key)) {
          const out = new Map();
          for (const item of key) {
            const raw = store.get(item);
            if (raw != null) out.set(item, options?.type === 'json' ? JSON.parse(raw) : raw);
          }
          return out;
        }
        const raw = store.get(key);
        if (raw == null) return null;
        return options?.type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key, value) { store.set(key, value); }
    },
    MARKETS_R2: {
      async get() {
        r2Reads += 1;
        throw new Error('list must not read R2');
      }
    },
    get r2Reads() { return r2Reads; }
  };
  return env;
}

test('quotes list reads kline-meta KV and never hydrates high points from R2', async () => {
  const env = createEnv();
  await writeQuoteCache(env, '513100', {
    code: '513100', symbol: 'sh513100', market: 'cn', price: 1.2, source: 'xueqiu-quote'
  }, { ttlSeconds: 120 });

  const missingMeta = await marketsWorker.fetch(
    new Request('https://api.test/api/markets/quotes?symbols=513100&hydrateHighPoints=1'), env, {}
  );
  const missingPayload = await missingMeta.json();
  assert.equal(env.r2Reads, 0);
  assert.equal(missingPayload.quotes['513100'].highPoint, undefined);

  await writeKlineMetaCache(env, {
    market: 'cn',
    symbol: 'sh513100',
    meta: {
      highPoint: { high: 1.5, highDate: '2026-07-01', source: 'daily-kline-365d' },
      closeHighPoint: { high: 1.45, highDate: '2026-07-02', source: 'daily-close-kline-365d' },
      latestBarDate: '2026-07-22',
      generatedAt: new Date().toISOString()
    }
  });
  const withMeta = await marketsWorker.fetch(
    new Request('https://api.test/api/markets/quotes?symbols=513100'), env, {}
  );
  const withMetaPayload = await withMeta.json();
  assert.equal(env.r2Reads, 0);
  assert.equal(withMetaPayload.quotes['513100'].highPoint.high, 1.5);
  assert.equal(env.store.has(klineMetaCacheKey('cn', 'sh513100', '1d')), true);
  assert.equal(env.store.has(quoteCacheKey('513100')), true);
});
