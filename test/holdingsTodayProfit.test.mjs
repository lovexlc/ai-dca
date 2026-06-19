import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLotMetrics } from '../src/app/holdingsLedgerCore.js';
import { isTradingDayShanghai } from '../src/app/holidaysCN.js';

// 选定一个干净的周（2026-07，无 A 股节假日）：周五交易日 + 周六非交易日。
const FRIDAY = '2026-07-17';
const SATURDAY = '2026-07-18';

test('chosen fixture dates have the expected trading-day status', () => {
  assert.equal(isTradingDayShanghai(FRIDAY), true, `${FRIDAY} 应为交易日`);
  assert.equal(isTradingDayShanghai(SATURDAY), false, `${SATURDAY} 应为非交易日`);
});

// 场外基金（非场内、非 QDII 代码）：最新披露净值为周五。
const OTC_TX = { code: '888888', name: '测试场外基金', type: 'BUY', date: '2026-01-05', shares: 1000, price: 1.0 };
const OTC_SNAPSHOT = { latestNav: 1.1, previousNav: 1.0, latestNavDate: FRIDAY, previousNavDate: '2026-07-16' };

test('交易日：场外基金计入当日收益', () => {
  const m = buildLotMetrics(OTC_TX, OTC_SNAPSHOT, { todayDate: FRIDAY });
  assert.equal(m.hasTodayNav, true);
  // previousValue(1.0 * 1000) * 10% = 100
  assert.equal(m.todayProfit, 100);
  assert.equal(m.todayReturnRate, 10);
});

test('非交易日（周六）：场外基金不应把周五收益记成今日收益', () => {
  const m = buildLotMetrics(OTC_TX, OTC_SNAPSHOT, { todayDate: SATURDAY });
  assert.equal(m.hasTodayNav, false, '周六不应有今日净值');
  assert.equal(m.todayProfit, 0, '周六今日收益应为 0');
  assert.equal(m.todayReturnRate, 0);
});

// QDII 同理（T-1 披露），非交易日也不应计入今日收益。
const QDII_TX = { code: '513100', name: '纳指ETF', type: 'BUY', date: '2026-01-05', shares: 1000, price: 1.0, kind: 'qdii' };
const QDII_SNAPSHOT = { latestNav: 1.05, previousNav: 1.0, latestNavDate: FRIDAY, previousNavDate: '2026-07-16' };

test('非交易日（周六）：QDII 不应把最新披露日收益记成今日收益', () => {
  const m = buildLotMetrics(QDII_TX, QDII_SNAPSHOT, { todayDate: SATURDAY });
  assert.equal(m.todayProfit, 0);
  assert.equal(m.todayReturnRate, 0);
});

// 未实现收益与今日收益无关，应始终基于最新净值计算（即便非交易日）。
test('非交易日仍展示持有收益（市值/未实现），仅今日收益归零', () => {
  const m = buildLotMetrics(OTC_TX, OTC_SNAPSHOT, { todayDate: SATURDAY });
  assert.equal(m.marketValue, 1100, '市值应按最新净值计算');
  assert.equal(m.unrealizedProfit, 100, '持有收益不受非交易日影响');
});
