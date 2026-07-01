import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateByCode,
  buildBuyTransactionPerformance,
  computeSwitchChainMetrics,
  getActiveHoldingCodeList,
  getTransactionAmount,
  getTransactionErrors,
  normalizeTransaction,
  summarizePortfolio
} from '../src/app/holdingsLedgerCore.js';
import { mergeSnapshotsFromNavResult } from '../src/app/holdingsLedger.js';
import { getKnownQdiiFundName } from '../src/app/qdiiFundCodes.js';

test('LOF transaction can be explicitly recorded as exchange', () => {
  const tx = normalizeTransaction({
    code: '161130',
    name: '易方达纳斯达克100ETF联接(QDII-LOF)A',
    kind: 'exchange',
    type: 'BUY',
    date: '2026-06-30',
    price: 1.234,
    shares: 1000
  });

  assert.equal(tx.kind, 'exchange');
  assert.deepEqual(tx.tags, ['exchange']);
});

test('交易记录 BUY 明细：未卖出按持有至今收益，已卖出按买入到卖出收益', () => {
  const transactions = [
    { id: 'buy-sold', code: '513100', name: '纳指ETF', kind: 'exchange', type: 'BUY', date: '2026-01-01', price: 1, shares: 100 },
    { id: 'sell-sold', code: '513100', name: '纳指ETF', kind: 'exchange', type: 'SELL', date: '2026-02-01', price: 1.2, shares: 100 },
    { id: 'buy-hold', code: '513100', name: '纳指ETF', kind: 'exchange', type: 'BUY', date: '2026-03-01', price: 1.5, shares: 200 }
  ];
  const performance = buildBuyTransactionPerformance(transactions, {
    '513100': { code: '513100', name: '纳指ETF', price: 1.8 }
  });

  assert.equal(performance['buy-sold'].status, 'sold');
  assert.equal(performance['buy-sold'].profit, 20);
  assert.equal(performance['buy-sold'].returnRate, 20);
  assert.equal(performance['buy-sold'].label, '已卖出');

  assert.equal(performance['buy-hold'].status, 'holding');
  assert.equal(performance['buy-hold'].profit, 60);
  assert.equal(performance['buy-hold'].returnRate, 20);
  assert.equal(performance['buy-hold'].label, '持有至今');
});

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

test('境内场外基金最新净值达到预期披露日时计算最新披露日收益', () => {
  const transactions = [{
    id: 'buy-otc-expected',
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
      latestNavDate: '2026-06-02',
      previousNav: 1,
      previousNavDate: '2026-06-01',
      changePercent: null
    }
  };

  const [agg] = aggregateByCode(transactions, snapshotsByCode, { todayDate: '2026-06-03' });
  assert.equal(agg.hasExpectedNav, true);
  assert.equal(agg.hasTodayNav, true);
  assert.equal(agg.todayProfit, 20);
  assert.equal(agg.todayReturnRate, 2);

  const summary = summarizePortfolio([agg]);
  assert.equal(summary.todayReadyCount, 1);
  assert.equal(summary.todayProfit, 20);
  assert.equal(summary.todayReturnRate, 2);
});

test('场外 QDII 上一净值日可视为预期覆盖并计入最新披露日收益', () => {
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
  assert.equal(agg.hasExpectedNav, true);
  assert.equal(agg.hasTodayNav, true);
  assert.equal(agg.todayProfit, 5.91);
  assert.equal(agg.todayReturnRate, 0.25);

  const summary = summarizePortfolio([agg]);
  assert.equal(summary.navDateCoverage, 'full');
  assert.equal(summary.todayReadyCount, 1);
  assert.equal(summary.todayProfit, 5.91);
  assert.equal(summary.todayReturnRate, 0.25);
});

