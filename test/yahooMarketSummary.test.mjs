import { test } from 'node:test';
import assert from 'node:assert/strict';

import marketsWorker from '../workers/markets/src/index.js';
import { normalizeYahooMarketSummary, normalizeYahooSparkline } from '../workers/markets/src/fetchers.js';

function sampleYahooMarketSummary() {
  return {
    marketSummaryResponse: {
      result: [
        {
          symbol: 'ES=F',
          shortName: 'S&P Futures',
          regularMarketPrice: { raw: 7485.5, fmt: '7,485.50' },
          regularMarketChange: { raw: -65.75, fmt: '-65.75' },
          regularMarketChangePercent: { raw: -0.87071675, fmt: '-0.87%' },
          regularMarketTime: { raw: 1783510995, fmt: '7:43AM EDT' },
          marketState: 'REGULAR',
          exchangeTimezoneName: 'America/New_York',
          exchangeDataDelayedBy: 10,
          quoteSourceName: 'Delayed Quote'
        },
        {
          symbol: 'CL=F',
          shortName: 'Crude Oil',
          regularMarketPrice: { raw: 74.47, fmt: '74.47' },
          regularMarketChange: { raw: 4.029999, fmt: '4.03' },
          regularMarketChangePercent: { raw: 5.721179, fmt: '5.72%' },
          regularMarketTime: { raw: 1783510995, fmt: '7:43AM EDT' },
          marketState: 'REGULAR'
        }
      ]
    }
  };
}

function sampleYahooChart(values = [7488, 7486.25, null, 7491.5, 7485.75]) {
  return {
    chart: {
      result: [{
        timestamp: [1783509900, 1783510800, 1783511700, 1783512600, 1783513500],
        indicators: {
          quote: [{ close: values }]
        }
      }]
    }
  };
}

function createEnv(entries = {}) {
  const store = new Map(Object.entries(entries));
  const writes = [];
  return {
    store,
    writes,
    MARKETS_KV: {
      async get(key) {
        return store.get(key) || null;
      },
      async put(key, value, opts) {
        writes.push({ key, value: JSON.parse(value), opts });
        store.set(key, value);
      }
    }
  };
}

function marketsRequest(path) {
  return new Request('https://worker.test/api/markets' + path);
}

test('normalizes Yahoo market summary formatted fields', () => {
  const payload = normalizeYahooMarketSummary(sampleYahooMarketSummary(), { region: 'US', title: 'US Markets' });

  assert.equal(payload.region, 'US');
  assert.equal(payload.title, 'US Markets');
  assert.equal(payload.items.length, 2);
  assert.deepEqual(payload.items[0], {
    symbol: 'ES=F',
    name: 'S&P Futures',
    price: 7485.5,
    priceText: '7,485.50',
    change: -65.75,
    changeText: '-65.75',
    changePercent: -0.8707,
    changePercentText: '-0.87%',
    marketState: 'REGULAR',
    asOf: '2026-07-08T11:43:15.000Z',
    timeText: '7:43AM EDT',
    exchangeTimezone: 'America/New_York',
    delayMinutes: 10,
    source: 'Delayed Quote'
  });
});

test('normalizes Yahoo chart closes into compact sparkline points', () => {
  const points = normalizeYahooSparkline(sampleYahooChart([1, null, 1.23456, 2, 3]).chart.result[0], { maxPoints: 3 });

  assert.deepEqual(points, [1.2346, 2, 3]);
});

test('market summary route returns valid KV cache without live Yahoo fetch', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return new Response('{}', { status: 500 });
  };
  const cached = {
    source: 'yahoo-market-summary',
    region: 'US',
    title: 'US Markets',
    generatedAt: new Date().toISOString(),
    items: [{ symbol: 'ES=F', name: 'S&P Futures', price: 7485.5 }]
  };
  const env = createEnv({ 'market-summary:US': JSON.stringify(cached) });

  try {
    const res = await marketsWorker.fetch(marketsRequest('/market-summary?region=US'), env, {});
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.cached, true);
    assert.equal(body.cache.source, 'kv');
    assert.equal(body.items[0].symbol, 'ES=F');
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('market summary route ignores stale KV cache and writes fresh Yahoo payload', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    const urlText = String(url);
    requestedUrls.push(urlText);
    const payload = urlText.includes('/v8/finance/chart/')
      ? sampleYahooChart()
      : sampleYahooMarketSummary();
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const stale = {
    source: 'yahoo-market-summary',
    region: 'US',
    title: 'US Markets',
    generatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    items: [{ symbol: 'OLD', name: 'Old Cache', price: 1 }]
  };
  const env = createEnv({ 'market-summary:US': JSON.stringify(stale) });

  try {
    const res = await marketsWorker.fetch(marketsRequest('/market-summary?region=US'), env, {});
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.cached, false);
    assert.equal(body.items[0].symbol, 'ES=F');
    assert.deepEqual(body.items[0].sparkline, [7488, 7486.25, 7491.5, 7485.75]);
    assert.equal(requestedUrls.length, 3);
    assert.equal(env.writes[0].key, 'market-summary:US');
    const stored = JSON.parse(env.store.get('market-summary:US'));
    assert.equal(stored.items[0].symbol, 'ES=F');
    assert.deepEqual(stored.items[0].sparkline, [7488, 7486.25, 7491.5, 7485.75]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('market summary route ignores source-mismatched cache and writes Yahoo payload key', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    const urlText = String(url);
    requestedUrls.push(urlText);
    const payload = urlText.includes('/v8/finance/chart/')
      ? sampleYahooChart([74.1, 74.2, 74.47])
      : sampleYahooMarketSummary();
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const env = createEnv({
    'market-summary:US': JSON.stringify({ source: 'wrong-source', region: 'US', items: [{ symbol: 'BAD' }] })
  });

  try {
    const res = await marketsWorker.fetch(marketsRequest('/market-summary?region=US'), env, {});
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.cached, false);
    assert.equal(body.source, 'yahoo-market-summary');
    assert.equal(body.items[0].symbol, 'ES=F');
    assert.equal(requestedUrls.length, 3);
    assert.match(requestedUrls[0], /\/v6\/finance\/quote\/marketSummary/);
    assert.match(requestedUrls[0], /market=US/);
    assert.match(requestedUrls[0], /region=US/);
    assert.ok(requestedUrls.some((url) => /\/v8\/finance\/chart\/ES%3DF/.test(url)));
    assert.equal(env.writes.length, 1);
    assert.equal(env.writes[0].key, 'market-summary:US');
    assert.equal(env.writes[0].opts.expirationTtl, 120);
    assert.equal(JSON.parse(env.store.get('market-summary:US')).source, 'yahoo-market-summary');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
