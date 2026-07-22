import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fillCnBatchQuotes } from '../workers/markets/src/cnBatchQuotes.js';
import { quoteCacheKey } from '../workers/markets/src/quoteCache.js';

function createEnvWithQuoteCache(entries = {}, { r2Payloads = {} } = {}) {
  const store = new Map(Object.entries(entries));
  const r2Store = new Map(Object.entries(r2Payloads));
  let r2Reads = 0;
  return {
    store,
    get r2Reads() { return r2Reads; },
    MARKETS_KV: {
      async get(key) { return store.get(key) || null; },
      async put(key, value) { store.set(key, value); }
    },
    MARKETS_R2: {
      async get(key) {
        r2Reads += 1;
        const payload = r2Store.get(key);
        if (!payload) return null;
        return { text: async () => JSON.stringify(payload) };
      },
      async put(key, value) { r2Store.set(key, JSON.parse(value)); }
    },
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

test('batch CN quotes use one Tencent request when Xueqiu is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const fields = Array.from({ length: 38 }, () => '');
  fields[0] = '1';
  fields[1] = '标普500ETF';
  fields[2] = '513500';
  fields[3] = '2.51';
  fields[4] = '2.5';
  fields[5] = '2.5';
  fields[30] = '20260722123000';
  fields[31] = '0.01';
  fields[32] = '0.4';
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).includes('qt.gtimg.cn')) {
      return new Response(new TextEncoder().encode(`v_sz513500="${fields.join('~')}";`), { status: 200 });
    }
    throw new Error('unexpected Xueqiu request');
  };
  const env = createEnvWithQuoteCache();
  delete env.XUEQIU_COOKIE;
  const out = {};
  try {
    await fillCnBatchQuotes(env, [{ raw: '513500', code: 'sz513500' }], out);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requested.length, 1);
  assert.match(requested[0], /qt\.gtimg\.cn/);
  assert.equal(out['513500'].price, 2.51);
  assert.equal(out['513500'].source, 'tencent-quote');
  assert.equal(out['513500'].fallback, 'tencent-price');
});

test('batch CN quotes hydrate close high point from R2 only when requested', async () => {
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
  const cachedQuote = {
    symbol: 'sh513500',
    code: '513500',
    market: 'cn',
    name: '标普500ETF博时',
    price: 2.5,
    latestNav: 2.4,
    premiumPercent: 3.8,
    source: 'xueqiu-quote',
    cachedAt: new RealDate(fixedNowMs).toISOString(),
    highPoint: { high: 2.7, highDate: '2026-06-02', source: 'daily-kline-365d' }
  };
  const env = createEnvWithQuoteCache({
    [quoteCacheKey('sh513500')]: JSON.stringify(cachedQuote)
  }, {
    r2Payloads: {
      'kline/cn/sh513500/1d.json': {
        interval: '1d',
        candles: [
          { t: RealDate.parse('2026-06-02T15:00:00+08:00') / 1000, h: 2.7, c: 2.6 },
          { t: RealDate.parse('2026-06-04T15:00:00+08:00') / 1000, h: 2.65, c: 2.63 }
        ]
      }
    }
  });

  try {
    globalThis.Date = FakeDate;
    const outWithoutHydration = {};
    await fillCnBatchQuotes(env, [{ raw: '513500', code: 'sh513500' }], outWithoutHydration);
    assert.equal(outWithoutHydration['513500'].closeHighPoint, undefined);
    assert.equal(env.r2Reads, 0);

    const outWithHydration = {};
    await fillCnBatchQuotes(env, [{ raw: '513500', code: 'sh513500' }], outWithHydration, { hydrateHighPoints: true });
    assert.equal(outWithHydration['513500'].closeHighPoint.high, 2.63);
    assert.equal(outWithHydration['513500'].closeHighPoint.highDate, '2026-06-04');
    assert.equal(env.r2Reads, 1);
    assert.equal(JSON.parse(env.store.get('kline-close-high:cn:sh513500:1d')).high, 2.63);
  } finally {
    globalThis.Date = RealDate;
  }
});