test('持仓收益保留交易侧明确 QDII 分类的披露日规则', () => {
  const transactions = [{
    id: 'buy-explicit-qdii',
    code: '099999',
    name: '项目侧分类基金',
    kind: 'qdii',
    type: 'BUY',
    date: '2026-05-20',
    price: 1,
    shares: 1000
  }];
  const snapshotsByCode = {
    '099999': {
      code: '099999',
      latestNav: 1.05,
      latestNavDate: '2026-06-02',
      previousNav: 1,
      previousNavDate: '2026-06-01',
      changePercent: 3
    }
  };

  const [agg] = aggregateByCode(transactions, snapshotsByCode, { todayDate: '2026-06-03' });
  assert.equal(agg.kind, 'qdii');
  assert.equal(agg.hasExpectedNav, true);
  assert.equal(agg.hasTodayNav, true);
  assert.equal(agg.todayProfit, 30);
  assert.equal(agg.todayReturnRate, 3);

  const summary = summarizePortfolio([agg]);
  assert.equal(summary.todayReadyCount, 1);
  assert.equal(summary.todayProfit, 30);
  assert.equal(summary.todayReturnRate, 3);
});

test('持仓分类通过全量 QDII 代码表识别不含 QDII 名称的基金', () => {
  const transactions = [{
    id: 'buy-021778',
    code: '021778',
    name: '海外指数基金',
    kind: 'otc',
    type: 'BUY',
    date: '2026-05-20',
    price: 1,
    shares: 1000
  }];
  const snapshotsByCode = {
    '021778': {
      code: '021778',
      latestNav: 1.02,
      latestNavDate: '2026-06-04',
      previousNav: 1,
      previousNavDate: '2026-06-03'
    }
  };

  const [agg] = aggregateByCode(transactions, snapshotsByCode, { todayDate: '2026-06-05' });
  assert.equal(agg.kind, 'qdii');
  assert.equal(agg.hasTodayNav, true);
});

test('全量 QDII 代码表提供新增持仓名称回填', () => {
  assert.equal(getKnownQdiiFundName('021000'), '南方纳斯达克100指数发起(QDII)I');
  assert.equal(getKnownQdiiFundName('999999'), '');
});

test('场外 QDII 净值日期等于今天时仍计算最新披露日收益', () => {
  const transactions = [{
    id: 'buy-021000-today',
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
      latestNavDate: '2026-06-01',
      previousNav: 2.362,
      previousNavDate: '2026-05-29',
      previousClose: 2.362,
      change: 0.006,
      changePercent: 0.254
    }]
  };
  const { snapshotsByCode } = mergeSnapshotsFromNavResult({}, navResult);

  const [agg] = aggregateByCode(transactions, snapshotsByCode, { todayDate: '2026-06-01' });
  assert.equal(agg.kind, 'qdii');
  assert.equal(agg.hasExpectedNav, true);
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
      latestNavDate: '2026-05-29',
      asOf: '2026-06-01T02:00:00.000Z',
      quoteDate: '2026-06-01'
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

test('切换链路未卖出场内 ETF 使用实时价格而不是净值', () => {
  const chain = {
    id: 'chain-realtime-price',
    name: '实时价链路',
    legs: [{ buyTxId: 'buy-513100' }]
  };
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
  const metrics = computeSwitchChainMetrics(chain, transactions, {
    '513100': {
      code: '513100',
      name: '纳指ETF国泰',
      price: 2.365,
      currentPrice: 2.365,
      close: 2.365,
      latestNav: 2.065,
      latestNavDate: '2026-05-29'
    }
  });

  assert.equal(metrics.valid, true);
  assert.equal(metrics.segments[0].sellPrice, 2.365);
  assert.equal(metrics.baselineEndPrice, 2.365);
  assert.deepEqual(metrics.missingPriceCodes, []);
});

test('场内 ETF 行情时间不是今天时不显示今日收益', () => {
  const transactions = [{
    id: 'buy-513100-stale',
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
      latestNavDate: '2026-05-29',
      asOf: '2026-06-01T07:00:00.000Z',
      quoteDate: '2026-06-01'
    }]
  };
  const { snapshotsByCode } = mergeSnapshotsFromNavResult({}, navResult);

  const [agg] = aggregateByCode(transactions, snapshotsByCode, { todayDate: '2026-06-02' });
  assert.equal(agg.kind, 'exchange');
  assert.equal(agg.quoteDate, '2026-06-01');
  assert.equal(agg.hasTodayNav, false);
  assert.equal(agg.todayProfit, 0);
  assert.equal(agg.todayReturnRate, 0);

  const summary = summarizePortfolio([agg]);
  assert.equal(summary.todayReadyCount, 0);
  assert.equal(summary.todayProfit, 0);
  assert.equal(summary.todayReturnRate, 0);
});

