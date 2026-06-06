import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchXueqiuQuote } from '../workers/markets/src/fetchers.js';
import { handleFundMetrics, handleKline, normalizeFundMetricFromQuote } from '../workers/markets/src/fundMetricsRoutes.js';

const SOURCE_UPDATED_AT_MS = Date.UTC(2026, 4, 29, 8, 0, 0);
const SOURCE_UPDATED_AT_SEC = SOURCE_UPDATED_AT_MS / 1000;

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
    latestNav: 2.065,
    latestNavDate: '2026-05-29',
    iopv: 2.0647,
    premiumPercent: 14.54,
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
  assert.equal(item.latestNav, 2.065);
  assert.equal(item.navBase, 2.0647);
  assert.equal(item.premiumPercent, 14.54);
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
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
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
    assert.match(requestedUrl, /symbol=SH501312/);
    assert.equal(quote.symbol, 'sh501312');
    assert.equal(quote.price, 1.234);
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
