import { test } from 'node:test';
import assert from 'node:assert/strict';

/* global Response, URLSearchParams */

import { fetchXueqiuQuote } from '../workers/markets/src/fetchers.js';
import { handleFundMetrics, handleKline, normalizeFundMetricFromQuote } from '../workers/markets/src/fundMetricsRoutes.js';
import {
  deriveCandlestickExtrema,
  navHistoryCacheKey,
  navHistoryQueryForRange,
  sliceCandlesForRange,
} from '../src/pages/markets/marketFundMetrics.js';

const SOURCE_UPDATED_AT_MS = Date.UTC(2026, 4, 29, 8, 0, 0);
const SOURCE_UPDATED_AT_SEC = SOURCE_UPDATED_AT_MS / 1000;

test('CN fund high/low extrema are derived from daily candles instead of quote aliases', () => {
  const candles = [
    { t: Date.UTC(2025, 5, 1) / 1000, h: 5.464, l: 0.776 },
    { t: Date.UTC(2025, 5, 13) / 1000, h: 1.62, l: 1.548 },
    { t: Date.UTC(2026, 5, 1) / 1000, h: 2.386, l: 2.046 },
    { t: Date.UTC(2026, 5, 3) / 1000, h: 2.577, l: 2.277 },
    { t: Date.UTC(2026, 5, 5) / 1000, h: 2.249, l: 2.2 }
  ];

  const extrema = deriveCandlestickExtrema(candles, { daysBack: 365 });

  assert.equal(extrema.high, 2.577);
  assert.equal(extrema.low, 1.548);
  assert.equal(extrema.highDate, '2026-06-03');
  assert.equal(extrema.lowDate, '2025-06-13');
});

test('market detail custom range filters candles and builds date-based NAV query key', () => {
  const candles = [
    { t: Date.parse('2026-05-01T15:00:00+08:00') / 1000, c: 1.01 },
    { t: Date.parse('2026-05-02T15:00:00+08:00') / 1000, c: 1.02 },
    { t: Date.parse('2026-05-03T15:00:00+08:00') / 1000, c: 1.03 },
    { t: Date.parse('2026-05-04T15:00:00+08:00') / 1000, c: 1.04 },
  ];

  const customRange = { from: '2026-05-02', to: '2026-05-03' };
  const sliced = sliceCandlesForRange(candles, 'custom', customRange);

  assert.deepEqual(sliced.map((item) => item.c), [1.02, 1.03]);
  assert.deepEqual(navHistoryQueryForRange('custom', customRange), customRange);
  assert.equal(navHistoryCacheKey('513100', 'custom', customRange), '513100|2026-05-02|2026-05-03');
});

test('fund-metrics normalizes Danjuan OTC NAV into stable front-end fields', () => {
  const item = normalizeFundMetricFromQuote('022951', {
    code: '022951',
    symbol: '021000',
    price: null,
    currentPrice: null,
    close: null,
    previousClose: 2.362,
    change: 0.006,
    changePercent: 0.254,
    latestNav: 2.368,
    latestNavDate: '2026-05-29',
    updatedAt: SOURCE_UPDATED_AT_MS,
    source: 'danjuan'
  }, { exchange: false, cachePolicy: 'kv-closed-session' });

  assert.equal(item.code, '022951');
  assert.equal(item.price, null);
  assert.equal(item.currentPrice, 2.368);
  assert.equal(item.close, 2.368);
  assert.equal(item.latestNav, 2.368);
  assert.equal(item.previousNav, 2.362);
  assert.equal(item.previousClose, 2.362);
  assert.equal(item.change, 0.006);
  assert.equal(item.changePercent, 0.254);
  assert.equal(item.latestNavDate, '2026-05-29');
  assert.equal(item.updatedAt, '2026-05-29T08:00:00.000Z');
  assert.equal(item.fundKind, 'otc');
});

test('fund-metrics normalizes source updatedAt from second timestamp', () => {
  const item = normalizeFundMetricFromQuote('021000', {
    code: '021000',
    latestNav: 2.368,
    changePercent: 0.254,
    latestNavDate: '2026-05-29',
    updatedAt: SOURCE_UPDATED_AT_SEC
  }, { exchange: false });

  assert.equal(item.updatedAt, '2026-05-29T08:00:00.000Z');
});

