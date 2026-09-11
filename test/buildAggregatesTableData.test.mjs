import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAggregatesTableData,
  hasMeaningfulHoldingPosition,
  splitAggregatesByTradingVenue
} from '../src/pages/holdings/buildAggregatesTableData.js';

test('持仓汇总忽略不足 0.01 份的买卖精度尾差', () => {
  const residue = { code: '008971', hasPosition: true, totalShares: 0.0006, pendingBuyAmount: 0 };
  assert.equal(hasMeaningfulHoldingPosition(residue), false);
  assert.deepEqual(buildAggregatesTableData({ aggregates: [residue], costBasisBySymbol: {} }), []);
});

test('相同代码的场内和场外 LOF 分别聚合', () => {
  const aggregate = {
    code: '161130',
    name: '易方达纳斯达克100 LOF',
    kind: 'exchange',
    hasPosition: true,
    transactions: [
      { id: 'otc-buy', code: '161130', name: '易方达纳斯达克100 LOF', kind: 'qdii', type: 'BUY', date: '2026-08-01', price: 4, shares: 100 },
      { id: 'exchange-buy', code: '161130', name: '易方达纳斯达克100 LOF', kind: 'exchange', type: 'BUY', date: '2026-09-02', price: 4.5, shares: 900 }
    ],
    currentPrice: 4.6,
    previousPrice: 4.5,
    latestNav: 4.6,
    previousNav: 4.5
  };
  const rows = splitAggregatesByTradingVenue([aggregate]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.aggregationKey).sort(), ['161130:exchange', '161130:off_exchange']);
  assert.deepEqual(rows.map((row) => row.totalShares).sort((a, b) => a - b), [100, 900]);
});
