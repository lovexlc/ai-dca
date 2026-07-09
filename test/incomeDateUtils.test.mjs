import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyCurrentSnapshotDailyPnl,
  resolveIncomeEffectiveDate
} from '../src/app/income/incomeDateUtils.js';

test('收益页交易日使用当前披露日而不是滞后一日的 NAV 日期', () => {
  const date = resolveIncomeEffectiveDate({
    latestNavDate: '2026-07-08',
    todayReadyCount: 3,
    todayProfit: 418
  }, '2026-07-09');

  assert.equal(date, '2026-07-09');
});

test('收益页非交易日不把上个交易日收益挂到周末', () => {
  const date = resolveIncomeEffectiveDate({
    latestNavDate: '2026-07-17',
    navDateCoverage: 'full',
    todayReadyCount: 3,
    todayProfit: 100
  }, '2026-07-18');

  assert.equal(date, '2026-07-17');
});

test('日历最新 snapshot 收益覆写到当前披露日并清理同值 NAV 日重复项', () => {
  const daily = applyCurrentSnapshotDailyPnl({
    '2026-07-08': 418
  }, {
    portfolio: {
      latestNavDate: '2026-07-08',
      todayProfit: 418
    },
    currentSnapshotDate: '2026-07-09',
    fromIso: '2026-07-01',
    toIso: '2026-07-31'
  });

  assert.equal(daily['2026-07-08'], undefined);
  assert.equal(daily['2026-07-09'], 418);
});
