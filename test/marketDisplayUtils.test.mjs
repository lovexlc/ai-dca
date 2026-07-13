import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatMarketPrice, formatPremiumPercent, formatTurnover, isCnExchangeFundRow, isCnLofFundRow, resolvePremiumPercent } from '../src/pages/markets/marketDisplayUtils.js';

test('market price displays CN exchange fund prices with 3 decimals', () => {
  assert.equal(isCnExchangeFundRow({ symbol: '159513' }), true);
  assert.equal(formatMarketPrice(1.773, { symbol: '159513' }), '1.773');
  assert.equal(formatMarketPrice(1.7734, { symbol: 'sz159513' }), '1.773');
});

test('market price keeps non-exchange rows at 2 decimals', () => {
  assert.equal(isCnExchangeFundRow({ symbol: 'QQQ' }), false);
  assert.equal(formatMarketPrice(438.126, { symbol: 'QQQ' }), '438.13');
});

test('market turnover displays compact CN money units', () => {
  assert.equal(formatTurnover(29382745.67), '2,938.27万');
  assert.equal(formatTurnover(2930000000), '29.30亿');
  assert.equal(formatTurnover(null), '—');
});

test('LOF premium is unavailable instead of being derived from price and NAV', () => {
  const row = { symbol: '161128', name: '标普信息科技LOF', price: 1.2, nav: 1 };
  assert.equal(isCnLofFundRow(row), true);
  assert.equal(resolvePremiumPercent(row), null);
  assert.equal(formatPremiumPercent(row), '—');
});

test('explicit premium percent keeps decimal percentage points', () => {
  assert.equal(resolvePremiumPercent({ symbol: '159577', premiumPercent: 0.83 }), 0.83);
  assert.equal(formatPremiumPercent({ symbol: '159577', premiumPercent: 0.83 }), '+0.83%');
});

test('ETF premium remains available', () => {
  assert.ok(Math.abs(resolvePremiumPercent({ symbol: '513100', name: '纳指ETF', price: 1.2, nav: 1 }) - 20) < 1e-9);
});
