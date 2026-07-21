import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMarketsHeldAggregates } from '../src/app/marketsHoldingsSnapshot.js';

test('markets held snapshot marks active holdings and hides cleared positions', () => {
  const aggregates = buildMarketsHeldAggregates([
    { id: 'buy-513100', code: '513100', name: 'NASDAQ ETF', kind: 'exchange', type: 'BUY', date: '2026-01-01', price: 1, shares: 100 },
    { id: 'sell-513100', code: '513100', type: 'SELL', date: '2026-01-02', price: 1.1, shares: 40 },
    { id: 'buy-159501', code: '159501', name: 'Cleared ETF', kind: 'exchange', type: 'BUY', date: '2026-01-01', price: 1, shares: 10 },
    { id: 'sell-159501', code: '159501', type: 'SELL', date: '2026-01-03', price: 1.2, shares: 10 },
  ]);

  const active = aggregates.filter((item) => item.hasPosition);
  assert.deepEqual(active.map((item) => item.code), ['513100']);
  assert.equal(active[0].totalShares, 60);
  assert.equal(active[0].name, 'NASDAQ ETF');
});

test('markets held snapshot keeps pending OTC buys and sells aligned with ledger display', () => {
  const aggregates = buildMarketsHeldAggregates([
    { id: 'pending-buy', code: '006479', name: 'OTC Fund', kind: 'otc', type: 'BUY', date: '2026-01-01', amount: 500 },
    { id: 'settled-buy', code: '007000', name: 'Settled OTC', kind: 'otc', type: 'BUY', date: '2026-01-01', price: 1, shares: 100 },
    { id: 'pending-sell', code: '007000', kind: 'otc', type: 'SELL', date: '2026-01-02', shares: 100 },
  ]);

  const byCode = new Map(aggregates.map((item) => [item.code, item]));
  assert.equal(byCode.get('006479').hasPosition, true);
  assert.equal(byCode.get('006479').pendingBuyAmount, 500);
  assert.equal(byCode.get('007000').hasPosition, true);
  assert.equal(byCode.get('007000').totalShares, 100);
});

test('markets held snapshot derives OTC shares from amount and price', () => {
  const aggregates = buildMarketsHeldAggregates([
    { id: 'amount-buy', code: '006479', name: 'Amount OTC', kind: 'otc', type: 'BUY', date: '2026-01-01', price: 2, amount: 300 },
  ]);

  assert.equal(aggregates[0].hasPosition, true);
  assert.equal(aggregates[0].totalShares, 150);
});

test('markets held snapshot normalizes prefixed symbols for lookup', () => {
  const aggregates = buildMarketsHeldAggregates([
    { id: 'buy-sh', symbol: 'SH513100', name: 'Prefixed ETF', side: 'buy', date: '2026-01-01', price: '2.50', shares: '20' },
  ]);

  assert.equal(aggregates.length, 1);
  assert.equal(aggregates[0].code, '513100');
  assert.equal(aggregates[0].kind, 'exchange');
  assert.equal(aggregates[0].hasPosition, true);
  assert.equal(aggregates[0].totalShares, 20);
});

test('markets held snapshot keeps negative OTC NAV transactions as settled', () => {
  const aggregates = buildMarketsHeldAggregates([
    { id: 'negative-buy', code: '000001', kind: 'otc', type: 'BUY', date: '2026-01-01', price: -0.5, shares: 10 },
    { id: 'negative-sell', code: '000001', kind: 'otc', type: 'SELL', date: '2026-01-02', price: -0.25, shares: 4 }
  ]);

  assert.equal(aggregates[0].hasPosition, true);
  assert.equal(aggregates[0].totalShares, 6);
  assert.equal(aggregates[0].pendingBuyAmount, 0);
});