test('fund-metrics derives previousNav when source only has NAV and change percent', () => {
  const item = normalizeFundMetricFromQuote('021000', {
    code: '021000',
    latestNav: 2.368,
    changePercent: 0.254,
    latestNavDate: '2026-05-29'
  }, { exchange: false });

  assert.equal(item.currentPrice, 2.368);
  assert.equal(item.previousNav, 2.362);
  assert.equal(item.previousClose, 2.362);
  assert.equal(item.change, 0.006);
  assert.equal(item.changePercent, 0.254);
});

test('fund-metrics keeps Danjuan QDII metadata without classifying from it', () => {
  const item = normalizeFundMetricFromQuote('008971', {
    code: '008971',
    latestNav: 6.5651,
    previousClose: 6.5328,
    changePercent: 0.4944,
    latestNavDate: '2026-06-02',
    fundType: 'QDII',
    fundTypeCode: 11,
    source: 'danjuan'
  }, { exchange: false });

  assert.equal(item.fundKind, 'otc');
  assert.equal(item.fundType, 'QDII');
  assert.equal(item.fundTypeCode, 11);
});

test('fund-metrics uses project-provided QDII kind hint', () => {
  const item = normalizeFundMetricFromQuote('021000', {
    code: '021000',
    latestNav: 2.3756,
    previousClose: 2.3861,
    changePercent: -0.44,
    latestNavDate: '2026-06-04',
    source: 'danjuan'
  }, { exchange: false, fundKind: 'qdii' });

  assert.equal(item.fundKind, 'qdii');
});

test('fund-metrics fills known OTC metadata when Danjuan meta is blank', () => {
  const item = normalizeFundMetricFromQuote('021000', {
    code: '021000',
    name: '',
    fullName: '',
    fundType: '',
    latestNav: 2.3756,
    previousClose: 2.3861,
    changePercent: -0.44,
    latestNavDate: '2026-06-04',
    source: 'danjuan'
  }, { exchange: false, fundKind: 'qdii' });

  assert.equal(item.name, '南方纳斯达克100指数发起(QDII)I人民币');
  assert.equal(item.fullName, '南方纳斯达克100指数发起(QDII)I人民币');
  assert.equal(item.fundType, 'QDII');
});

test('fund-metrics keeps exchange ETF price as current value', () => {
  const item = normalizeFundMetricFromQuote('513100', {
    code: '513100',
    symbol: 'sh513100',
    name: '纳指ETF国泰',
    price: 2.365,
    currentPrice: 2.365,
    close: 2.365,
    previousClose: 2.273,
    change: 0.092,
    changePercent: 4.05,
    volume: 12345678,
    turnover: 29382745.67,
    marketCapital: 2930000000,
    latestNav: 2.065,
    latestNavDate: '2026-05-29',
    iopv: 2.0647,
    premiumPercent: 14.54,
    orderBook: {
      bidPrice: 2.364,
      bidVolume: 123400,
      askPrice: 2.365,
      askVolume: 567800,
      source: 'xueqiu-pankou'
    },
    asOf: '2026-06-01T07:00:00.000Z',
    source: 'xueqiu-quote'
  }, { exchange: true, cachePolicy: 'live-refresh' });

  assert.equal(item.code, '513100');
  assert.equal(item.price, 2.365);
  assert.equal(item.currentPrice, 2.365);
  assert.equal(item.close, 2.365);
  assert.equal(item.previousClose, 2.273);
  assert.equal(item.previousNav, 2.273);
  assert.equal(item.change, 0.092);
  assert.equal(item.changePercent, 4.05);
  assert.equal(item.volume, 12345678);
  assert.equal(item.turnover, 29382745.67);
  assert.equal(item.marketCapital, 2930000000);
  assert.equal(item.latestNav, 2.065);
  assert.equal(item.navBase, 2.0647);
  assert.equal(item.premiumPercent, 14.54);
  assert.deepEqual(item.orderBook, {
    bidPrice: 2.364,
    bidVolume: 123400,
    askPrice: 2.365,
    askVolume: 567800,
    spread: 0.001,
    spreadPercent: 0.0423,
    source: 'xueqiu-pankou'
  });
  assert.equal(item.quoteDate, '2026-06-01');
});

