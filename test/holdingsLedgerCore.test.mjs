import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aggregateByCode, summarizePortfolio } from '../src/app/holdingsLedgerCore.js';

test('场外持仓刷新后从 latest/previous NAV 反推当日收益率', () => {
  const transactions = [{
    id: 'buy-1',
    code: '000001',
    name: '场外测试基金',
    kind: 'otc',
    type: 'BUY',
    date: '2026-05-20',
    price: 1,
    shares: 1000
  }];
  const snapshotsByCode = {
    '000001': {
      code: '000001',
      name: '场外测试基金',
      latestNav: 1.02,
      latestNavDate: '2026-05-29',
      previousNav: 1,
      previousNavDate: '2026-05-28',
      changePercent: null
    }
  };

  const [agg] = aggregateByCode(transactions, snapshotsByCode, { todayDate: '2026-06-01' });
  assert.equal(agg.todayProfit, 20);
  assert.equal(agg.todayReturnRate, 2);
  assert.equal(agg.hasTodayNav, true);

  const summary = summarizePortfolio([agg]);
  assert.equal(summary.todayProfit, 20);
  assert.equal(summary.todayReturnRate, 2);
});
