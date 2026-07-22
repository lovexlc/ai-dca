import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MARKET_EMPTY_VALUE, formatMarketPrice, formatNumber, formatPercent, formatTurnover, isCnExchangeFundRow } from '../src/pages/markets/marketDisplayUtils.js';

test('market display formatters use one placeholder for missing values', () => {
  assert.equal(MARKET_EMPTY_VALUE, '—');
  assert.equal(formatNumber(null), MARKET_EMPTY_VALUE);
  assert.equal(formatPercent(undefined), MARKET_EMPTY_VALUE);
  assert.equal(formatTurnover(null), MARKET_EMPTY_VALUE);
});

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
