import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INITIAL_HOME_STATE,
  buildHoldingsSection,
  buildMarketsSection,
  buildOverviewSection,
  createHomeScreenController,
  errorMessage,
  homeScreenReducer,
  isRankable,
  normalizeOverviewItems,
  pickMovers,
  topHoldings
} from '../src/beta/data/homeScreenCore.js';

const NOW = 1757000000000;

function row(code, changePercent, extra = {}) {
  return { code, name: code + ' 基金', changePercent, ...extra };
}

function createController(overrides = {}) {
  const calls = { holdings: [], markets: [], actions: [] };
  const deps = {
    loadHoldings: async (options) => {
      calls.holdings.push(options);
      return {
        ok: true,
        rows: [{ code: '513870', name: '纳指ETF', marketValue: 1200, profitPercent: 20, direction: 'up' }],
        summary: { marketValue: 1200, profit: 200, profitPercent: 20, dayProfit: 10 },
        error: ''
      };
    },
    loadMarkets: async (options) => {
      calls.markets.push(options);
      return {
        ok: true,
        rows: [row('513870', 2.5), row('159941', -1.2)],
        summary: { total: 2, withData: 2, missing: 0 },
        error: ''
      };
    },
    callAction: async (action, params) => {
      calls.actions.push({ action, params });
      return { ok: false, unsupported: true, error: 'home-series 需要 markets worker 补一个首页序列端点' };
    },
    now: () => NOW,
    ...overrides
  };
  return { controller: createHomeScreenController(deps), calls };
}

// ---------- 基础 ----------

test('异常与字符串都收敛成一句话', () => {
  assert.equal(errorMessage(new Error('worker 502')), 'worker 502');
  assert.equal(errorMessage('  '), '首页加载失败');
  assert.equal(errorMessage(null, '自定义'), '自定义');
});

test('停牌、缺数据的行不能上榜', () => {
  assert.equal(isRankable(row('a', 1)), true);
  assert.equal(isRankable(row('b', null)), false);
  assert.equal(isRankable(row('c', 1, { suspended: true })), false);
  assert.equal(isRankable(row('d', 1, { missing: true })), false);
  assert.equal(isRankable(null), false);
});

// ---------- 涨跌榜 ----------

test('领涨领跌各取前三，方向各自排', () => {
  const rows = [row('a', 1), row('b', 5), row('c', -3), row('d', 3), row('e', -1), row('f', -8), row('g', 2)];
  const { gainers, losers } = pickMovers(rows);
  assert.deepEqual(gainers.map((r) => r.code), ['b', 'd', 'g']);
  assert.deepEqual(losers.map((r) => r.code), ['f', 'c', 'e']);
});

test('停牌与没数据的不会当 0% 挤进榜里', () => {
  const rows = [row('a', 3), row('b', null, { missing: true }), row('c', 0), row('d', 1, { suspended: true })];
  const { gainers, losers } = pickMovers(rows);
  assert.deepEqual(gainers.map((r) => r.code), ['a']);
  assert.deepEqual(losers.map((r) => r.code), []);
});

test('全平时两边都空，不报错', () => {
  const { gainers, losers } = pickMovers([row('a', 0), row('b', 0)]);
  assert.equal(gainers.length, 0);
  assert.equal(losers.length, 0);
});

test('涨跌榜接非数组不崩', () => {
  assert.deepEqual(pickMovers(null), { gainers: [], losers: [] });
});

test('首页只留市值最大的三只', () => {
  const rows = [
    { code: 'a', marketValue: 100 },
    { code: 'b', marketValue: 900 },
    { code: 'c', marketValue: 500 },
    { code: 'd', marketValue: 700 }
  ];
  assert.deepEqual(topHoldings(rows).map((r) => r.code), ['b', 'd', 'c']);
  assert.equal(rows[0].code, 'a', '不改原数组');
});

// ---------- 三段卡片 ----------

