import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCashYieldToDailyPnlMap,
  applyCashYieldToPortfolioSummary,
  cashYieldDailyAmount,
  cashYieldIncomeBetween,
} from '../src/app/cashYield.js';
import { buildPortfolioSeries } from '../src/app/portfolioSeries.js';

test('cash yield uses calendar-day annualized income', () => {
  const value = { cashAmount: 36500, annualRate: 3.65 };
  assert.equal(cashYieldDailyAmount(value), 3.65);
  assert.equal(cashYieldIncomeBetween(value, '2026-01-01', '2026-01-01'), 3.65);
  assert.equal(cashYieldIncomeBetween(value, '2026-01-01', '2026-01-03'), 10.95);
});

test('cash yield augments portfolio summary without changing fund market value', () => {
  const summary = applyCashYieldToPortfolioSummary({
    marketValue: 7000,
    todayProfit: 10,
    previousMarketValue: 7000,
    unrealizedProfit: 100,
    cumulativeProfit: 120,
    cumulativeCostBasis: 7000,
  }, { cashAmount: 3000, annualRate: 3.65 }, '2026-01-01', '2026-01-03');

  assert.equal(summary.marketValue, 7000);
  assert.equal(summary.cashYieldDailyIncome, 0.3);
  assert.equal(summary.cashYieldCumulativeIncome, 0.9);
  assert.equal(summary.todayProfit, 10.3);
  assert.equal(summary.previousMarketValue, 10000);
  assert.equal(summary.cumulativeProfit, 120.9);
  assert.equal(summary.cumulativeCostBasis, 10000);
});

test('cash yield fills calendar dates even when fund pnl has no rows', () => {
  assert.deepEqual(
    addCashYieldToDailyPnlMap({}, { cashAmount: 36500, annualRate: 3.65 }, '2026-01-01', '2026-01-03'),
    { '2026-01-01': 3.65, '2026-01-02': 3.65, '2026-01-03': 3.65 }
  );
});

test('portfolio series includes cash yield in daily pnl and TWR', () => {
  const result = buildPortfolioSeries({
    tx: [{ code: '000001', type: 'BUY', date: '2026-01-01', shares: 100, price: 10 }],
    navByCode: { '000001': [{ date: '2026-01-01', nav: 10 }, { date: '2026-01-02', nav: 10 }] },
    from: '2026-01-01',
    to: '2026-01-02',
    cashYield: { cashAmount: 36500, annualRate: 3.65 },
  });

  assert.equal(result.dailySeries[0].pnl, 3.65);
  assert.equal(result.dailySeries[1].pnl, 7.3);
  assert.equal(result.windowProfit, 7.3);
  assert.ok(result.twrReturnRate > 0);
});
