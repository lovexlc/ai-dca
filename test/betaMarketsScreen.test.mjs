import test from 'node:test';
import assert from 'node:assert/strict';

import { createChangeDisplay } from '../src/beta/data/changeDisplayCore.js';
import {
  buildPresetIndex,
  createMarketsViewModel,
  sortRows,
  summarizeRows
} from '../src/beta/data/marketsViewModel.js';
import {
  EMPTY_SUMMARY,
  INITIAL_MARKETS_STATE,
  createMarketsScreenController,
  defaultSortDirection,
  errorMessage,
  marketsScreenReducer,
  toCodeList
} from '../src/beta/data/marketsScreenCore.js';

const TRADING_DAYS = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
const NOW = 1757000000000;

function createStubController(overrides = {}) {
  const calls = [];
  const deps = {
    callAction: async (action, params) => {
      calls.push({ action, params });
      return { ok: true, quotes: { '513870': { code: '513870' } }, cacheHit: true, cacheFresh: true };
    },
    buildRows: (options) => (options.codes || []).map((code) => ({ code, missing: false })),
    getActiveWatchlistCodes: () => ['513870', '159941'],
    summarizeRows: (rows) => ({ ...EMPTY_SUMMARY, total: rows.length }),
    now: () => NOW,
    ...overrides
  };
  return { controller: createMarketsScreenController(deps), calls };
}

function reduceAll(actions, initial = INITIAL_MARKETS_STATE) {
  return actions.reduce((state, action) => marketsScreenReducer(state, action), initial);
}

// ---------- 辅助函数 ----------

test('toCodeList 去重、去空并保持自选单顺序', () => {
  assert.deepEqual(toCodeList([' 513870 ', '159941', '513870', '', null, undefined]), ['513870', '159941']);
  assert.deepEqual(toCodeList(null), []);
});

test('errorMessage 把字符串、Error 与空值收敛成一句话', () => {
  assert.equal(errorMessage('网关挂了'), '网关挂了');
  assert.equal(errorMessage(new Error('timeout')), 'timeout');
  assert.equal(errorMessage(''), '行情加载失败');
  assert.equal(errorMessage(null, '自定义'), '自定义');
  assert.equal(errorMessage({ message: '   ' }), '行情加载失败');
});

test('defaultSortDirection：文本列升序，数值列降序', () => {
  assert.equal(defaultSortDirection('code'), 'asc');
  assert.equal(defaultSortDirection('name'), 'asc');
  assert.equal(defaultSortDirection('changePercent'), 'desc');
});

// ---------- reducer ----------

test('初始状态是空列表且不在加载中', () => {
  assert.equal(INITIAL_MARKETS_STATE.status, 'idle');
  assert.deepEqual(INITIAL_MARKETS_STATE.rows, []);
  assert.equal(INITIAL_MARKETS_STATE.sortBy, 'changePercent');
  assert.equal(INITIAL_MARKETS_STATE.sortDirection, 'desc');
});

test('首次加载进 loading，已有行时只进 refreshing', () => {
  const first = marketsScreenReducer(INITIAL_MARKETS_STATE, { type: 'request', requestId: 1 });
  assert.equal(first.status, 'loading');

  const ready = marketsScreenReducer(first, { type: 'success', requestId: 1, rows: [{ code: '513870' }] });
  const second = marketsScreenReducer(ready, { type: 'request', requestId: 2 });
  assert.equal(second.status, 'refreshing');
  assert.equal(second.rows.length, 1, '刷新时不能把列表清空');
});

test('新一轮请求会先把上一轮的错误清掉', () => {
  const failed = reduceAll([
    { type: 'request', requestId: 1 },
    { type: 'failure', requestId: 1, error: '网络错误' }
  ]);
  assert.equal(failed.error, '网络错误');

  const retry = marketsScreenReducer(failed, { type: 'request', requestId: 2 });
  assert.equal(retry.error, '');
});

test('success 写入行、计数、场内场外与时间戳', () => {
  const state = reduceAll([
    { type: 'request', requestId: 1 },
    {
      type: 'success',
      requestId: 1,
      rows: [{ code: '513870' }, { code: '159941' }],
      summary: { ...EMPTY_SUMMARY, total: 2, withData: 2, fresh: 2 },
      listKind: 'exchange',
      updatedAt: NOW
    }
  ]);
  assert.equal(state.status, 'ready');
  assert.equal(state.rows.length, 2);
  assert.equal(state.summary.fresh, 2);
  assert.equal(state.listKind, 'exchange');
  assert.equal(state.updatedAt, NOW);
  assert.equal(state.error, '');
});

