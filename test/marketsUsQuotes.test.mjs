import { test } from 'node:test';
import assert from 'node:assert/strict';

import marketsWorker from '../workers/markets/src/index.js';
import { writeKlineMetaCache } from '../workers/markets/src/klineMetaCache.js';
import { writeQuoteCache } from '../workers/markets/src/quoteCache.js';

function createEnv() {
  const store = new Map();
  return {
    MARKETS_DATA_READ_MODE: 'live',
    MARKETS_KV: {
      async get(key, options) {
        const raw = store.get(key);
        if (raw == null) return null;
        return options?.type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key, value) {
        store.set(key, value);
      }
    }
  };
}

function yahooChart(symbol, price, high52w) {
  return {
    chart: {
      result: [{
        meta: {
          symbol,
          regularMarketPrice: price,
          chartPreviousClose: price - 1,
          regularMarketDayHigh: price + 2,
          regularMarketDayLow: price - 3,
          fiftyTwoWeekHigh: high52w,
          fiftyTwoWeekLow: price - 100,
          regularMarketTime: 1783510995,
          exchangeTimezoneName: 'America/New_York'
        }
      }]
    }
  };
}

test('US batch quotes resolve Nasdaq plan alias and expose current/52-week high', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    requested.push(value);
    const symbol = decodeURIComponent(value.split('/v8/finance/chart/')[1].split('?')[0]);
    const prices = { '^NDX': [20000, 21000], QQQ: [500, 550], VOO: [600, 650] };
    const [price, high] = prices[symbol] || [100, 120];
    return new Response(JSON.stringify(yahooChart(symbol, price, high)), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const response = await marketsWorker.fetch(
      new Request('https://worker.test/api/markets/quotes?symbols=nas-daq100,QQQ,VOO'),
      createEnv(),
      {}
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.quotes['nas-daq100'].price, 20000);
    assert.equal(payload.quotes['nas-daq100'].high52w, 21000);
    assert.equal(payload.quotes.QQQ.price, 500);
    assert.equal(payload.quotes.QQQ.fiftyTwoWeekHigh, 550);
    assert.equal(payload.quotes.VOO.high52w, 650);
    const requestedSymbols = requested.map((url) => decodeURIComponent(url).split('/v8/finance/chart/')[1].split('?')[0]);
    assert.ok(requestedSymbols.includes('^NDX'));
    assert.ok(requestedSymbols.includes('QQQ'));
    assert.ok(requestedSymbols.includes('VOO'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('US cached quotes enrich daily high from KV metadata without reading R2 or Yahoo', async () => {
  const env = createEnv();
  env.MARKETS_R2 = {
    async get() {
      throw new Error('US quote list must not read R2');
    }
  };
  await writeQuoteCache(env, 'QQQ', {
    symbol: 'QQQ',
    market: 'us',
    price: 500,
    source: 'yahoo'
  }, { ttlSeconds: 120 });
  await writeKlineMetaCache(env, {
    market: 'us',
    symbol: 'QQQ',
    meta: {
      highPoint: { high: 555, highDate: '2026-07-01', source: 'daily-kline-365d' },
      latestBarDate: '2026-07-23',
      generatedAt: new Date().toISOString()
    }
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('cached US quote should not hit Yahoo');
  };
  try {
    const response = await marketsWorker.fetch(
      new Request('https://worker.test/api/markets/quotes?symbols=QQQ'),
      env,
      {}
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.quotes.QQQ.price, 500);
    assert.equal(payload.quotes.QQQ.highPoint.high, 555);
    assert.equal(payload.quotes.QQQ.yearHighDate, '2026-07-01');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
