import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_SERIES_STATS,
  buildHolding,
  buildSeries,
  createMarketDetailController,
  normalizeMetrics,
  normalizeQuote,
  percentChange,
  summarizeSeries
} from '../src/beta/data/marketDetailCore.js';

const NOW = 1757000000000;

const QUOTE = {
  name: '标普500ETF',
  price: 1.4,
  changePercent: 1.5,
  open: 1.38,
  high: 1.42,
  low: 1.37,
  prevClose: 1.379,
  volume: 12000
};

const METRICS_ITEM = {
  name: '标普500ETF',
  latestNav: 1.3,
  navDate: '2026-09-04',
  premiumRate: 7.5,
  scale: 12.34
};

const CANDLES = [
  { date: '2026-08-25', open: 1.19, high: 1.22, low: 1.18, close: 1.2, volume: 800 },
  { date: '2026-08-26', close: 1.5 },
  { date: '2026-08-27', close: 1.1 },
  { date: '2026-08-28', close: 1.15 },
  { date: '2026-08-31', close: 1.3 },
  { date: '2026-09-01', close: 1.25 },
  { date: '2026-09-02', close: 1.4 }
];

const LEDGER = {
  transactions: [
    { code: '513870', name: '标普500ETF', kind: 'exchange', type: 'BUY', date: '2026-01-05', shares: 1000, price: 1 },
    { code: '513870', type: 'BUY', date: '2026-02-05', shares: 1000, price: 1.2 },
    { code: '513870', type: 'SELL', date: '2026-03-05', shares: 500, price: 1.5 }
  ],
  snapshotsByCode: {}
};

function createController(overrides = {}) {
  const calls = [];
  const responses = {
    'fund-quote': { ok: true, quotes: { '513870': QUOTE } },
    'fund-detail': { ok: true, code: '513870', item: METRICS_ITEM },
    'fund-history': { ok: true, candles: CANDLES },
    ...(overrides.responses || {})
  };
  const deps = {
    callAction: async (action, params) => {
      calls.push({ action, params });
      const response = responses[action];
      if (typeof response === 'function') return response();
      return response || { ok: false, error: 'action 未接线' };
    },
    readLedger: () => LEDGER,
    now: () => NOW
  };
  if (overrides.readLedger) deps.readLedger = overrides.readLedger;
  if (overrides.callAction) deps.callAction = overrides.callAction;
  return { controller: createMarketDetailController(deps), calls };
}

// ---------- 归一化 ----------

test('报价字段容错：0 价当没报价，0 涨幅是真值', () => {
  const quote = normalizeQuote({ secName: '汱500', currentPrice: 0, changePct: 0, vol: 30 });
  assert.equal(quote.name, '汱500');
  assert.equal(quote.price, null, '0 价格不能当真值');
  assert.equal(quote.changePercent, 0, '平盘与没数据不是一回事');
  assert.equal(quote.volume, 30);
  assert.equal(normalizeQuote(null), null);
});

test('指标字段容错', () => {
  const metrics = normalizeMetrics(METRICS_ITEM);
  assert.equal(metrics.nav, 1.3);
  assert.equal(metrics.navDate, '2026-09-04');
  assert.equal(metrics.premium, 7.5);
  assert.equal(normalizeMetrics(null), null);
});

test('日线按日期升序，没收盘价的行直接丢掉', () => {
  const rows = buildSeries({
    items: [
      { date: '2026-09-02', close: 1.4 },
      { date: '2026-08-25', close: 1.2 },
      { date: '2026-09-01', close: 0 },
      { date: '2026-08-31' }
    ]
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.date), ['2026-08-25', '2026-09-02']);
});

test('数组形 K 线也能认', () => {
  const rows = buildSeries([['2026-09-03', 1.3, 1.45, 1.28, 1.42, 900]]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    date: '2026-09-03',
    close: 1.42,
    open: 1.3,
    high: 1.45,
    low: 1.28,
    volume: 900
  });
});

test('毫秒时间戳归一成日期', () => {
  const rows = buildSeries({ rows: [{ time: Date.UTC(2026, 8, 4), close: 1.31 }] });
  assert.equal(rows[0].date, '2026-09-04');
});

test('区间统计：高低点、区间涨跌、距高点', () => {
  const stats = summarizeSeries(buildSeries({ candles: CANDLES }));
  assert.equal(stats.count, 7);
  assert.equal(stats.startDate, '2026-08-25');
  assert.equal(stats.endDate, '2026-09-02');
  assert.equal(stats.startClose, 1.2);
  assert.equal(stats.lastClose, 1.4);
  assert.equal(stats.changePercent, 16.67);
  assert.equal(stats.high, 1.5);
  assert.equal(stats.highDate, '2026-08-26');
  assert.equal(stats.low, 1.1);
  assert.equal(stats.lowDate, '2026-08-27');
  assert.equal(stats.fromHighPercent, -6.67);
});

test('近 N 日需要 N+1 个点，不够就给 null', () => {
  const stats = summarizeSeries(buildSeries({ candles: CANDLES }));
  assert.equal(stats.d5, -6.67, '七个点刚好够算近五日');
  assert.equal(stats.d20, null);
  assert.equal(stats.d60, null);
  assert.equal(summarizeSeries(buildSeries({ candles: CANDLES.slice(-3) })).d5, null);
});

test('空序列给空统计而不是 NaN', () => {
  assert.deepEqual(summarizeSeries([]), { ...EMPTY_SERIES_STATS });
  assert.deepEqual(summarizeSeries(null), { ...EMPTY_SERIES_STATS });
  assert.equal(percentChange(0, 1.2), null, '基准为 0 算不了百分比');
  assert.equal(percentChange(1, null), null);
});

