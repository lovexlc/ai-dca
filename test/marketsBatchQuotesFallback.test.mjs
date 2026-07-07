import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fillCnBatchQuotes } from '../workers/markets/src/cnBatchQuotes.js';
import { quoteCacheKey } from '../workers/markets/src/quoteCache.js';

function createEnvWithQuoteCache(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    MARKETS_KV: {
      async get(key) { return store.get(key) || null; },
      async put(key, value) { store.set(key, value); }
    },
    MARKETS_R2: null,
    XUEQIU_COOKIE: 'xq_a_token=test'
  };
}

test('batch CN quotes fall back to stale xueqiu quote when live fetch fails', async () => {
  const originalFetch = globalThis.fetch;
  const RealDate = globalThis.Date;
  const fixedNowMs = RealDate.parse('2026-07-07T02:00:00.000Z');
  class FakeDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNowMs]));
    }
    static now() { return fixedNowMs; }
    static parse(value) { return RealDate.parse(value); }
    static UTC(...args) { return RealDate.UTC(...args); }
  }
  globalThis.fetch = async () => new Response('upstream unavailable', { status: 503 });
  globalThis.Date = FakeDate;
  const staleQuote = {
    symbol: 'sh513500',
    code: '513500',
    market: 'cn',
    name: '标普500ETF博时',
    price: 2.5,
    latestNav: 2.4,
    premiumPercent: 3.8,
    source: 'xueqiu-quote',
    cachedAt: new RealDate(fixedNowMs - 10 * 60 * 1000).toISOString(),
    highPoint: { high: 2.7, highDate: '2026-06-02', source: 'daily-kline-365d' }
  };
  const env = createEnvWithQuoteCache({
    [quoteCacheKey('sh513500')]: JSON.stringify(staleQuote)
  });
  const out = {};

  try {
    await fillCnBatchQuotes(env, [{ raw: '513500', code: 'sh513500' }], out);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = RealDate;
  }

  assert.equal(out['513500'].price, 2.5);
  assert.equal(out['513500'].premiumPercent, 3.8);
  assert.equal(out['513500'].highPoint.high, 2.7);
  assert.equal(out['513500'].stale, true);
  assert.equal(out['513500'].cache.source, 'kv-stale');
});
