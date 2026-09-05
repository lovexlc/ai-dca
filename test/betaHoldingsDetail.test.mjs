import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_DETAIL_STATS,
  buildTimeline,
  createHoldingsDetailController,
  errorMessage
} from '../src/beta/data/holdingsDetailCore.js';

const NOW = 1757000000000;

const LEDGER = {
  transactions: [
    { id: 't1', code: '513870', name: '标普500ETF', kind: 'exchange', type: 'BUY', date: '2026-01-05', shares: 1000, price: 1 },
    { id: 't2', code: '513870', type: 'BUY', date: '2026-02-05', shares: 1000, price: 1.2 },
    { id: 't3', code: '513870', type: 'SELL', date: '2026-03-05', shares: 500, price: 1.5 },
    { id: 't4', code: '159941', type: 'BUY', date: '2026-01-06', shares: 200, price: 2 },
    { id: 't5', code: '513870', type: 'DIVIDEND', date: '2026-03-06', shares: 0, price: 0 },
    { id: 't6', code: 'bad-code', type: 'BUY', date: '2026-01-01', shares: 1, price: 1 }
  ],
  snapshotsByCode: { '513870': { latestNav: 1.3 } }
};

function createController(overrides = {}) {
  const calls = [];
  const deps = {
    readLedger: () => LEDGER,
    callAction: async (action, params) => {
      calls.push({ action, params });
      return { ok: true, quotes: { '513870': { price: 1.4, changePercent: 2 } } };
    },
    now: () => NOW,
    ...overrides
  };
  return { controller: createHoldingsDetailController(deps), calls };
}

// ---------- 流水回放 ----------

test('只回放这一只基金的流水', () => {
  const timeline = buildTimeline(LEDGER.transactions, '513870');
  assert.equal(timeline.rows.length, 3);
  assert.equal(timeline.name, '标普500ETF');
  assert.equal(timeline.kind, 'exchange');
  assert.deepEqual(timeline.rows.map((row) => row.type), ['BUY', 'BUY', 'SELL']);
});

test('买入摊薄均价，卖出不改均价只结转已实现', () => {
  const rows = buildTimeline(LEDGER.transactions, '513870').rows;
  assert.equal(rows[0].avgCostAfter, 1);
  assert.equal(rows[1].avgCostAfter, 1.1, '1000@1 + 1000@1.2 → 均价 1.1');
  assert.equal(rows[2].realized, 200, '500 份 ×（1.5 − 1.1）');
  assert.equal(rows[2].avgCostAfter, 1.1, '卖出不改剩余份额均价');
  assert.equal(rows[2].sharesAfter, 1500);
  assert.equal(rows[2].amount, 750);
});

test('汇总：份额、成本、已实现、日期区间', () => {
  const stats = buildTimeline(LEDGER.transactions, '513870').stats;
  assert.equal(stats.txCount, 3);
  assert.equal(stats.buys, 2);
  assert.equal(stats.sells, 1);
  assert.equal(stats.buyShares, 2000);
  assert.equal(stats.buyAmount, 2200);
  assert.equal(stats.sellShares, 500);
  assert.equal(stats.sellAmount, 750);
  assert.equal(stats.realized, 200);
  assert.equal(stats.shares, 1500);
  assert.equal(stats.cost, 1650);
  assert.equal(stats.avgCost, 1.1);
  assert.equal(stats.firstDate, '2026-01-05');
  assert.equal(stats.lastDate, '2026-03-05');
  assert.equal(stats.ignored, 1, '分红这条不猜，计数交给页面提示');
});

test('没填日期的当最早，均价不会算反', () => {
  const rows = buildTimeline([
    { code: '513870', type: 'SELL', date: '2026-02-01', shares: 100, price: 2 },
    { code: '513870', type: 'BUY', date: '', shares: 200, price: 1 }
  ], '513870').rows;
  assert.equal(rows[0].type, 'BUY');
  assert.equal(rows[1].realized, 100, '先买 200@1 再卖 100@2');
});

test('卖超了截断到 0 并标出那一行', () => {
  const result = buildTimeline([
    { code: '513870', type: 'BUY', date: '2026-01-01', shares: 100, price: 1 },
    { code: '513870', type: 'SELL', date: '2026-01-02', shares: 150, price: 2 }
  ], '513870');
  assert.equal(result.rows[1].oversold, true);
  assert.equal(result.rows[1].sharesAfter, 0);
  assert.equal(result.rows[1].realized, 100);
  assert.equal(result.stats.shares, 0);
  assert.equal(result.stats.cost, 0);
  assert.equal(result.stats.avgCost, 0);
});