test('持仓估值：有现价用现价，没现价退回均价', () => {
  const position = {
    code: '513870',
    shares: 1500,
    cost: 1650,
    avgCost: 1.1,
    realized: 200,
    txCount: 3
  };
  const withPrice = buildHolding(position, 1.4);
  assert.equal(withPrice.marketValue, 2100);
  assert.equal(withPrice.profit, 450);
  assert.equal(withPrice.profitPercent, 27.27);
  assert.equal(withPrice.realized, 200);
  assert.equal(withPrice.cleared, false);

  const noPrice = buildHolding(position, null);
  assert.equal(noPrice.profit, 0, '退回均价时浮盈为 0');
  assert.equal(buildHolding(null, 1.4), null);
});

// ---------- 加载器 ----------

test('缺依赖时直接报错', () => {
  assert.throws(() => createMarketDetailController({}), TypeError);
  assert.throws(() => createMarketDetailController({ callAction: async () => ({}) }), /readLedger/);
});

test('三个数据源并发拉，参数各归各位', async () => {
  const { controller, calls } = createController();
  const result = await controller.load({ code: '513870', refresh: true, limit: 60 });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
  const byAction = {};
  for (const call of calls) byAction[call.action] = call.params;
  assert.deepEqual(byAction['fund-quote'].codes, ['513870']);
  assert.equal(byAction['fund-quote'].refresh, true);
  assert.equal(byAction['fund-detail'].code, '513870');
  assert.equal(byAction['fund-history'].timeframe, '1d');
  assert.equal(byAction['fund-history'].limit, 60);
  assert.equal(result.updatedAt, NOW);
});

test('三段都到位时的完整结果', async () => {
  const { controller } = createController();
  const result = await controller.load({ code: '513870' });
  assert.equal(result.name, '标普500ETF');
  assert.equal(result.quote.price, 1.4);
  assert.equal(result.metrics.nav, 1.3);
  assert.equal(result.rows.length, 7);
  assert.equal(result.stats.changePercent, 16.67);
  assert.equal(result.holding.shares, 1500);
  assert.equal(result.holding.avgCost, 1.1);
  assert.equal(result.holding.marketValue, 2100);
  assert.equal(result.holding.realized, 200);
  assert.equal(result.hasData, true);
  assert.equal(result.error, '');
});

test('行情挂了仍然有日线与指标', async () => {
  const { controller } = createController({
    responses: { 'fund-quote': () => { throw new Error('行情服务超时'); } }
  });
  const result = await controller.load({ code: '513870' });
  assert.equal(result.ok, true);
  assert.equal(result.quote, null);
  assert.equal(result.errors.quote, '行情服务超时');
  assert.equal(result.error, '行情服务超时');
  assert.equal(result.rows.length, 7);
  assert.equal(result.name, '标普500ETF', '名字可以从指标里拿');
  assert.equal(result.holding.marketValue, 1950, '没现价就用净值 1.3 估');
  assert.equal(result.hasData, true);
});

test('日线挂了仍然有报价', async () => {
  const { controller } = createController({
    responses: { 'fund-history': { ok: false, error: '日线端点 500' } }
  });
  const result = await controller.load({ code: '513870' });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.stats, { ...EMPTY_SERIES_STATS });
  assert.equal(result.errors.history, '日线端点 500');
  assert.equal(result.quote.price, 1.4);
  assert.equal(result.hasData, true);
});

test('账本挂了只影响持仓那一卡', async () => {
  const { controller } = createController({
    readLedger: () => { throw new Error('localStorage is not available'); }
  });
  const result = await controller.load({ code: '513870' });
  assert.equal(result.ok, true);
  assert.equal(result.holding, null);
  assert.equal(result.errors.ledger, 'localStorage is not available');
  assert.equal(result.quote.price, 1.4);
  assert.equal(result.rows.length, 7);
});

test('账本里没这只基金时持仓为空但不报错', async () => {
  const { controller } = createController({
    responses: { 'fund-quote': { ok: true, quotes: { '159941': QUOTE } } }
  });
  const result = await controller.load({ code: '159941' });
  assert.equal(result.ok, true);
  assert.equal(result.holding, null);
  assert.equal(result.errors.ledger, '');
});

test('代码不识别时不发任何请求', async () => {
  const { controller, calls } = createController();
  const result = await controller.load({ code: '买点什么' });
  assert.equal(result.ok, false);
  assert.equal(result.error, '基金代码不识别');
  assert.equal(calls.length, 0);
});

test('三个都挂了时 hasData 为 false', async () => {
  const { controller } = createController({
    responses: {
      'fund-quote': { ok: false, error: '行情挂了' },
      'fund-detail': { ok: false, error: '指标挂了' },
      'fund-history': { ok: false, error: '日线挂了' }
    }
  });
  const result = await controller.load({ code: '513870' });
  assert.equal(result.ok, true);
  assert.equal(result.hasData, false);
  assert.equal(result.error, '行情挂了');
  assert.equal(result.name, '标普500ETF', '还能从账本里拿名字');
  assert.equal(result.holding.avgCost, 1.1, '持仓不依赖行情');
});

test('清仓的基金持仓卡标为已清仓', async () => {
  const { controller } = createController({
    readLedger: () => ({
      transactions: [
        { code: '513870', type: 'BUY', date: '2026-01-01', shares: 100, price: 1 },
        { code: '513870', type: 'SELL', date: '2026-02-01', shares: 100, price: 1.5 }
      ],
      snapshotsByCode: {}
    })
  });
  const result = await controller.load({ code: '513870' });
  assert.equal(result.holding.cleared, true);
  assert.equal(result.holding.shares, 0);
  assert.equal(result.holding.realized, 50);
});
