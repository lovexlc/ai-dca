import assert from 'node:assert/strict';
import test from 'node:test';

import { __internals, fetchFundMetrics, fetchKline, fetchQuote, fetchQuotes } from '../src/app/marketsApi.js';

function delayedJson(payload, delayMs = 20) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    }, delayMs);
  });
}

test('fetchQuotes reuses one inflight request for the same symbol set', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];

  __internals.clearMarketsApiInflight();
  globalThis.window = {};
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return delayedJson({
      quotes: {
        '^TEST': { symbol: '^TEST', price: 1 },
        '^ALT': { symbol: '^ALT', price: 2 },
      },
    });
  };

  try {
    const [first, second] = await Promise.all([
      fetchQuotes(['^TEST', '^ALT', '^TEST']),
      fetchQuotes(['^ALT', '^TEST']),
    ]);

    assert.equal(requests.length, 1);
    assert.equal(first.quotes['^TEST'].price, 1);
    assert.equal(second.quotes['^ALT'].price, 2);
    assert.equal(__internals.inflightSizes().quotes, 0);
  } finally {
    __internals.clearMarketsApiInflight();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test('fetchKline reuses one inflight request for the same kline key', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];

  __internals.clearMarketsApiInflight();
  globalThis.window = {};
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return delayedJson({
      candles: [
        { t: 100, o: 1, h: 1, l: 1, c: 1 },
        { t: 200, o: 2, h: 2, l: 2, c: 2 },
      ],
    });
  };

  try {
    const [first, second] = await Promise.all([
      fetchKline('^TEST', { timeframe: '1d', limit: 365 }),
      fetchKline('^TEST', { timeframe: '1d', limit: 365 }),
    ]);

    assert.equal(requests.length, 1);
    assert.match(requests[0], /\/kline\/%5ETEST\?tf=1d&limit=365$/);
    assert.equal(first.candles.length, 2);
    assert.equal(second.candles[1].c, 2);
    assert.equal(__internals.inflightSizes().kline, 0);
  } finally {
    __internals.clearMarketsApiInflight();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test('fetchQuote reuses the batch quote inflight path', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];

  __internals.clearMarketsApiInflight();
  globalThis.window = {};
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return delayedJson({
      quotes: {
        '^TEST': { symbol: '^TEST', price: 3 },
      },
    });
  };

  try {
    const [single, batch] = await Promise.all([
      fetchQuote('^TEST'),
      fetchQuotes(['^TEST']),
    ]);

    assert.equal(requests.length, 1);
    assert.match(requests[0], /\/quotes\?symbols=%5ETEST$/);
    assert.equal(single.price, 3);
    assert.equal(batch.quotes['^TEST'].price, 3);
    assert.equal(__internals.inflightSizes().quotes, 0);
  } finally {
    __internals.clearMarketsApiInflight();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test('fetchFundMetrics reuses one inflight POST for the same code set', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];
  const bodies = [];

  __internals.clearMarketsApiInflight();
  globalThis.window = {};
  globalThis.fetch = async (url, options = {}) => {
    requests.push(String(url));
    bodies.push(JSON.parse(options.body || '{}'));
    return delayedJson({
      items: [
        { code: '513100', latestNav: 1.23, ok: true },
        { code: '159941', latestNav: 2.34, ok: true },
      ],
      successCount: 2,
      failureCount: 0,
    });
  };

  try {
    const [first, second] = await Promise.all([
      fetchFundMetrics(['513100', '159941']),
      fetchFundMetrics(['159941', '513100']),
    ]);

    assert.equal(requests.length, 1);
    assert.match(requests[0], /\/fund-metrics$/);
    assert.deepEqual(bodies[0].codes, ['513100', '159941']);
    assert.equal(first.items.length, 2);
    assert.equal(second.items[1].code, '159941');
    assert.equal(__internals.inflightSizes().fundMetrics, 0);
  } finally {
    __internals.clearMarketsApiInflight();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});
