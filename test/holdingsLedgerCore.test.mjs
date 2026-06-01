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

  const [agg] = aggregateByCode(transactions, snapshotsByCode, { todayDate: '2026-05-29' });
  assert.equal(agg.todayProfit, 20);
  assert.equal(agg.todayReturnRate, 2);
  assert.equal(agg.hasTodayNav, true);

  const summary = summarizePortfolio([agg]);
  assert.equal(summary.todayProfit, 20);
  assert.equal(summary.todayReturnRate, 2);
});

test('境内场外基金净值日期未到今天时不显示昨天当日收益', () => {
  const transactions = [{
    id: 'buy-otc-stale',
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

  const [agg] = aggregateByCode(transactions, snapshotsByCode, { todayDate: '2026-06-02' });
  assert.equal(agg.hasExpectedNav, false);
  assert.equal(agg.hasTodayNav, false);
  assert.equal(agg.todayProfit, 0);
  assert.equal(agg.todayReturnRate, 0);

  const summary = summarizePortfolio([agg]);
  assert.equal(summary.todayReadyCount, 0);
  assert.equal(summary.todayProfit, 0);
  assert.equal(summary.todayReturnRate, 0);
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

test('场内 ETF 使用 price/previousClose 计算当日收益', () => {
  const transactions = [{
    id: 'buy-513100',
    code: '513100',
    name: '纳指ETF国泰',
    kind: 'exchange',
    type: 'BUY',
    date: '2026-05-20',
    price: 2.2,
    shares: 1000
  }];
  const navResult = {
    items: [{
      code: '513100',
      name: '纳指ETF国泰',
      price: 2.365,
      currentPrice: 2.365,
      close: 2.365,
      previousClose: 2.273,
      previousNav: 2.273,
      change: 0.092,
      changePercent: 4.05,
      latestNav: 2.065,
      latestNavDate: '2026-05-29'
    }]
  };
  const { snapshotsByCode } = mergeSnapshotsFromNavResult({}, navResult);

  const [agg] = aggregateByCode(transactions, snapshotsByCode, { todayDate: '2026-06-01' });
  assert.equal(agg.kind, 'exchange');
  assert.equal(agg.currentPrice, 2.365);
  assert.equal(agg.previousPrice, 2.273);
  assert.equal(agg.hasTodayNav, true);
  assert.equal(agg.todayProfit, 92.06);
  assert.equal(agg.todayReturnRate, 4.05);
});
