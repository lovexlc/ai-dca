import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_HOLDINGS_SUMMARY,
  INITIAL_HOLDINGS_STATE,
  buildHoldingRows,
  buildPositions,
  createHoldingsScreenController,
  holdingsScreenReducer,
  normalizeCode,
  normalizeTxType,
  pickValuation,
  sortHoldingRows,
  summarizeHoldings
} from '../src/beta/data/holdingsScreenCore.js';

const NOW = 1757000000000;

function buy(code, date, price, shares, extra = {}) {
  return { id: code + '-' + date, code, type: 'BUY', date, price, shares, ...extra };
}

function sell(code, date, price, shares, extra = {}) {
  return { id: code + '-' + date + '-s', code, type: 'SELL', date, price, shares, ...extra };
}

function createController(overrides = {}) {
  const calls = [];
  const deps = {
    readLedger: () => ({
      transactions: [buy('513870', '2026-09-01', 1, 1000, { name: '纳指ETF', kind: 'exchange' })],
      snapshotsByCode: {}
    }),
    callAction: async (action, params) => {
      calls.push({ action, params });
      return { ok: true, quotes: { '513870': { code: '513870', price: 1.2, changePercent: 2 } } };
    },
    now: () => NOW,
    ...overrides
  };
  return { controller: createHoldingsScreenController(deps), calls };
}

// ---------- 基础归一化 ----------

test('交易类型只认 BUY / SELL，其余不猜', () => {
  assert.equal(normalizeTxType('buy'), 'BUY');
  assert.equal(normalizeTxType(' Sell '), 'SELL');
  assert.equal(normalizeTxType('DIVIDEND'), '');
  assert.equal(normalizeTxType(null), '');
});

test('代码只接受 6 位数字，sh/sz 前缀会被剥掉', () => {
  assert.equal(normalizeCode('sh513870'), '513870');
  assert.equal(normalizeCode(' 159941 '), '159941');
  assert.equal(normalizeCode('12345'), '');
  assert.equal(normalizeCode(''), '');
});

// ---------- 流水账 → 持仓 ----------

test('多笔买入按金额加权出均价', () => {
  const { positions } = buildPositions([
    buy('513870', '2026-09-01', 1.0, 1000),
    buy('513870', '2026-09-02', 1.5, 1000)
  ]);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].shares, 2000);
  assert.equal(positions[0].cost, 2500);
  assert.equal(positions[0].avgCost, 1.25);
});

test('卖出按当时均价扣成本，不改剩余份额的均价', () => {
  const { positions } = buildPositions([
    buy('513870', '2026-09-01', 1.0, 1000),
    buy('513870', '2026-09-02', 1.5, 1000),
    sell('513870', '2026-09-03', 2.0, 1000)
  ]);
  const position = positions[0];
  assert.equal(position.shares, 1000);
  assert.equal(position.avgCost, 1.25, '卖出不应该改变剩余份额的均价');
  assert.equal(position.cost, 1250);
  assert.equal(position.realized, 750, '(2.0 - 1.25) * 1000');
});

test('清仓后份额与成本归零，已实现盈亏保留', () => {
  const { positions } = buildPositions([
    buy('513870', '2026-09-01', 1.0, 1000),
    sell('513870', '2026-09-02', 1.2, 1000)
  ]);
  assert.equal(positions[0].shares, 0);
  assert.equal(positions[0].cost, 0);
  assert.equal(positions[0].realized, 200);
});

test('卖超了不会出现负份额，只计数', () => {
  const { positions, oversold } = buildPositions([
    buy('513870', '2026-09-01', 1.0, 500),
    sell('513870', '2026-09-02', 1.2, 900)
  ]);
  assert.equal(positions[0].shares, 0);
  assert.equal(oversold, 1);
});

test('代码非法或类型未知的交易被跳过并计数', () => {
  const { positions, ignored } = buildPositions([
    buy('513870', '2026-09-01', 1.0, 100),
    { code: '', type: 'BUY', date: '2026-09-01', price: 1, shares: 100 },
    { code: '159941', type: 'DIVIDEND', date: '2026-09-02', price: 0, shares: 0 }
  ]);
  assert.equal(positions.length, 1);
  assert.equal(ignored, 2);
});

test('没填日期的交易当最早，不会把均价算反', () => {
  const { positions } = buildPositions([
    sell('513870', '2026-09-05', 2.0, 500),
    buy('513870', '', 1.0, 1000)
  ]);
  assert.equal(positions[0].shares, 500);
  assert.equal(positions[0].realized, 500, '先买后卖：(2.0 - 1.0) * 500');
});

test('名称与场内场外从交易里带出来', () => {
  const { positions } = buildPositions([
    buy('513870', '2026-09-01', 1.0, 100, { name: '纳指ETF', kind: 'exchange' })
  ]);
  assert.equal(positions[0].name, '纳指ETF');
  assert.equal(positions[0].kind, 'exchange');
});

// ---------- 估值 ----------

