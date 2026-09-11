import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAggregatesTableData,
  hasMeaningfulHoldingPosition
} from '../src/pages/holdings/buildAggregatesTableData.js';

test('持仓汇总忽略不足 0.01 份的买卖精度尾差', () => {
  const residue = { code: '008971', hasPosition: true, totalShares: 0.0006, pendingBuyAmount: 0 };
  assert.equal(hasMeaningfulHoldingPosition(residue), false);
  assert.deepEqual(buildAggregatesTableData({ aggregates: [residue], costBasisBySymbol: {} }), []);
});

test('持仓汇总保留有效份额和待确认申购', () => {
  assert.equal(hasMeaningfulHoldingPosition({ hasPosition: true, totalShares: 0.01 }), true);
  assert.equal(hasMeaningfulHoldingPosition({ hasPosition: true, totalShares: 0, pendingBuyAmount: 100 }), true);
});
