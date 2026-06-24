import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyMarketQuotesToQuantState,
  buildSimulatedOrderPlan,
  computeAccountSummary,
  evaluateRealtimeAutoExecution,
  executeSimulatedSwitch,
  normalizeQuantState,
  recordRealtimeExecution
} from '../src/app/quantTrading.js';
import { runBacktest } from '../src/app/backtest/index.js';

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
  const start = Math.floor(Date.UTC(2026, 5, 12, 1, 30) / 1000);
  const candles = Array.from({ length: 16 }, (_, index) => ({
    t: start + index * 300,
    c: 1 + index * 0.001
  }));
  const result = runBacktest({
    type: 'premium-spread',
    highCodes: ['159513'],
    lowCodes: ['513100'],
    activeSide: 'all',
    intraSellLowerPct: 1,
    intraBuyOtherPct: 0.2
  }, {
    timeframe: '5m',
    initialEquity: 100000,
    historyByCode: {
      '159513': candles.map((item) => ({ ...item, c: item.c + 0.02 })),
      '513100': candles
    },
    navHistoryByCode: {
      '159513': [{ date: '2026-06-12', nav: 1 }],
      '513100': [{ date: '2026-06-12', nav: 1 }]
    }
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.summary.sampleCount, 16);
  assert.ok(result.trades.length > 0);
  assert.ok(result.summary.signalCount > 0);
  assert.ok(result.summary.finalEquity > 0);
});

test('xueqiu quote payload updates simulated bid ask and iopv fields', () => {
  const state = normalizeQuantState();
  const result = applyMarketQuotesToQuantState(state, {
    '159513': {
      code: '159513',
      name: '纳斯达克100ETF',
      price: 1.781,
      iopv: 1.768,
      asOf: '2026-06-12T02:00:00.000Z',
      source: 'xueqiu-quote',
      orderBook: {
        bidPrice: 1.78,
        bidVolume: 30000,
        askPrice: 1.781,
        askVolume: 28000
      }
    },
    '513100': {
      code: '513100',
      name: '纳指ETF',
      price: 1.501,
      iopv: 1.497,
      asOf: '2026-06-12T02:00:01.000Z',
      source: 'xueqiu-quote',
      orderBook: {
        bidPrice: 1.5,
        bidVolume: 50000,
        askPrice: 1.501,
        askVolume: 42000
      }
    }
  }, { refreshedAt: '2026-06-12T02:00:02.000Z' });

  assert.deepEqual(result.updatedSymbols.sort(), ['159513', '513100'].sort());
  assert.equal(result.state.quotes['159513'].bid, 1.78);
  assert.equal(result.state.quotes['159513'].ask, 1.781);
  assert.equal(result.state.quotes['159513'].bidSize, 30000);
  assert.equal(result.state.quotes['513100'].iopv, 1.497);
  assert.equal(result.state.realtime.lastStatus, 'updated');
  assert.equal(result.state.realtime.lastQuoteAt, '2026-06-12T02:00:01.000Z');
});

test('realtime auto execution requires session and daily execution capacity', () => {
  const state = normalizeQuantState({
    realtime: {
      autoExecute: true,
      onlyTradingSession: true,
      maxExecutionsPerDay: 1
    }
  });

  const openDecision = evaluateRealtimeAutoExecution(state, { isTradingSession: true });
  assert.equal(openDecision.ok, true);

  const closedDecision = evaluateRealtimeAutoExecution(state, { isTradingSession: false });
  assert.equal(closedDecision.ok, false);
  assert.equal(closedDecision.reason, '非 A 股交易时段');

  const executed = recordRealtimeExecution(state, new Date().toISOString());
  const limitedDecision = evaluateRealtimeAutoExecution(executed, { isTradingSession: true });
  assert.equal(limitedDecision.ok, false);
  assert.equal(limitedDecision.reason, '已达到今日自动执行上限');
});