test('场内看价格、场外看净值', () => {
  const quote = { price: 1.5, latestNav: 1.2 };
  assert.deepEqual(pickValuation({ quote, kind: 'exchange', avgCost: 1 }), { price: 1.5, source: 'quote' });
  assert.deepEqual(pickValuation({ quote, kind: 'otc', avgCost: 1 }), { price: 1.2, source: 'quote' });
});

test('拿不到行情就退账本快照，再退成本价', () => {
  assert.deepEqual(
    pickValuation({ quote: null, snapshot: { latestNav: 1.1 }, kind: 'otc', avgCost: 1 }),
    { price: 1.1, source: 'snapshot' }
  );
  assert.deepEqual(
    pickValuation({ quote: null, snapshot: null, kind: 'otc', avgCost: 0.98 }),
    { price: 0.98, source: 'cost' }
  );
  assert.deepEqual(
    pickValuation({ quote: null, snapshot: null, kind: 'otc', avgCost: 0 }),
    { price: 0, source: 'none' }
  );
});

test('建行：市值、浮盈亏、收益率、今日盈亏', () => {
  const { positions } = buildPositions([buy('513870', '2026-09-01', 1.0, 1000, { kind: 'exchange' })]);
  const rows = buildHoldingRows({
    positions,
    quotes: { '513870': { price: 1.1, changePercent: 10 } }
  });
  const row = rows[0];
  assert.equal(row.marketValue, 1100);
  assert.equal(row.profit, 100);
  assert.equal(row.profitPercent, 10);
  assert.equal(row.direction, 'up');
  assert.equal(row.estimated, false);
  assert.equal(row.dayProfit, 100, '1100 - 1100 / 1.1');
});

test('建行：用快照估值时标为估值', () => {
  const { positions } = buildPositions([buy('000834', '2026-09-01', 1.0, 1000)]);
  const rows = buildHoldingRows({
    positions,
    quotes: {},
    snapshots: { '000834': { latestNav: 1.05 } }
  });
  assert.equal(rows[0].estimated, true);
  assert.equal(rows[0].priceSource, 'snapshot');
  assert.equal(rows[0].marketValue, 1050);
});

test('建行：没名字时用代码占位，不留空白', () => {
  const { positions } = buildPositions([buy('513390', '2026-09-01', 1.0, 100)]);
  const rows = buildHoldingRows({ positions, quotes: {} });
  assert.equal(rows[0].name, '513390');
});

test('汇总：市值、成本、收益率与估值计数', () => {
  const { positions } = buildPositions([
    buy('513870', '2026-09-01', 1.0, 1000, { kind: 'exchange' }),
    buy('000834', '2026-09-01', 2.0, 500)
  ]);
  const rows = buildHoldingRows({
    positions,
    quotes: { '513870': { price: 1.1 } }
  });
  const summary = summarizeHoldings(rows);
  assert.equal(summary.positions, 2);
  assert.equal(summary.cost, 2000);
  assert.equal(summary.marketValue, 2100, '000834 没行情，按成本价 1000 估');
  assert.equal(summary.profit, 100);
  assert.equal(summary.profitPercent, 5);
  assert.equal(summary.estimated, 1);
  assert.equal(summary.missingQuote, 1);
});

test('汇总：空列表不会算出 NaN', () => {
  const summary = summarizeHoldings([]);
  assert.equal(summary.marketValue, 0);
  assert.equal(summary.profitPercent, null);
});

// ---------- 排序 ----------

test('排序：市值降序，没数据的行两个方向都沉底', () => {
  const rows = [
    { code: 'a', marketValue: 100, profitPercent: 5 },
    { code: 'b', marketValue: 300, profitPercent: null },
    { code: 'c', marketValue: 200, profitPercent: 1 }
  ];
  assert.deepEqual(sortHoldingRows(rows, { by: 'marketValue', direction: 'desc' }).map((r) => r.code), ['b', 'c', 'a']);

  const desc = sortHoldingRows(rows, { by: 'profitPercent', direction: 'desc' });
  assert.equal(desc[desc.length - 1].code, 'b');
  const asc = sortHoldingRows(rows, { by: 'profitPercent', direction: 'asc' });
  assert.equal(asc[asc.length - 1].code, 'b');
});

test('排序：不改原数组', () => {
  const rows = [{ code: 'a', marketValue: 1 }, { code: 'b', marketValue: 2 }];
  sortHoldingRows(rows, { by: 'marketValue', direction: 'desc' });
  assert.equal(rows[0].code, 'a');
});

// ---------- reducer ----------

test('首次加载进 loading，已有行时只进 refreshing', () => {
  const first = holdingsScreenReducer(INITIAL_HOLDINGS_STATE, { type: 'request', requestId: 1 });
  assert.equal(first.status, 'loading');
  const ready = holdingsScreenReducer(first, { type: 'success', requestId: 1, rows: [{ code: '513870' }] });
  const second = holdingsScreenReducer(ready, { type: 'request', requestId: 2 });
  assert.equal(second.status, 'refreshing');
  assert.equal(second.rows.length, 1);
});