test('持仓段：正常、空仓、失败三种状态', () => {
  const ready = buildHoldingsSection({
    ok: true,
    rows: [{ code: 'a', marketValue: 10 }],
    summary: { marketValue: 10 }
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.rows.length, 1);
  assert.equal(ready.error, '');

  assert.equal(buildHoldingsSection({ ok: true, empty: true, summary: { marketValue: 0 } }).status, 'empty');

  const failed = buildHoldingsSection({ ok: false, error: '账本读取失败' });
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, '账本读取失败');
});

test('持仓段：行情降级的提示要带到首页', () => {
  const section = buildHoldingsSection({
    ok: true,
    rows: [{ code: 'a', marketValue: 10 }],
    summary: { marketValue: 10 },
    error: 'Failed to fetch'
  });
  assert.equal(section.status, 'ready');
  assert.equal(section.error, 'Failed to fetch');
});

test('持仓段：传 null 也不崩', () => {
  assert.equal(buildHoldingsSection(null).status, 'error');
});

test('行情段：正常拆成领涨领跌', () => {
  const section = buildMarketsSection({
    ok: true,
    rows: [row('a', 3), row('b', -2)],
    summary: { total: 2, withData: 2 }
  });
  assert.equal(section.status, 'ready');
  assert.deepEqual(section.gainers.map((r) => r.code), ['a']);
  assert.deepEqual(section.losers.map((r) => r.code), ['b']);
  assert.equal(section.summary.total, 2);
});

test('行情段：空自选单是引导态而不是错误态', () => {
  const section = buildMarketsSection({ ok: true, empty: true, summary: { total: 0 } });
  assert.equal(section.status, 'empty');
  assert.equal(section.error, '');
});

test('行情段：失败只影响自己', () => {
  const section = buildMarketsSection({ ok: false, error: 'fund-quote 未接线' });
  assert.equal(section.status, 'error');
  assert.equal(section.error, 'fund-quote 未接线');
  assert.deepEqual(section.gainers, []);
});

// ---------- 大盘 ----------

test('大盘列表：数组、常见字段、quotes 映射都能认', () => {
  const expected = [{ code: '000001', name: '上证指数', price: 3400, changePercent: 1.5, direction: 'up' }];
  const item = { code: '000001', name: '上证指数', price: 3400, changePercent: 1.5 };
  assert.deepEqual(normalizeOverviewItems([item]), expected);
  assert.deepEqual(normalizeOverviewItems({ indices: [item] }), expected);
  assert.deepEqual(normalizeOverviewItems({ items: [item] }), expected);
  assert.deepEqual(
    normalizeOverviewItems({ quotes: { '000001': { name: '上证指数', price: 3400, changePercent: 1.5 } } }),
    expected
  );
});

test('大盘列表：认不出来就返回空，不猜字段', () => {
  assert.deepEqual(normalizeOverviewItems(null), []);
  assert.deepEqual(normalizeOverviewItems({ ok: true }), []);
  assert.deepEqual(normalizeOverviewItems({ items: [null, {}, 'x'] }), []);
});

test('大盘列表：没涨跌幅时方向算平，不编数', () => {
  const items = normalizeOverviewItems([{ code: '000300', name: '沪深300' }]);
  assert.equal(items[0].changePercent, null);
  assert.equal(items[0].direction, 'flat');
  assert.equal(items[0].price, null);
});

test('大盘段：unsupported 静默处理，不当错误', () => {
  const section = buildOverviewSection({ ok: false, unsupported: true, error: '尚未接线' });
  assert.equal(section.status, 'unsupported');
  assert.equal(section.error, '尚未接线');
});

test('大盘段：正常与空载荷', () => {
  const ready = buildOverviewSection({ ok: true, indices: [{ code: '000001', name: '上证', changePercent: 1 }] });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.indices.length, 1);
  assert.equal(buildOverviewSection({ ok: true }).status, 'empty');
  assert.equal(buildOverviewSection({ ok: false, error: 'boom' }).status, 'error');
  assert.equal(buildOverviewSection(undefined).status, 'error');
});

// ---------- reducer ----------