test('场外 BUY 可先录入金额，净值确认后自动推导份额', () => {
  const pending = {
    id: 'buy-otc-amount',
    code: '000001',
    name: '场外测试基金',
    kind: 'otc',
    type: 'BUY',
    date: '2026-06-01',
    price: 0,
    shares: 0,
    amount: 1000
  };

  assert.deepEqual(getTransactionErrors(pending), {});

  const confirmed = normalizeTransaction({ ...pending, price: 1.2345 });
  assert.equal(confirmed.amount, 1000);
  assert.equal(confirmed.shares, 810.0446);

  const [agg] = aggregateByCode([confirmed], {
    '000001': {
      code: '000001',
      latestNav: 1.2345,
      latestNavDate: '2026-06-01',
      previousNav: 1.2,
      previousNavDate: '2026-05-29'
    }
  }, { todayDate: '2026-06-01' });
  assert.equal(agg.totalShares, 810.0446);
  assert.equal(agg.totalCost, 1000);
});

test('价格和份额导入的交易自动推导金额', () => {
  const exchangeBuy = normalizeTransaction({
    id: 'exchange-buy-imported',
    code: '513100',
    name: '纳指ETF国泰',
    kind: 'exchange',
    type: 'BUY',
    date: '2026-06-01',
    price: 1.2345,
    shares: 1000
  });
  const exchangeSell = normalizeTransaction({
    id: 'exchange-sell-imported',
    code: '513100',
    name: '纳指ETF国泰',
    kind: 'exchange',
    type: 'SELL',
    date: '2026-06-02',
    price: 1.25,
    shares: 800,
    amount: 0
  });
  const otcBuy = normalizeTransaction({
    id: 'otc-buy-imported',
    code: '000001',
    name: '场外测试基金',
    kind: 'otc',
    type: 'BUY',
    date: '2026-06-01',
    price: 1.5,
    shares: 600
  });

  assert.equal(exchangeBuy.amount, 1234.5);
  assert.equal(exchangeSell.amount, 1000);
  assert.equal(otcBuy.amount, 900);
  assert.equal(getTransactionAmount({ amount: 0, price: 2.3456, shares: 100 }), 234.56);
});

test('场外待确认 BUY 金额计入行市值和组合总市值', () => {
  const pendingBuy = {
    id: 'pending-buy-amount',
    code: '000001',
    name: '场外测试基金',
    kind: 'otc',
    type: 'BUY',
    date: '2026-06-02',
    price: 0,
    shares: 0,
    amount: 1000
  };
  const confirmedBuy = {
    id: 'confirmed-buy',
    code: '000001',
    name: '场外测试基金',
    kind: 'otc',
    type: 'BUY',
    date: '2026-05-29',
    price: 1,
    shares: 500
  };

  const [agg] = aggregateByCode([confirmedBuy, pendingBuy], {
    '000001': {
      code: '000001',
      latestNav: 1.1,
      latestNavDate: '2026-06-02',
      previousNav: 1,
      previousNavDate: '2026-06-01'
    }
  }, { todayDate: '2026-06-02' });

  assert.equal(agg.totalShares, 500);
  assert.equal(agg.pendingBuyAmount, 1000);
  assert.equal(agg.marketValue, 1550);
  assert.equal(agg.totalCost, 1500);
  assert.equal(agg.unrealizedProfit, 50);

  const summary = summarizePortfolio([agg]);
  assert.equal(summary.marketValue, 1550);
  assert.equal(summary.totalCost, 1500);
  assert.equal(summary.unrealizedProfit, 50);
  assert.deepEqual(getActiveHoldingCodeList([pendingBuy]), ['000001']);
});
