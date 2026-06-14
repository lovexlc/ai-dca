import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adjustSwitchPaperCash,
  createDefaultSwitchPaperState,
  executeSwitchPaperTrade
} from '../workers/notify/src/premiumPaperTrading.js';

const SNAPSHOT = {
  computedAt: '2026-06-12T02:00:00.000Z',
  byBenchmark: [{
    benchmarkCode: '159513',
    benchmarkName: '纳指科技 ETF',
    benchmarkPrice: 1.8,
    benchmarkOrderBook: {
      bidPrice: 1.8,
      bidVolume: 50000,
      askPrice: 1.801,
      askVolume: 40000
    },
    candidates: [{
      code: '513100',
      name: '纳指 ETF',
      price: 1.49,
      orderBook: {
        bidPrice: 1.489,
        bidVolume: 60000,
        askPrice: 1.49,
        askVolume: 55000
      }
    }]
  }]
};

const TRIGGER = {
  pairKey: '159513:513100',
  rule: 'B',
  fromCode: '159513',
  fromName: '纳指科技 ETF',
  toCode: '513100',
  toName: '纳指 ETF',
  gapPct: 3.4,
  threshold: 3,
  benchClass: 'H',
  candClass: 'L'
};

test('switch paper trading writes paired sell and buy fills', () => {
  const before = createDefaultSwitchPaperState();
  const result = executeSwitchPaperTrade(before, SNAPSHOT, TRIGGER, '2026-06-12T02:00:00.000Z');

  assert.equal(result.executed, true);
  assert.equal(result.fills.length, 2);
  assert.equal(result.fills[0].side, 'SELL');
  assert.equal(result.fills[0].code, '159513');
  assert.equal(result.fills[1].side, 'BUY');
  assert.equal(result.fills[1].code, '513100');
  assert.equal(result.fills[0].quantity % before.lotSize, 0);
  assert.equal(result.fills[1].quantity % before.lotSize, 0);
  assert.ok(result.state.positions['159513'].shares < before.positions['159513'].shares);
  assert.ok(result.state.positions['513100'].shares > before.positions['513100'].shares);
  assert.equal(result.state.orders.length, 2);
  assert.equal(result.state.executionsToday, 1);
  assert.equal(result.state.lastStatus, 'executed');
});

test('switch paper trading respects daily execution limit', () => {
  const before = createDefaultSwitchPaperState({
    maxExecutionsPerDay: 1,
    executionsToday: 1,
    lastExecutionDate: '2026-06-12'
  });
  const result = executeSwitchPaperTrade(before, SNAPSHOT, TRIGGER, '2026-06-12T02:01:00.000Z');

  assert.equal(result.executed, false);
  assert.equal(result.skipped, 'daily-limit');
  assert.equal(result.fills.length, 0);
  assert.equal(result.state.orders.length, 0);
});

test('switch paper trading skips OTC triggers', () => {
  const before = createDefaultSwitchPaperState();
  const result = executeSwitchPaperTrade(before, SNAPSHOT, {
    kind: 'otc',
    pairKey: 'otc:513100:159501',
    rule: 'OTC_STRONG',
    fromCode: '513100',
    toCode: '159501'
  }, '2026-06-12T02:02:00.000Z');

  assert.equal(result.executed, false);
  assert.equal(result.skipped, 'unsupported-trigger');
  assert.equal(result.fills.length, 0);
});

test('paper cash adjustment records cash ledger entries', () => {
  const before = createDefaultSwitchPaperState({ cash: 60000 });
  const deposited = adjustSwitchPaperCash(before, {
    amount: 5000,
    note: 'add cash',
    timestamp: '2026-06-12T02:03:00.000Z'
  });
  assert.equal(deposited.adjusted, true);
  assert.equal(deposited.state.cash, 65000);
  assert.equal(deposited.state.cashEvents.length, 1);
  assert.equal(deposited.state.cashEvents[0].type, 'deposit');
  assert.equal(deposited.state.cashEvents[0].amount, 5000);

  const withdrawn = adjustSwitchPaperCash(deposited.state, {
    amount: -70000,
    note: 'withdraw cash',
    timestamp: '2026-06-12T02:04:00.000Z'
  });
  assert.equal(withdrawn.state.cash, 0);
  assert.equal(withdrawn.state.cashEvents[0].type, 'withdraw');
  assert.equal(withdrawn.state.cashEvents[0].amount, 65000);
});
