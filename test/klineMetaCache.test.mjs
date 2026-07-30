import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleBatchQuotes } from '../workers/markets/src/otcBatchQuotes.js';
import { quoteCacheKey, writeQuoteCache } from '../workers/markets/src/quoteCache.js';
import { buildKlineMeta, klineMetaCacheKey, writeKlineMetaCache } from '../workers/markets/src/klineMetaCache.js';

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

test('K-line metadata stores the full daily drawdown series for live price percentile calculation', () => {
  const meta = buildKlineMeta({
    candles: [
      { date: '2026-07-01', c: 1 },
      { date: '2026-07-02', c: 2 },
      { date: '2026-07-03', c: 1.5 },
      { date: '2026-07-06', c: 1.8 },
    ],
    highPoint: { high: 2, highDate: '2026-07-02', source: 'daily-kline-365d' },
    closeHighPoint: { high: 2, highDate: '2026-07-02', source: 'daily-close-kline-365d' },
    generatedAt: '2026-07-06T08:00:00.000Z',
  }, { market: 'cn', symbol: '513100', now: Date.parse('2026-07-06T08:00:00.000Z') });

  assert.deepEqual(meta.drawdownSamples, [0, 0, -25, -10]);
  assert.equal(meta.drawdownReferenceHigh, 2);
  // Current DD is -10%; three of four historical DDs are >= -10%.
  assert.equal(meta.drawdownPercentile, 75);
});

test('quotes list reads kline-meta KV and never hydrates high points from R2', async () => {
  const env = createEnv();
  await writeQuoteCache(env, '513100', {
    code: '513100', symbol: 'sh513100', market: 'cn', price: 1.2, source: 'xueqiu-quote'
  }, { ttlSeconds: 120 });

  const missingMeta = await handleBatchQuotes(env, '513100');
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
  const withMeta = await handleBatchQuotes(env, '513100');
  const withMetaPayload = await withMeta.json();
  assert.equal(env.r2Reads, 0);
  assert.equal(withMetaPayload.quotes['513100'].highPoint.high, 1.5);
  assert.equal(env.store.has(klineMetaCacheKey('cn', 'sh513100', '1d')), true);
  assert.equal(env.store.has(quoteCacheKey('513100')), true);
});
