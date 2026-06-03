import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeFundMetricFromQuote } from '../workers/markets/src/fundMetricsRoutes.js';

const SOURCE_UPDATED_AT_MS = Date.UTC(2026, 4, 29, 8, 0, 0);
const SOURCE_UPDATED_AT_SEC = SOURCE_UPDATED_AT_MS / 1000;

test('fund-metrics normalizes Danjuan OTC NAV into stable front-end fields', () => {
  const item = normalizeFundMetricFromQuote('021000', {
    code: '021000',
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

  assert.equal(item.code, '021000');
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

test('fund-metrics exposes Danjuan QDII metadata as fundKind', () => {
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

  assert.equal(item.fundKind, 'qdii');
  assert.equal(item.fundType, 'QDII');
  assert.equal(item.fundTypeCode, 11);
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
