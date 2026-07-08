import { test } from 'node:test';
import assert from 'node:assert/strict';

import marketsWorker from '../workers/markets/src/index.js';
import {
  normalizeYahooMarketSummary,
  normalizeYahooSparkline,
  shouldPreferUsFuturesMarketSummary
} from '../workers/markets/src/fetchers.js';

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

function sampleYahooSpotIndexMarketSummary() {
  return {
    marketSummaryResponse: {
      result: [
        {
          symbol: '^GSPC',
          shortName: 'S&P 500',
          regularMarketPrice: { raw: 8200.25, fmt: '8,200.25' },
          regularMarketChange: { raw: -12.5, fmt: '-12.50' },
          regularMarketChangePercent: { raw: -0.1521, fmt: '-0.15%' },
          regularMarketTime: { raw: 1783510995, fmt: '7:43AM EDT' },
          marketState: 'REGULAR'
        },
        {
          symbol: '^DJI',
          shortName: 'Dow 30',
          regularMarketPrice: { raw: 56000.5, fmt: '56,000.50' },
          regularMarketChange: { raw: -80.5, fmt: '-80.50' },
          regularMarketChangePercent: { raw: -0.1436, fmt: '-0.14%' },
          regularMarketTime: { raw: 1783510995, fmt: '7:43AM EDT' },
          marketState: 'REGULAR'
        },
        {
          symbol: '^IXIC',
          shortName: 'Nasdaq',
          regularMarketPrice: { raw: 30002.75, fmt: '30,002.75' },
          regularMarketChange: { raw: 44.25, fmt: '44.25' },
          regularMarketChangePercent: { raw: 0.1477, fmt: '0.15%' },
          regularMarketTime: { raw: 1783510995, fmt: '7:43AM EDT' },
          marketState: 'REGULAR'
        },
        {
          symbol: 'GC=F',
          shortName: 'Gold',
          regularMarketPrice: { raw: 3420.1, fmt: '3,420.10' },
          regularMarketChange: { raw: 5.1, fmt: '5.10' },
          regularMarketChangePercent: { raw: 0.1493, fmt: '0.15%' },
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

function sampleYahooChartQuote(symbol, { price, previousClose, closes }) {
  return {
    chart: {
      result: [{
        meta: {
          symbol,
          regularMarketPrice: price,
          chartPreviousClose: previousClose,
          previousClose,
          regularMarketTime: 1783510995,
          marketState: 'PRE',
          exchangeTimezoneName: 'America/New_York'
        },
        timestamp: closes.map((_, index) => 1783509900 + index * 900),
        indicators: {
          quote: [{ close: closes }]
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

test('detects US summaries that should be replaced with futures symbols', () => {
  const spotPayload = normalizeYahooMarketSummary(sampleYahooSpotIndexMarketSummary(), { region: 'US', title: 'US Markets' });
  const futuresPayload = normalizeYahooMarketSummary(sampleYahooMarketSummary(), { region: 'US', title: 'US Markets' });

  assert.equal(shouldPreferUsFuturesMarketSummary(spotPayload.items), true);
  assert.equal(shouldPreferUsFuturesMarketSummary(futuresPayload.items), false);
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

test('market summary route replaces US spot index payloads with Yahoo futures quotes', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  const chartQuotes = {
    'ES=F': { price: 7506, previousClose: 7551.25, closes: [7551.25, 7520, 7506] },
    'YM=F': { price: 52756, previousClose: 53197, closes: [53197, 52980, 52756] },
    'NQ=F': { price: 29135.75, previousClose: 29391.5, closes: [29391.5, 29220, 29135.75] },
    'RTY=F': { price: 2978.2, previousClose: 2998.8, closes: [2998.8, 2985, 2978.2] },
    '^VIX': { price: 17.52, previousClose: 16.13, closes: [16.13, 16.8, 17.52] },
    'CL=F': { price: 74.47, previousClose: 70.44, closes: [70.44, 72.2, 74.47] },
    'GC=F': { price: 3420.1, previousClose: 3415, closes: [3415, 3419, 3420.1] }
  };
  globalThis.fetch = async (url) => {
    const urlText = String(url);
    requestedUrls.push(urlText);
    if (urlText.includes('/v8/finance/chart/')) {
      const symbol = decodeURIComponent(urlText.match(/\/v8\/finance\/chart\/([^?]+)/)?.[1] || '');
      const quote = chartQuotes[symbol];
      return new Response(JSON.stringify(sampleYahooChartQuote(symbol, quote)), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify(sampleYahooSpotIndexMarketSummary()), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const staleSpotCache = {
    source: 'yahoo-market-summary',
    region: 'US',
    title: 'US Markets',
    generatedAt: new Date().toISOString(),
    items: normalizeYahooMarketSummary(sampleYahooSpotIndexMarketSummary(), { region: 'US', title: 'US Markets' }).items
  };
  const env = createEnv({ 'market-summary:US': JSON.stringify(staleSpotCache) });

  try {
    const res = await marketsWorker.fetch(marketsRequest('/market-summary?region=US'), env, {});
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.cached, false);
    assert.deepEqual(body.items.slice(0, 4).map((item) => [item.symbol, item.name]), [
      ['ES=F', 'S&P Futures'],
      ['YM=F', 'Dow Futures'],
      ['NQ=F', 'Nasdaq Futures'],
      ['RTY=F', 'Russell 2000 Futures']
    ]);
    assert.equal(body.items.some((item) => item.symbol === '^GSPC' || item.symbol === '^IXIC'), false);
    assert.equal(body.items.find((item) => item.symbol === 'GC=F')?.name, 'Gold');
    assert.deepEqual(body.items[0].sparkline, [7551.25, 7520, 7506]);
    assert.equal(requestedUrls.filter((url) => /\/v8\/finance\/chart\/ES%3DF/.test(url)).length, 1);
    assert.equal(JSON.parse(env.store.get('market-summary:US')).items[0].name, 'S&P Futures');
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