test('fund-metrics marks stale exchange ETF quote as closed with quoteDate', () => {
  const item = normalizeFundMetricFromQuote('513100', {
    code: '513100',
    symbol: 'sh513100',
    name: '纳指ETF国泰',
    price: 2.365,
    currentPrice: 2.365,
    previousClose: 2.273,
    changePercent: 4.05,
    latestNav: 2.065,
    latestNavDate: '2026-05-29',
    marketState: 'REGULAR',
    asOf: '2000-01-01T07:00:00.000Z',
    source: 'xueqiu-quote'
  }, { exchange: true, cachePolicy: 'live-refresh' });

  assert.equal(item.quoteDate, '2000-01-01');
  assert.equal(item.marketState, 'CLOSED');
});

test('fund-metrics exchange refresh falls back to KV instead of Sina when Xueqiu is unavailable', async () => {
  const cached = normalizeFundMetricFromQuote('501312', {
    code: '501312',
    symbol: 'sh501312',
    name: '海外科技LOF',
    price: 1.234,
    previousClose: 1.2,
    latestNav: 1.1,
    iopv: 1.11,
    premiumPercent: 11.1712,
    asOf: '2026-06-03T07:00:00.000Z',
    source: 'xueqiu-quote'
  }, { exchange: true, cached: false, cachePolicy: 'live-refresh' });

  const env = {
    MARKETS_KV: {
      async get(key) {
        if (key === 'alert:xueqiu-cookie') return JSON.stringify({ generatedAt: '2026-06-04T00:00:00.000Z' });
        return key === 'fund-metrics:501312' ? JSON.stringify(cached) : null;
      },
      async put() {}
    }
  };

  const response = await handleFundMetrics(env, { codes: ['501312'], refresh: true });
  const payload = await response.json();
  const item = payload.items[0];

  assert.equal(payload.successCount, 1);
  assert.equal(payload.failureCount, 0);
  assert.equal(item.code, '501312');
  assert.equal(item.price, 1.234);
  assert.equal(item.source, 'xueqiu-quote');
  assert.equal(item.fallback, 'kv');
  assert.equal(item.cachePolicy, 'kv-live-fallback');
  assert.match(item.primaryError, /XUEQIU_COOKIE missing/);
  assert.doesNotMatch(JSON.stringify(payload), /sina/i);
});

