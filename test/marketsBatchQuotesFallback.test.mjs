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
    if (String(url).includes('qt.gtimg.cn')) {
      requested.push(String(url));
      return new Response(new TextEncoder().encode(`v_sz513500="${fields.join('~')}";`), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
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

test('batch CN quotes alert when Tencent successfully handles a Xueqiu fallback', async () => {
  const originalFetch = globalThis.fetch;
  const store = new Map();
  const requests = [];
  const notifyRequests = [];
  const fields = Array(33).fill('');
  fields[0] = '1';
  fields[1] = '纳指ETF';
  fields[2] = '513100';
  fields[3] = '1.2300';
  fields[4] = '1.2200';
  fields[31] = '0.0100';
  fields[32] = '0.8197';

  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).startsWith('https://qt.gtimg.cn/')) {
      return new Response(`v_sh513100="${fields.join('~')}";`, { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const env = {
    MARKETS_KV: {
      async get(key) { return store.get(key) || null; },
      async put(key, value) { store.set(key, value); }
    },
    MARKETS_ADMIN_NOTIFY_ENDPOINT: 'https://notify.test/api/admin/alert',
    NOTIFY: {
      async fetch(request) {
        notifyRequests.push(request);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    }
  };

  try {
    const { fetchCnQuotesBatchWithFallback } = await import('../workers/markets/src/marketRuntime.js');
    const out = await fetchCnQuotesBatchWithFallback(env, [{ raw: '513100', code: 'sh513100' }]);

    assert.equal(out['513100'].fallback, 'tencent-price');
    assert.equal(out['513100'].source, 'tencent-quote');
    assert.equal(out['513100'].price, 1.23);
    assert.equal(JSON.parse(store.get('alert:xueqiu-cookie')).context.fallback, 'tencent-price');
    const alertRequest = notifyRequests[0];
    assert.ok(alertRequest);
    assert.equal(alertRequest.url, 'https://notify.internal/internal/third-party-alert');
    const alertBody = await alertRequest.json();
    assert.equal(alertBody.eventType, 'xueqiu_cookie_issue');
    assert.equal(alertBody.context.fallback, 'tencent-price');
    assert.equal(requests.some(({ url }) => url === 'https://notify.test/api/admin/alert'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