test('迟到的 success 不能覆盖新一轮请求', () => {
  const state = reduceAll([
    { type: 'request', requestId: 1 },
    { type: 'request', requestId: 2 }
  ]);
  const late = marketsScreenReducer(state, { type: 'success', requestId: 1, rows: [{ code: '旧' }] });
  assert.equal(late, state, '旧请求的响应应该被直接丢弃');
});

test('迟到的 failure 也不能把新一轮报成错误', () => {
  const state = reduceAll([
    { type: 'request', requestId: 1 },
    { type: 'request', requestId: 2 }
  ]);
  const late = marketsScreenReducer(state, { type: 'failure', requestId: 1, error: '旧错误' });
  assert.equal(late, state);
});

test('failure 保留上一轮的行，只多一条错误', () => {
  const state = reduceAll([
    { type: 'request', requestId: 1 },
    { type: 'success', requestId: 1, rows: [{ code: '513870' }] },
    { type: 'request', requestId: 2 },
    { type: 'failure', requestId: 2, error: new Error('worker 502') }
  ]);
  assert.equal(state.status, 'error');
  assert.equal(state.error, 'worker 502');
  assert.equal(state.rows.length, 1);
});

test('同一列再点一次只翻转方向，换列用该列默认方向', () => {
  const flipped = marketsScreenReducer(INITIAL_MARKETS_STATE, { type: 'sort', by: 'changePercent' });
  assert.equal(flipped.sortBy, 'changePercent');
  assert.equal(flipped.sortDirection, 'asc');

  const byCode = marketsScreenReducer(flipped, { type: 'sort', by: 'code' });
  assert.equal(byCode.sortBy, 'code');
  assert.equal(byCode.sortDirection, 'asc');

  const byPremium = marketsScreenReducer(byCode, { type: 'sort', by: 'premiumPercent' });
  assert.equal(byPremium.sortDirection, 'desc');
});

test('reset 回到初始状态，未知 action 原样返回', () => {
  const state = reduceAll([
    { type: 'request', requestId: 1 },
    { type: 'success', requestId: 1, rows: [{ code: '513870' }] }
  ]);
  assert.deepEqual(marketsScreenReducer(state, { type: 'reset' }), { ...INITIAL_MARKETS_STATE });
  assert.equal(marketsScreenReducer(state, { type: '不存在' }), state);
});

// ---------- 加载器 ----------

test('缺依赖时直接报错，不等到运行时才炋', () => {
  assert.throws(() => createMarketsScreenController({}), TypeError);
  assert.throws(
    () => createMarketsScreenController({ callAction: () => {}, buildRows: () => [], getActiveWatchlistCodes: () => [] }),
    /summarizeRows/
  );
});

test('自选单为空时不发请求', async () => {
  const { controller, calls } = createStubController({ getActiveWatchlistCodes: () => [] });
  const result = await controller.load();
  assert.equal(result.ok, true);
  assert.equal(result.empty, true);
  assert.deepEqual(result.rows, []);
  assert.equal(calls.length, 0, '空列表不应该打 fund-quote');
});

test('正常路径：按自选单代码拉 fund-quote 并建行', async () => {
  const { controller, calls } = createStubController();
  const result = await controller.load();
  assert.equal(result.ok, true);
  assert.equal(result.empty, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'fund-quote');
  assert.deepEqual(calls[0].params.codes, ['513870', '159941']);
  assert.equal(calls[0].params.refresh, false);
  assert.equal(result.rows.length, 2);
  assert.equal(result.summary.total, 2);
  assert.equal(result.updatedAt, NOW);
  assert.equal(result.cacheHit, true);
});

test('refresh 会透传给网关', async () => {
  const { controller, calls } = createStubController();
  await controller.load({ refresh: true });
  assert.equal(calls[0].params.refresh, true);
});

test('网关返回 ok:false 时把它的描述原样呈现', async () => {
  const { controller } = createStubController({
    callAction: async () => ({ ok: false, error: 'fund-quote 需要至少一个 6 位基金代码' })
  });
  const result = await controller.load();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'fund-quote 需要至少一个 6 位基金代码');
  assert.deepEqual(result.rows, []);
});

test('网关抛异常与返回失败走同一条路径', async () => {
  const { controller } = createStubController({
    callAction: async () => { throw new Error('Failed to fetch'); }
  });
  const result = await controller.load();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Failed to fetch');
});