test('Xueqiu quote maps 501-prefixed exchange funds to Shanghai symbols', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).includes('/realtime/pankou.json')) {
      return new Response(JSON.stringify({
        data: {
          symbol: 'SH501312',
          bp1: 1.233,
          bc1: 120000,
          sp1: 1.234,
          sc1: 230000
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: {
        quote: {
          symbol: 'SH501312',
          code: '501312',
          name: '海外科技LOF',
          current: 1.234,
          last_close: 1.2,
          timestamp: Date.UTC(2026, 5, 4, 7, 0, 0)
        }
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const quote = await fetchXueqiuQuote('501312', { cookie: 'xq_a_token=test' });
    assert.match(requestedUrls[0], /symbol=SH501312/);
    assert.match(requestedUrls[1], /\/realtime\/pankou\.json/);
    assert.equal(quote.symbol, 'sh501312');
    assert.equal(quote.price, 1.234);
    assert.deepEqual(quote.orderBook, {
      bidPrice: 1.233,
      bidVolume: 120000,
      askPrice: 1.234,
      askVolume: 230000,
      spread: 0.001,
      spreadPercent: 0.0811,
      source: 'xueqiu-pankou'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('US daily kline fetches enough Yahoo history for six-month charts', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      chart: {
        result: [{
          meta: { symbol: 'QQQ' },
          timestamp: [Date.UTC(2026, 0, 2) / 1000, Date.UTC(2026, 5, 4) / 1000],
          indicators: {
            quote: [{
              open: [500, 600],
              high: [510, 610],
              low: [490, 590],
              close: [505, 605],
              volume: [1000, 2000]
            }]
          }
        }],
        error: null
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const response = await handleKline({}, 'QQQ', new URLSearchParams('tf=1d&refresh=1'));
    const payload = await response.json();
    assert.match(requestedUrl, /range=5y/);
    assert.match(requestedUrl, /interval=1d/);
    assert.equal(payload.symbol, 'QQQ');
    assert.equal(payload.candles.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('kline refresh can merge R2 history with realtime candles for backtests', async () => {
  const originalFetch = globalThis.fetch;
  const r2Candles = [
    { t: Date.UTC(2026, 5, 12, 1, 30) / 1000, o: 1, h: 1.1, l: 0.9, c: 1.01, v: 100 },
    { t: Date.UTC(2026, 5, 13, 1, 30) / 1000, o: 2, h: 2.1, l: 1.9, c: 2.01, v: 200 }
  ];
  const freshCandles = [
    { t: Date.UTC(2026, 5, 13, 1, 30) / 1000, o: 20, h: 21, l: 19, c: 20.5, v: 2000 },
    { t: Date.UTC(2026, 5, 14, 1, 30) / 1000, o: 3, h: 3.1, l: 2.9, c: 3.01, v: 300 }
  ];
  const env = {
    MARKETS_R2: {
      async get(key) {
        assert.equal(key, 'kline/us/QQQ/1d.json');
        return {
          async text() {
            return JSON.stringify({
              symbol: 'QQQ',
              interval: '1d',
              market: 'us',
              source: 'r2-batch',
              batchSaved: true,
              generatedAt: '2026-06-13T08:00:00.000Z',
              candles: r2Candles
            });
          }
        };
      }
    }
  };
  globalThis.fetch = async () => new Response(JSON.stringify({
    chart: {
      result: [{
        meta: { symbol: 'QQQ' },
        timestamp: freshCandles.map((item) => item.t),
        indicators: {
          quote: [{
            open: freshCandles.map((item) => item.o),
            high: freshCandles.map((item) => item.h),
            low: freshCandles.map((item) => item.l),
            close: freshCandles.map((item) => item.c),
            volume: freshCandles.map((item) => item.v)
          }]
        }
      }],
      error: null
    }
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const response = await handleKline(env, 'QQQ', new URLSearchParams('tf=1d&limit=1000&session=all&refresh=1&mergeR2=1'));
    const payload = await response.json();

    assert.equal(payload.source, 'realtime+r2');
    assert.equal(payload.mergedR2, true);
    assert.equal(payload.r2CandleCount, 2);
    assert.equal(payload.freshCandleCount, 2);
    assert.deepEqual(payload.candles.map((item) => item.t), [
      r2Candles[0].t,
      freshCandles[0].t,
      freshCandles[1].t
    ]);
    assert.equal(payload.candles[1].c, 20.5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('merged kline response applies the requested limit after dedupe', async () => {
  const originalFetch = globalThis.fetch;
  const r2Candles = [
    { t: 100, o: 1, h: 1, l: 1, c: 1, v: 1 },
    { t: 200, o: 2, h: 2, l: 2, c: 2, v: 2 }
  ];
  const env = {
    MARKETS_R2: {
      async get() {
        return {
          async text() {
            return JSON.stringify({ symbol: 'QQQ', interval: '1d', market: 'us', candles: r2Candles });
          }
        };
      }
    }
  };
  globalThis.fetch = async () => new Response(JSON.stringify({
    chart: {
      result: [{
        meta: { symbol: 'QQQ' },
        timestamp: [300, 400],
        indicators: {
          quote: [{
            open: [3, 4],
            high: [3, 4],
            low: [3, 4],
            close: [3, 4],
            volume: [3, 4]
          }]
        }
      }],
      error: null
    }
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const response = await handleKline(env, 'QQQ', new URLSearchParams('tf=1d&limit=2&session=all&refresh=1&mergeR2=1'));
    const payload = await response.json();

    assert.deepEqual(payload.candles.map((item) => item.t), [300, 400]);
    assert.equal(payload.mergedCandleCount, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
