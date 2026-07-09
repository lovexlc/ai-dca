import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectTodaySignalKeys,
  filterDismissedExitSignals,
  filterDismissedSwitchSignals,
  summarizeExitSignals,
  summarizeSwitchSignals
} from '../src/app/todaySignals.js';

test('summarizeSwitchSignals counts unique funds from worker snapshot', () => {
  const summary = summarizeSwitchSignals({
    signals: [
      { kind: 'A', from: '513100', to: '159501' },
      { kind: 'B', from: '513100', to: '159941' },
    ],
    otcSignal: {
      ready: true,
      triggered: true,
      benchCode: '513100',
      lowestCode: '159696',
      level: '强信号',
    },
  });

  assert.equal(summary.signalCount, 3);
  assert.equal(summary.count, 4);
  assert.deepEqual(summary.codes.sort(), ['159501', '159696', '159941', '513100']);
  assert.equal(summary.rows.every((row) => row.key), true);
});

test('summarizeExitSignals uses existing sell plan rules against holding prices', () => {
  const summary = summarizeExitSignals([
    {
      id: 'sell-1',
      name: '测试卖出',
      symbol: '513100',
      holdingCost: 2,
      holdingShares: 100,
      gainTriggers: [10, 20, 30],
      sellRatios: [33, 33, 34],
    },
  ], [
    { code: '513100', currentPrice: 2.45 },
  ]);

  assert.equal(summary.count, 1);
  assert.equal(summary.rows[0].code, '513100');
  assert.equal(summary.rows[0].tierCount, 2);
  assert.equal(Boolean(summary.rows[0].key), true);
});

test('today signal summaries can filter dismissed signal keys', () => {
  const switchSummary = summarizeSwitchSignals({
    signals: [
      { kind: 'A', from: '513100', to: '159501' },
      { kind: 'B', from: '513100', to: '159941' },
    ],
  });
  const exitSummary = summarizeExitSignals([
    {
      id: 'sell-1',
      name: '测试卖出',
      symbol: '513100',
      holdingCost: 2,
      holdingShares: 100,
      gainTriggers: [10, 20, 30],
      sellRatios: [33, 33, 34],
    },
  ], [
    { code: '513100', currentPrice: 2.45 },
  ]);
  const dismissed = new Set([switchSummary.rows[0].key, exitSummary.rows[0].key]);
  const nextSwitch = filterDismissedSwitchSignals(switchSummary, dismissed);
  const nextExit = filterDismissedExitSignals(exitSummary, dismissed);

  assert.equal(collectTodaySignalKeys(switchSummary, exitSummary).length, 3);
  assert.equal(nextSwitch.signalCount, 1);
  assert.equal(nextSwitch.count, 2);
  assert.deepEqual(nextSwitch.codes.sort(), ['159941', '513100']);
  assert.equal(nextExit.count, 0);
  assert.equal(nextExit.rows.length, 0);
});