test('自选单读不出来（存储被禁）也不能白屏', async () => {
  const { controller } = createStubController({
    getActiveWatchlistCodes: () => { throw new Error('localStorage is not available'); }
  });
  const result = await controller.load();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'localStorage is not available');
});

test('建行抛异常时降级成错误而不是崩掉', async () => {
  const { controller } = createStubController({
    buildRows: () => { throw new Error('bad snapshot'); }
  });
  const result = await controller.load();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'bad snapshot');
});

test('注入 getActiveListKind 时跟随自选单类型', async () => {
  const { controller } = createStubController({ getActiveListKind: () => 'exchange' });
  const result = await controller.load();
  assert.equal(result.listKind, 'exchange');
});

// ---------- 与真实视图模型、真实涨跌闸门联调 ----------

function createRealViewModel() {
  const gate = createChangeDisplay({
    isTradingDay: (date) => TRADING_DAYS.indexOf(date) >= 0,
    getToday: () => '2026-09-04',
    getExpectedDate: (kind, today) => (kind === 'qdii' ? '2026-09-03' : today),
    normalizeKind: (kind) => (kind === 'exchange' || kind === 'qdii' ? kind : 'otc')
  });
  return createMarketsViewModel({ getDisplayChangePercent: gate.getDisplayChangePercent });
}

test('联调：停牌、缺数据、正常三种行各归各位', async () => {
  const viewModel = createRealViewModel();
  const presets = buildPresetIndex([
    { symbol: '513870', name: '纳指ETF 富国', exchange: '上交所' },
    { symbol: '159941', name: '纳指ETF', exchange: '深交所' }
  ]);

  const controller = createMarketsScreenController({
    callAction: async () => ({
      ok: true,
      quotes: {
        '513870': { code: '513870', kind: 'exchange', price: 1.234, changePercent: 2.5, quoteDate: '2026-09-04' },
        '159941': { code: '159941', kind: 'exchange', suspended: true, quoteDate: '2026-09-04' }
      }
    }),
    buildRows: (options) => viewModel.buildRows({ ...options, presets }),
    getActiveWatchlistCodes: () => ['513870', '159941', '513390'],
    summarizeRows,
    now: () => NOW
  });

  const result = await controller.load();
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 3);

  const byCode = new Map(result.rows.map((row) => [row.code, row]));

  const normal = byCode.get('513870');
  assert.equal(normal.name, '纳指ETF 富国');
  assert.equal(normal.exchange, '上交所');
  assert.equal(normal.changePercent, 2.5);
  assert.equal(normal.direction, 'up');
  assert.equal(normal.fresh, true);
  assert.equal(normal.reason, 'fresh');

  const suspended = byCode.get('159941');
  assert.equal(suspended.suspended, true);
  assert.equal(suspended.changeText, '停牌');
  assert.equal(suspended.changePercent, null);

  const absent = byCode.get('513390');
  assert.equal(absent.missing, true);
  assert.equal(absent.reason, 'no-data');
  assert.equal(absent.changePercent, null, '没拿到快照不等于涨跌为 0');

  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.withData, 2);
  assert.equal(result.summary.missing, 1);
  assert.equal(result.summary.fresh, 1);
  assert.equal(result.summary.suspended, 1);
});

test('联调：排序时没数据的行沉底', async () => {
  const viewModel = createRealViewModel();
  const controller = createMarketsScreenController({
    callAction: async () => ({
      ok: true,
      quotes: {
        '513870': { code: '513870', kind: 'exchange', changePercent: -1.2, quoteDate: '2026-09-04' },
        '159941': { code: '159941', kind: 'exchange', changePercent: 3.4, quoteDate: '2026-09-04' }
      }
    }),
    buildRows: (options) => viewModel.buildRows(options),
    getActiveWatchlistCodes: () => ['513390', '513870', '159941'],
    summarizeRows,
    now: () => NOW
  });

  const result = await controller.load();
  const sorted = sortRows(result.rows, { by: 'changePercent', direction: 'desc' });
  assert.deepEqual(sorted.map((row) => row.code), ['159941', '513870', '513390']);

  const asc = sortRows(result.rows, { by: 'changePercent', direction: 'asc' });
  assert.equal(asc[0].code, '513870');
  assert.equal(asc[asc.length - 1].code, '513390', '没数据的行两个方向都应该在最后');
});