test('代码不识别或流水为空时给空结构', () => {
  assert.deepEqual(buildTimeline(LEDGER.transactions, 'abc'), {
    rows: [],
    stats: { ...EMPTY_DETAIL_STATS },
    name: '',
    kind: ''
  });
  assert.equal(buildTimeline(null, '513870').rows.length, 0);
});

test('异常收敛', () => {
  assert.equal(errorMessage(new Error('boom')), 'boom');
  assert.equal(errorMessage(null), '明细加载失败');
});

// ---------- 加载器 ----------

test('缺依赖时直接报错', () => {
  assert.throws(() => createHoldingsDetailController({}), TypeError);
  assert.throws(() => createHoldingsDetailController({ readLedger: () => ({}) }), /callAction/);
});

test('只为这一个代码请求行情', async () => {
  const { controller, calls } = createController();
  const result = await controller.load({ code: '513870', refresh: true });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'fund-quote');
  assert.deepEqual(calls[0].params.codes, ['513870']);
  assert.equal(calls[0].params.refresh, true);
  assert.equal(result.updatedAt, NOW);
});

test('明细头部与持仓 tab 用同一套估值', async () => {
  const { controller } = createController();
  const result = await controller.load({ code: '513870' });
  assert.equal(result.name, '标普500ETF');
  assert.equal(result.kind, 'exchange');
  assert.equal(result.row.marketValue, 2100, '1500 份 × 1.4');
  assert.equal(result.row.profit, 450);
  assert.equal(result.row.dayProfit, 41.18, '按 +2% 反推昨日市值');
  assert.equal(result.row.estimated, false);
  assert.equal(result.cleared, false);
  assert.equal(result.rows.length, 3);
});

test('行情挂了仍然能看流水，只多一句提示', async () => {
  const { controller } = createController({
    callAction: async () => { throw new Error('行情服务超时'); }
  });
  const result = await controller.load({ code: '513870' });
  assert.equal(result.ok, true);
  assert.equal(result.error, '行情服务超时');
  assert.equal(result.rows.length, 3, '流水不依赖行情');
  assert.equal(result.row.estimated, true, '退回账本快照估值');
  assert.equal(result.row.price, 1.3);
});

test('行情返回 ok:false 也只是提示', async () => {
  const { controller } = createController({
    callAction: async () => ({ ok: false, error: '不支持的代码' })
  });
  const result = await controller.load({ code: '513870' });
  assert.equal(result.ok, true);
  assert.equal(result.error, '不支持的代码');
  assert.equal(result.rows.length, 3);
});

test('代码不识别时不去读账本也不发请求', async () => {
  const { controller, calls } = createController({
    readLedger: () => { throw new Error('不该被调用'); }
  });
  const result = await controller.load({ code: 'abc' });
  assert.equal(result.ok, false);
  assert.equal(result.error, '基金代码不识别');
  assert.equal(calls.length, 0);
});

test('账本读不出来时直接报错', async () => {
  const { controller } = createController({
    readLedger: () => { throw new Error('localStorage is not available'); }
  });
  const result = await controller.load({ code: '513870' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'localStorage is not available');
  assert.equal(result.rows.length, 0);
});

test('这只基金没有流水时是空态而不是错误态', async () => {
  const { controller, calls } = createController();
  const result = await controller.load({ code: '110022' });
  assert.equal(result.ok, true);
  assert.equal(result.empty, true);
  assert.equal(result.rows.length, 0);
  assert.equal(result.stats.txCount, 0);
  assert.equal(calls.length, 0, '没流水就不必问行情');
});

test('清仓的基金仍然能看流水与已实现盈亏', async () => {
  const cleared = {
    transactions: [
      { code: '513870', type: 'BUY', date: '2026-01-01', shares: 100, price: 1 },
      { code: '513870', type: 'SELL', date: '2026-02-01', shares: 100, price: 1.5 }
    ],
    snapshotsByCode: {}
  };
  const { controller } = createController({ readLedger: () => cleared });
  const result = await controller.load({ code: '513870' });
  assert.equal(result.ok, true);
  assert.equal(result.cleared, true);
  assert.equal(result.stats.realized, 50);
  assert.equal(result.stats.shares, 0);
  assert.equal(result.rows.length, 2);
});
