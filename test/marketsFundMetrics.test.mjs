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
