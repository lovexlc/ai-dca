import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatMarketPrice, isCnExchangeFundRow } from '../src/pages/markets/marketDisplayUtils.js';

test('market price displays CN exchange fund prices with 3 decimals', () => {
  assert.equal(isCnExchangeFundRow({ symbol: '159513' }), true);
  assert.equal(formatMarketPrice(1.773, { symbol: '159513' }), '1.773');
  assert.equal(formatMarketPrice(1.7734, { symbol: 'sz159513' }), '1.773');
});

test('market price keeps non-exchange rows at 2 decimals', () => {
  assert.equal(isCnExchangeFundRow({ symbol: 'QQQ' }), false);
  assert.equal(formatMarketPrice(438.126, { symbol: 'QQQ' }), '438.13');
});