test('首次进 loading，有过数据后只进 refreshing', () => {
  const first = homeScreenReducer(INITIAL_HOME_STATE, { type: 'request', requestId: 1 });
  assert.equal(first.status, 'loading');
  const ready = homeScreenReducer(first, { type: 'success', requestId: 1, updatedAt: NOW });
  const second = homeScreenReducer(ready, { type: 'request', requestId: 2 });
  assert.equal(second.status, 'refreshing');
});

test('迟到的响应直接丢弃', () => {
  const state = homeScreenReducer(
    homeScreenReducer(INITIAL_HOME_STATE, { type: 'request', requestId: 1 }),
    { type: 'request', requestId: 2 }
  );
  assert.equal(homeScreenReducer(state, { type: 'success', requestId: 1, updatedAt: NOW }), state);
});

test('整页失败时保留上一轮的三段', () => {
  let state = homeScreenReducer(INITIAL_HOME_STATE, { type: 'request', requestId: 1 });
  state = homeScreenReducer(state, {
    type: 'success',
    requestId: 1,
    updatedAt: NOW,
    holdings: { status: 'ready', rows: [{ code: 'a' }], summary: null, error: '' }
  });
  state = homeScreenReducer(state, { type: 'request', requestId: 2 });
  state = homeScreenReducer(state, { type: 'failure', requestId: 2, error: new Error('断网') });
  assert.equal(state.status, 'error');
  assert.equal(state.error, '断网');
  assert.equal(state.holdings.rows.length, 1);
});

test('reset 回初始，未知 action 原样返回', () => {
  const state = homeScreenReducer(INITIAL_HOME_STATE, { type: 'request', requestId: 1 });
  assert.deepEqual(homeScreenReducer(state, { type: 'reset' }), { ...INITIAL_HOME_STATE });
  assert.equal(homeScreenReducer(state, { type: '不存在' }), state);
});

// ---------- 加载器 ----------

test('缺依赖时直接报错', () => {
  assert.throws(() => createHomeScreenController({}), TypeError);
  assert.throws(() => createHomeScreenController({ loadHoldings: async () => ({}) }), /loadMarkets/);
});

test('三段并行拉，refresh 透传给三边', async () => {
  const { controller, calls } = createController();
  const result = await controller.load({ refresh: true });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.holdings, [{ refresh: true }]);
  assert.deepEqual(calls.markets, [{ refresh: true }]);
  assert.equal(calls.actions[0].action, 'home-overview');
  assert.deepEqual(calls.actions[0].params, { region: 'CN', refresh: true });
  assert.equal(result.updatedAt, NOW);
});

test('持仓挂了行情照常显示', async () => {
  const { controller } = createController({
    loadHoldings: async () => { throw new Error('localStorage is not available'); }
  });
  const result = await controller.load();
  assert.equal(result.ok, true, '一段挂掉不影响整页');
  assert.equal(result.holdings.status, 'error');
  assert.equal(result.holdings.error, 'localStorage is not available');
  assert.equal(result.markets.status, 'ready');
  assert.deepEqual(result.markets.gainers.map((r) => r.code), ['513870']);
});

test('行情挂了持仓照常显示', async () => {
  const { controller } = createController({
    loadMarkets: async () => ({ ok: false, error: 'worker 502' })
  });
  const result = await controller.load();
  assert.equal(result.markets.status, 'error');
  assert.equal(result.holdings.status, 'ready');
  assert.equal(result.holdings.rows.length, 1);
});

test('大盘未接线不影响另外两段', async () => {
  const { controller } = createController();
  const result = await controller.load();
  assert.equal(result.overview.status, 'unsupported');
  assert.equal(result.holdings.status, 'ready');
  assert.equal(result.markets.status, 'ready');
});

test('大盘接上后无需改页面就能出现', async () => {
  const { controller } = createController({
    callAction: async () => ({ ok: true, indices: [{ code: '000001', name: '上证指数', changePercent: 1.2, price: 3400 }] })
  });
  const result = await controller.load();
  assert.equal(result.overview.status, 'ready');
  assert.deepEqual(result.overview.indices[0], {
    code: '000001',
    name: '上证指数',
    price: 3400,
    changePercent: 1.2,
    direction: 'up'
  });
});
