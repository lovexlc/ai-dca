import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAutoNavRefreshCodes,
  getManualNavRefreshCodes,
} from '../src/pages/holdings/holdingsNavRefreshPolicy.js';

test('auto nav refresh includes active holdings and excludes sold-only codes', () => {
  const transactions = [
    { id: 'active-buy', type: 'BUY', code: '000001', kind: 'otc', date: '2026-01-01', price: 1, shares: 100 },
    { id: 'sold-buy', type: 'BUY', code: '000002', kind: 'otc', date: '2026-01-01', price: 1, shares: 100 },
    { id: 'sold-sell', type: 'SELL', code: '000002', kind: 'otc', date: '2026-02-01', price: 1.1, shares: 100 },
  ];

  assert.deepEqual(getAutoNavRefreshCodes(transactions), ['000001']);
});

test('auto nav refresh includes pending otc buys because they still need nav confirmation', () => {
  const transactions = [
    { id: 'pending-buy', type: 'BUY', code: '000003', kind: 'otc', date: '2026-01-01', amount: 1000, shares: 0, price: 0 },
  ];

  assert.deepEqual(getAutoNavRefreshCodes(transactions), ['000003']);
});

test('manual nav refresh keeps all ledger and switch-chain codes', () => {
  const transactions = [
    { id: 'old-buy', type: 'BUY', code: '000004', kind: 'otc', date: '2026-01-01', price: 1, shares: 100 },
    { id: 'switch-sell', type: 'SELL', code: '000004', kind: 'otc', date: '2026-02-01', price: 1.1, shares: 100, switchPairId: 'switch-buy' },
    { id: 'switch-buy', type: 'BUY', code: '000005', kind: 'otc', date: '2026-02-01', price: 1, shares: 110 },
  ];

  assert.deepEqual(getAutoNavRefreshCodes(transactions), ['000005']);
  assert.deepEqual(getManualNavRefreshCodes(transactions), ['000004', '000005']);
});
