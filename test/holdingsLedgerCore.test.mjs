import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aggregateByCode, summarizePortfolio } from '../src/app/holdingsLedgerCore.js';
import { mergeSnapshotsFromNavResult } from '../src/app/holdingsLedger.js';

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

test('场外 QDII 使用 fund-metrics 规范化后的 previousNav', () => {
  const transactions = [{
    id: 'buy-021000',
    code: '021000',
    name: '景顺长城纳斯达克科技市值加权ETF联接(QDII)A',
    kind: 'otc',
    type: 'BUY',
    date: '2026-05-20',
    price: 2.3,
    shares: 1000
  }];
  const navResult = {
    items: [{
      code: '021000',
      name: '',
      latestNav: 2.368,
      latestNavDate: '2026-05-29',
      previousNav: 2.362,
      previousNavDate: '',
      previousClose: 2.362,
      change: 0.006,
      changePercent: 0.254
    }]
  };
  const { snapshotsByCode } = mergeSnapshotsFromNavResult({}, navResult);

  const [agg] = aggregateByCode(transactions, snapshotsByCode, { todayDate: '2026-06-01' });
  assert.equal(agg.kind, 'qdii');
  assert.equal(agg.currentPrice, 2.368);
  assert.equal(agg.previousPrice, 2.362);
  assert.equal(agg.hasPreviousNav, true);
  assert.equal(agg.hasTodayNav, true);
  assert.equal(agg.todayProfit, 5.91);
  assert.equal(agg.todayReturnRate, 0.25);
});
