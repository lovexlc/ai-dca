import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSampleBacktestRows,
  buildSimulatedOrderPlan,
  computeAccountSummary,
  executeSimulatedSwitch,
  normalizeQuantState,
  runPremiumSpreadBacktest
} from '../src/app/quantTrading.js';

test('quant simulator produces a switch signal from the default premium spread sample', () => {
  const state = normalizeQuantState();
  const plan = buildSimulatedOrderPlan(state);

  assert.equal(plan.signal.action, 'switch');
  assert.equal(plan.canTrade, true);
  assert.equal(plan.sell.symbol, '159513');
  assert.equal(plan.buy.symbol, '513100');
  assert.equal(plan.sell.quantity % state.strategy.lotSize, 0);
  assert.equal(plan.buy.quantity % state.strategy.lotSize, 0);
  assert.ok(plan.estimatedCapture > 0);
});

test('executing a simulated switch updates cash, positions, and order log', () => {
  const before = normalizeQuantState();
  const beforeSummary = computeAccountSummary(before);
  const result = executeSimulatedSwitch(before, '2026-06-12T10:00:00.000Z');
  const afterSummary = computeAccountSummary(result.state);

  assert.equal(result.fills.length, 2);
  assert.equal(result.state.orders.length, 2);
  assert.ok(result.state.account.positions['159513'].shares < before.account.positions['159513'].shares);
  assert.ok(result.state.account.positions['513100'].shares > before.account.positions['513100'].shares);
  assert.notEqual(afterSummary.cash, beforeSummary.cash);
});

test('simulated matching refuses trades when the signal does not reach the trigger', () => {
  const state = normalizeQuantState({
    strategy: { triggerSpreadPct: 1 },
    quotes: {
      '159513': { symbol: '159513', bid: 1.772, bidSize: 10000, ask: 1.773, askSize: 10000, iopv: 1.762 },
      '513100': { symbol: '513100', bid: 1.498, bidSize: 10000, ask: 1.499, askSize: 10000, iopv: 1.496 }
    }
  });
  const result = executeSimulatedSwitch(state, '2026-06-12T10:00:00.000Z');

  assert.equal(result.plan.signal.action, 'wait');
  assert.equal(result.fills.length, 0);
  assert.equal(result.state.orders.length, 0);
});

test('premium spread backtest returns trades and summary metrics', () => {
  const rows = buildSampleBacktestRows(45);
  const result = runPremiumSpreadBacktest({
    rows,
    triggerSpreadPct: 0.3,
    feeBufferPct: 0.04,
    orderCash: 16000,
    initialEquity: 100000,
    cooldownDays: 2
  });

  assert.equal(result.rows.length, 45);
  assert.ok(result.trades.length > 0);
  assert.ok(result.summary.totalProfit > 0);
  assert.ok(result.summary.finalEquity > 100000);
});