test('迟到的响应直接丢弃', () => {
  const state = holdingsScreenReducer(
    holdingsScreenReducer(INITIAL_HOLDINGS_STATE, { type: 'request', requestId: 1 }),
    { type: 'request', requestId: 2 }
  );
  assert.equal(holdingsScreenReducer(state, { type: 'success', requestId: 1, rows: [{ code: 'x' }] }), state);
  assert.equal(holdingsScreenReducer(state, { type: 'failure', requestId: 1, error: '旧' }), state);
});

test('失败保留已有的行', () => {
  let state = holdingsScreenReducer(INITIAL_HOLDINGS_STATE, { type: 'request', requestId: 1 });
  state = holdingsScreenReducer(state, { type: 'success', requestId: 1, rows: [{ code: '513870' }] });
  state = holdingsScreenReducer(state, { type: 'request', requestId: 2 });
  state = holdingsScreenReducer(state, { type: 'failure', requestId: 2, error: new Error('worker 502') });
  assert.equal(state.status, 'error');
  assert.equal(state.error, 'worker 502');
  assert.equal(state.rows.length, 1);
});

test('同一列再点翻转方向，reset 回初始，未知 action 原样返回', () => {
  const flipped = holdingsScreenReducer(INITIAL_HOLDINGS_STATE, { type: 'sort', by: 'marketValue' });
  assert.equal(flipped.sortDirection, 'asc');
  const byCode = holdingsScreenReducer(flipped, { type: 'sort', by: 'code' });
  assert.equal(byCode.sortDirection, 'asc');
  const byProfit = holdingsScreenReducer(byCode, { type: 'sort', by: 'profit' });
  assert.equal(byProfit.sortDirection, 'desc');
  assert.deepEqual(holdingsScreenReducer(byProfit, { type: 'reset' }), { ...INITIAL_HOLDINGS_STATE });
  assert.equal(holdingsScreenReducer(byProfit, { type: '不存在' }), byProfit);
});

// ---------- 加载器 ----------

test('缺依赖时直接报错', () => {
  assert.throws(() => createHoldingsScreenController({}), TypeError);
  assert.throws(() => createHoldingsScreenController({ readLedger: () => ({}) }), /callAction/);
});

test('空账本不发请求', async () => {
  const { controller, calls } = createController({ readLedger: () => ({ transactions: [] }) });
  const result = await controller.load();
  assert.equal(result.ok, true);
  assert.equal(result.empty, true);
  assert.equal(calls.length, 0);
});

test('已清仓的基金不进持仓列表，也不去拉行情', async () => {
  const { controller, calls } = createController({
    readLedger: () => ({
      transactions: [buy('513870', '2026-09-01', 1, 100), sell('513870', '2026-09-02', 1.2, 100)]
    })
  });
  const result = await controller.load();
  assert.equal(result.empty, true);
  assert.equal(calls.length, 0);
});

test('正常路径：按持仓代码拉 fund-quote', async () => {
  const { controller, calls } = createController();
  const result = await controller.load({ refresh: true });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'fund-quote');
  assert.deepEqual(calls[0].params.codes, ['513870']);
  assert.equal(calls[0].params.refresh, true);
  assert.equal(result.rows[0].marketValue, 1200);
  assert.equal(result.summary.profit, 200);
  assert.equal(result.updatedAt, NOW);
});

test('行情挂了持仓照常看，只多一句提示', async () => {
  const { controller } = createController({
    callAction: async () => { throw new Error('Failed to fetch'); },
    readLedger: () => ({
      transactions: [buy('000834', '2026-09-01', 1.0, 1000)],
      snapshotsByCode: { '000834': { latestNav: 1.05 } }
    })
  });
  const result = await controller.load();
  assert.equal(result.ok, true, '行情失败不应该把整页持仓干掉');
  assert.equal(result.error, 'Failed to fetch');
  assert.equal(result.rows[0].marketValue, 1050);
  assert.equal(result.rows[0].estimated, true);
});

test('网关返回 ok:false 时同样降级而不是白屏', async () => {
  const { controller } = createController({
    callAction: async () => ({ ok: false, error: 'fund-quote 未接线' })
  });
  const result = await controller.load();
  assert.equal(result.ok, true);
  assert.equal(result.error, 'fund-quote 未接线');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].priceSource, 'cost');
});

test('账本读不出来时报错而不崩', async () => {
  const { controller } = createController({
    readLedger: () => { throw new Error('localStorage is not available'); }
  });
  const result = await controller.load();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'localStorage is not available');
  assert.deepEqual(result.summary, EMPTY_HOLDINGS_SUMMARY);
});

test('被跳过的交易数会一直带到页面上', async () => {
  const { controller } = createController({
    readLedger: () => ({
      transactions: [
        buy('513870', '2026-09-01', 1, 1000, { kind: 'exchange' }),
        { code: '513870', type: 'DIVIDEND', date: '2026-09-02', price: 0, shares: 0 }
      ]
    })
  });
  const result = await controller.load();
  assert.equal(result.summary.ignoredTransactions, 1);
});
