import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeFundMetricFromQuote } from '../workers/markets/src/fundMetricsRoutes.js';

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
});
