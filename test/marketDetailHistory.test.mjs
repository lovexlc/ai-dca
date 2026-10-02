import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NAV_HISTORY_ALIGN_BUFFER_DAYS,
  buildDetailMetricCandles,
  buildRealtimePremiumPoint,
  chartKlineCacheKeyForRange,
  chartKlineLimitForRange,
  epochSecFromShanghaiDate,
  hasEnoughChartCandles,
  mergeRealtimePremiumPoint,
  navHistoryCacheKey,
  navHistoryDaysForRange,
  navHistoryQueryForRange,
  nthPreviousTradingDayShanghai,
  realtimeQuoteTimeSec,
  sliceCandlesForRange,
} from '../src/pages/markets/marketFundMetrics.js';
import { normalizeNavHistoryItems, resolveHistoricalPremiumNav } from '../src/app/fundPremiumNav.js';
import {
  buildDetailNavErrorState,
  buildDetailNavStateFromPayload,
  deriveCompareSeriesStatus,
  detailNavItemsMeta,
  loadDetailNavHistoryState,
  planDetailKlineRequest,
  planDetailNavRequest,
  resolveCompareKlineOutcome,
  shouldFetchCompareKline,
  shouldFetchCompareNavHistory,
  shouldFetchComparePremiumSnapshot,
  shouldRequestDetailKline,
  shouldRequestDetailNavHistory,
} from '../src/pages/markets/marketDetailHistory.js';

const isoAdd = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const dailyCandlesBetween = (from, to) => {
  const rows = [];
  for (let cursor = from; cursor <= to; cursor = isoAdd(cursor, 1)) {
    rows.push({ date: cursor, t: Math.floor(Date.parse(`${cursor}T15:00:00+08:00`) / 1000), c: 1 });
  }
  return rows;
};

const intradayMinuteCandles = (dates) => dates.flatMap((date) => ([
  { t: epochSecFromShanghaiDate(date, '09:35:00'), o: 1, h: 1, l: 1, c: 1 },
  { t: epochSecFromShanghaiDate(date, '11:00:00'), o: 1, h: 1, l: 1, c: 1 },
]));

// ---- 详情 K 线缓存键：以市场、代码和请求区间识别结果 ----

test('detail kline cache keys identify the request range identity', () => {
  assert.equal(chartKlineCacheKeyForRange('510300', '1d'), '510300|5m');
  assert.equal(chartKlineCacheKeyForRange('510300', '5d'), '510300|5m|session=all');
  const oneMonthLimit = chartKlineLimitForRange('1mo');
  const fiveYearLimit = chartKlineLimitForRange('5y');
  assert.notEqual(oneMonthLimit, fiveYearLimit);
  // 短区间与长区间不再共用 symbol|1d：limit 是区间身份的一部分。
  assert.equal(chartKlineCacheKeyForRange('510300', '1mo'), `510300|1d|limit=${oneMonthLimit}`);
  assert.equal(chartKlineCacheKeyForRange('510300', '5y'), `510300|1d|limit=${fiveYearLimit}`);
  const plan = planDetailKlineRequest('cn', '510300', '1mo', null);
  assert.equal(plan.cacheKey, `510300|1d|limit=${oneMonthLimit}`);
  assert.equal(plan.inflightKey, `${plan.cacheKey}|${oneMonthLimit}`);
  assert.equal(plan.requestKey, `cn|${plan.cacheKey}|${oneMonthLimit}`);
  assert.deepEqual(plan.request, { timeframe: '1d', limit: oneMonthLimit, session: '' });
});

// ---- 完整性按交易日覆盖判断（1 天 / 5 天）----

test('intraday chart completeness follows actual trading days', () => {
  // 2026-06-19..06-21 端午休市（06-19 为周五）；06-22 周一开市。
  // 最近 5 个实际交易日：06-22、06-18、06-17、06-16、06-15。
  const today = '2026-06-22';
  assert.equal(nthPreviousTradingDayShanghai('2026-06-22', 4), '2026-06-15');
  assert.equal(
    hasEnoughChartCandles(intradayMinuteCandles(['2026-06-17', '2026-06-18', '2026-06-22']), '5d', null, { today }),
    false,
  );
  assert.equal(
    hasEnoughChartCandles(intradayMinuteCandles(['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-22']), '5d', null, { today }),
    true,
  );
  // 1 天视图必须覆盖最近一个交易日；周末查看回退到上一交易日。
  assert.equal(hasEnoughChartCandles(intradayMinuteCandles(['2026-06-18']), '1d', null, { today }), false);
  assert.equal(hasEnoughChartCandles(intradayMinuteCandles(['2026-06-22']), '1d', null, { today }), true);
  assert.equal(hasEnoughChartCandles(intradayMinuteCandles(['2026-06-05']), '1d', null, { today: '2026-06-06' }), true);
  // 法定节假日期间同样回退：2026-10-02 处于国庆休市，最近交易日为 09-30。
  assert.equal(hasEnoughChartCandles(intradayMinuteCandles(['2026-09-30']), '1d', null, { today: '2026-10-02' }), true);
  assert.equal(hasEnoughChartCandles(intradayMinuteCandles(['2026-09-29']), '1d', null, { today: '2026-10-02' }), false);
});

test('daily chart completeness requires the range start and the latest trading day', () => {
  const today = '2026-06-05';
  assert.equal(hasEnoughChartCandles(dailyCandlesBetween('2021-06-01', today), '5y', null, { today }), true);
  // 新基金/截断数据：首根蜡烛晚于区间起点，不能判为完整。
  assert.equal(hasEnoughChartCandles(dailyCandlesBetween('2025-01-01', today), '5y', null, { today }), false);
  // 数据末端停在最近交易日之前视为陈旧。
  assert.equal(hasEnoughChartCandles(dailyCandlesBetween('2025-06-05', '2026-06-04'), '1y', null, { today }), false);
  assert.equal(hasEnoughChartCandles(dailyCandlesBetween('2025-06-05', today), '1y', null, { today }), true);
  assert.equal(hasEnoughChartCandles(dailyCandlesBetween('2026-05-20', today), '1mo', null, { today }), false);
  assert.equal(hasEnoughChartCandles(dailyCandlesBetween('2026-05-05', today), '1mo', null, { today }), true);
});

// ---- NAV 查询规范化：覆盖价格日期 + 对齐缓冲，键与 IDB 一致 ----

test('nav history query is normalized to from/to and matches the cache key', () => {
  const today = '2026-06-05';
  const oneMonthQuery = navHistoryQueryForRange('1mo', null, { today });
  assert.deepEqual(oneMonthQuery, { from: isoAdd(today, -navHistoryDaysForRange('1mo', null, { today })), to: today });
  assert.equal(navHistoryCacheKey('513100', '1mo', null, { today }), `513100|${oneMonthQuery.from}|${oneMonthQuery.to}`);
  assert.equal(navHistoryCacheKey('510300', '5d', null, { today }), `510300|${isoAdd(today, -45)}|${today}`);
  const plan = planDetailNavRequest('513100', '1mo', null);
  assert.equal(plan.code, '513100');
  assert.deepEqual(Object.keys(plan.query).sort(), ['from', 'to']);
  assert.equal(plan.key, `513100|${plan.query.from}|${plan.query.to}`);
  // 自定义区间在可见起点前补对齐缓冲。
  const custom = { from: '2026-05-02', to: '2026-05-03' };
  const customQuery = navHistoryQueryForRange('custom', custom);
  assert.equal(customQuery.from, isoAdd(custom.from, -NAV_HISTORY_ALIGN_BUFFER_DAYS));
  assert.equal(customQuery.to, custom.to);
});

// ---- 历史溢价 NAV 口径：明确的 navDate 与陈旧判定 ----

test('historical premium nav resolution reports explicit navDate and staleness', () => {
  // 非 QDII 历史同日 NAV：正常。
  const sameDay = resolveHistoricalPremiumNav([{ date: '2026-06-05', nav: 1.2 }], '2026-06-05');
  assert.equal(sameDay.navDate, '2026-06-05');
  assert.equal(sameDay.reason, 'same-day');
  assert.equal(sameDay.stale, false);
  // QDII 用价格日前最近可用 NAV：上一交易日，正常。
  const qdiiNormal = resolveHistoricalPremiumNav(
    [{ date: '2026-06-04', nav: 1.2 }, { date: '2026-06-05', nav: 1.3 }],
    '2026-06-08',
    { isCrossBorder: true },
  );
  assert.equal(qdiiNormal.navDate, '2026-06-05');
  assert.equal(qdiiNormal.reason, 'previous-trading');
  assert.equal(qdiiNormal.stale, false);
  // QDII 长假（端午 06-19..06-21）且无当日 NAV：净值缺口跨假期，标记陈旧。
  const holidayGap = resolveHistoricalPremiumNav(
    [{ date: '2026-06-18', nav: 1.2 }],
    '2026-06-23',
    { isCrossBorder: true },
  );
  assert.equal(holidayGap.navDate, '2026-06-18');
  assert.equal(holidayGap.reason, 'holiday-gap');
  assert.equal(holidayGap.stale, true);
  // QDII 节假日同日回退（产品定义）不算陈旧。
  const holidaySameDay = resolveHistoricalPremiumNav(
    [{ date: '2025-04-03', nav: 1.336 }, { date: '2025-04-07', nav: 1.259 }],
    '2025-04-07',
    { isCrossBorder: true },
  );
  assert.equal(holidaySameDay.navDate, '2025-04-07');
  assert.equal(holidaySameDay.reason, 'holiday-same-day');
  assert.equal(holidaySameDay.stale, false);
  // 盘中未公布当日 NAV 的正常回退：上一交易日，正常。
  const intradayFallback = resolveHistoricalPremiumNav(
    [{ date: '2026-06-04', nav: 1.0 }],
    '2026-06-05',
    { allowPreviousForNonCrossBorder: true },
  );
  assert.equal(intradayFallback.navDate, '2026-06-04');
  assert.equal(intradayFallback.reason, 'previous-trading');
  assert.equal(intradayFallback.stale, false);
  // 净值滞后（如海外休市晚公布，缺口没有假期特征）：标记陈旧。
  const navLag = resolveHistoricalPremiumNav(
    [{ date: '2026-06-02', nav: 1.0 }],
    '2026-06-05',
    { allowPreviousForNonCrossBorder: true },
  );
  assert.equal(navLag.reason, 'nav-lag');
  assert.equal(navLag.stale, true);
  const qdiiOverseasLag = resolveHistoricalPremiumNav(
    [{ date: '2026-06-03', nav: 1.2 }],
    '2026-06-08',
    { isCrossBorder: true },
  );
  assert.equal(qdiiOverseasLag.reason, 'nav-lag');
  assert.equal(qdiiOverseasLag.stale, true);
  // 找不到净值：返回 null，不得伪造。
  assert.equal(resolveHistoricalPremiumNav([], '2026-06-05'), null);
});

// ---- 1 天溢价实时补点 ----

test('1d premium realtime point only uses valid snapshot quote time', () => {
  const sortedNav = normalizeNavHistoryItems([{ date: '2026-06-04', nav: 1.0 }]);
  // premiumPercent 为 null 不得生成 0% 点。
  assert.equal(buildRealtimePremiumPoint({ symbol: '510300', premiumPercent: null, updatedAt: '2026-06-05T06:30:00.000Z' }, sortedNav, false), null);
  assert.equal(buildRealtimePremiumPoint({ symbol: '510300', premiumPercent: 0, updatedAt: '2026-06-05T06:30:00.000Z' }, sortedNav, false)?.c, 0);
  // 没有有效行情时间就不补点（禁止用 Date.now 造点）。
  assert.equal(buildRealtimePremiumPoint({ symbol: '510300', premiumPercent: 1.5 }, sortedNav, false), null);
  assert.equal(buildRealtimePremiumPoint({ symbol: '510300', premiumPercent: 1.5, updatedAt: 'not-a-date' }, sortedNav, false), null);
  assert.equal(realtimeQuoteTimeSec({}), 0);
  // 有效快照：点位 t = 快照行情时间，并带 navDate。
  const point = buildRealtimePremiumPoint(
    { symbol: '510300', premiumPercent: 1.5, price: 1.035, updatedAt: '2026-06-05T06:30:00.000Z' },
    sortedNav,
    false,
  );
  assert.equal(point.t, Math.floor(Date.parse('2026-06-05T06:30:00.000Z') / 1000));
  assert.equal(point.date, '2026-06-05');
  assert.equal(point.navDate, '2026-06-04');
  assert.equal(point.marketPrice, 1.035);
});

test('realtime point merge keeps order and dedupes stale snapshots', () => {
  const base = [{ t: 100, c: 1 }, { t: 200, c: 2 }];
  assert.deepEqual(mergeRealtimePremiumPoint(base, { t: 200, c: 9 }), base);
  assert.deepEqual(mergeRealtimePremiumPoint(base, { t: 150, c: 9 }), base);
  assert.deepEqual(mergeRealtimePremiumPoint(base, null), base);
  const merged = mergeRealtimePremiumPoint(base, { t: 300, c: 3 });
  assert.equal(merged.length, 3);
  assert.equal(merged[merged.length - 1].t, 300);
  assert.deepEqual(mergeRealtimePremiumPoint([], { t: 300, c: 3 }), [{ t: 300, c: 3 }]);
});

test('a snapshot of another symbol never pollutes derived candles', () => {
  const priceCandles = [{ t: epochSecFromShanghaiDate('2026-06-05', '10:00:00'), o: 1, h: 1, l: 1, c: 1 }];
  const navItems = [{ date: '2026-06-05', nav: 1 }];
  const foreignSnapshotState = {
    loading: false,
    data: { symbol: '510500', premiumPercent: 3.3, navDate: '2026-06-05', latestNav: 2, updatedAt: '2026-06-05T06:30:00.000Z' },
  };
  // 净值视图不注入其他标的的最新 NAV。
  const navCandles = buildDetailMetricCandles([], navItems, 'nav', foreignSnapshotState, '1mo', false, { code: '513100', customRange: null });
  assert.equal(navCandles.length, 1);
  assert.equal(navCandles[0].c, 1);
  // 1 天溢价视图不用其他标的的溢价造实时点。
  const premiumCandles = buildDetailMetricCandles(priceCandles, navItems, 'premium', foreignSnapshotState, '1d', false, { code: '513100', customRange: null });
  assert.equal(premiumCandles.length, 1);
  // 自己的快照正常生效。
  const ownSnapshotState = {
    loading: false,
    data: { symbol: '513100', premiumPercent: 3.3, navDate: '2026-06-05', latestNav: 1.01, updatedAt: '2026-06-05T06:30:00.000Z', price: 1.0433 },
  };
  const ownNav = buildDetailMetricCandles([], navItems, 'nav', ownSnapshotState, '1mo', false, { code: '513100', customRange: null });
  assert.equal(ownNav[0].c, 1.01);
  const ownPremium = buildDetailMetricCandles(priceCandles, navItems, 'premium', ownSnapshotState, '1d', false, { code: '513100', customRange: null });
  assert.equal(ownPremium.length, 2);
  assert.equal(ownPremium[1].c, 3.3);
  assert.equal(ownPremium[1].marketPrice, 1.0433);
});

// ---- 详情请求去重（“不会调用”守卫）----

test('detail history requests are deduped by settled and inflight state', () => {
  assert.equal(shouldRequestDetailKline({ settled: true, inflight: false }), false);
  assert.equal(shouldRequestDetailKline({ settled: false, inflight: true }), false);
  assert.equal(shouldRequestDetailKline({ settled: false, inflight: false }), true);
  assert.equal(shouldRequestDetailKline({ settled: true, force: true }), true);
  assert.equal(shouldRequestDetailNavHistory({ settled: true, inflight: false }), false);
  assert.equal(shouldRequestDetailNavHistory({ settled: false, inflight: true }), false);
  assert.equal(shouldRequestDetailNavHistory({ settled: false, inflight: false }), true);
  assert.equal(shouldRequestDetailNavHistory({ settled: true, force: true }), true);
});

test('compare kline is not requested for otc symbols, settled keys, inflight keys or failed-until-retry', () => {
  assert.equal(shouldFetchCompareKline({ market: 'cn', symbol: '012345', isOtc: true }), false);
  assert.equal(shouldFetchCompareKline({ market: 'cn', symbol: '510500', settled: true }), false);
  assert.equal(shouldFetchCompareKline({ market: 'cn', symbol: '510500', inflight: true }), false);
  assert.equal(shouldFetchCompareKline({ market: 'cn', symbol: '510500', errorArmed: true }), false);
  assert.equal(shouldFetchCompareKline({ market: 'cn', symbol: '510500' }), true);
  assert.equal(shouldFetchCompareKline({ market: 'cn', symbol: '' }), false);
});

test('compare nav history is only requested when the metric actually needs it', () => {
  // 价格模式下 K 线健康时不拉无用途净值。
  assert.equal(shouldFetchCompareNavHistory({ market: 'cn', code: '510500', param: 'price', klineSettled: true, klineUsable: true }), false);
  // 价格模式下 K 线在途也未拉（等待 K 线结论）。
  assert.equal(shouldFetchCompareNavHistory({ market: 'cn', code: '510500', param: 'price', klineSettled: false, klineUsable: false }), false);
  // 价格模式下 K 线确定不可用时才兜底。
  assert.equal(shouldFetchCompareNavHistory({ market: 'cn', code: '510500', param: 'price', klineSettled: true, klineUsable: false }), true);
  // 场外基金价格即净值。
  assert.equal(shouldFetchCompareNavHistory({ market: 'cn', code: '012345', param: 'price', isOtc: true }), true);
  // 溢价/净值指标需要净值。
  assert.equal(shouldFetchCompareNavHistory({ market: 'cn', code: '510500', param: 'premium' }), true);
  assert.equal(shouldFetchCompareNavHistory({ market: 'cn', code: '510500', param: 'nav' }), true);
  // 场外溢价短路为不支持，不请求。
  assert.equal(shouldFetchCompareNavHistory({ market: 'cn', code: '012345', param: 'premium', isOtc: true }), false);
  // 已请求过 / 在途 / 非基金代码不请求。
  assert.equal(shouldFetchCompareNavHistory({ market: 'cn', code: '510500', param: 'nav', settled: true }), false);
  assert.equal(shouldFetchCompareNavHistory({ market: 'cn', code: '510500', param: 'nav', inflight: true }), false);
  assert.equal(shouldFetchCompareNavHistory({ market: 'cn', code: 'QQQ', param: 'nav' }), false);
  assert.equal(shouldFetchCompareNavHistory({ market: 'us', code: '510500', param: 'nav' }), false);
});

test('compare premium snapshot is fetched per symbol only when needed', () => {
  assert.equal(shouldFetchComparePremiumSnapshot({ market: 'cn', code: '510500', param: 'price' }), false);
  assert.equal(shouldFetchComparePremiumSnapshot({ market: 'cn', code: '510500', param: 'premium' }), true);
  assert.equal(shouldFetchComparePremiumSnapshot({ market: 'cn', code: '510500', param: 'nav' }), true);
  assert.equal(shouldFetchComparePremiumSnapshot({ market: 'cn', code: '012345', param: 'premium', isOtc: true }), false);
  assert.equal(shouldFetchComparePremiumSnapshot({ market: 'cn', code: '510500', param: 'premium', settled: true }), false);
  assert.equal(shouldFetchComparePremiumSnapshot({ market: 'cn', code: '510500', param: 'premium', inflight: true }), false);
});

// ---- 对比 K 线结果收敛：所有失败形态（404 由 catch 兜底、200 空结果、形态非法）都必须进入 error ----

test('compare kline outcome maps every failure shape to error and only >=2 candles to success', () => {
  // 200 但空结果 / 缺 candles 字段 / 字段非法 / 只有单根蜡烛：全部失败。
  assert.deepEqual(resolveCompareKlineOutcome(null), { candles: null, error: true });
  assert.deepEqual(resolveCompareKlineOutcome({}), { candles: null, error: true });
  assert.deepEqual(resolveCompareKlineOutcome({ candles: [] }), { candles: null, error: true });
  assert.deepEqual(resolveCompareKlineOutcome({ candles: 'nope' }), { candles: null, error: true });
  assert.deepEqual(resolveCompareKlineOutcome({ candles: [{ t: 1, c: 1 }] }), { candles: null, error: true });
  // ≥2 根蜡烛才算成功；error 必须为 false，不得残留失败标记。
  const twoCandles = [{ t: 1, c: 1 }, { t: 2, c: 2 }];
  assert.deepEqual(resolveCompareKlineOutcome({ candles: twoCandles }), { candles: twoCandles, error: false });
});

// ---- 对比序列 status 收敛：结论性失败优先于 loading，loading 只在确有 inflight 时成立 ----

test('compare status converges to error when kline failed, never stuck loading on residual nav state', () => {
  // 510500 5 年 K 线 404（价格模式）：K 线是唯一数据源，error 必须立刻胜出，
  // 即使净值兜底请求仍在途/残留 loading 也不得判为 loading（卡死回归点）。
  assert.equal(deriveCompareSeriesStatus({
    ready: false, klineNeeded: true, klineLoading: false, klineError: true,
    navNeeded: false, navLoading: true, navError: '',
  }), 'error');
  // 溢价模式同理：K 线 404 后净值再成功也画不出溢价线。
  assert.equal(deriveCompareSeriesStatus({
    ready: false, klineNeeded: true, klineLoading: false, klineError: true,
    navNeeded: true, navLoading: true, navError: '',
  }), 'error');
  // loading 仅在对应来源确有 inflight 且无结论性失败时成立。
  assert.equal(deriveCompareSeriesStatus({ klineNeeded: true, klineLoading: true }), 'loading');
  assert.equal(deriveCompareSeriesStatus({ klineNeeded: true, navNeeded: true, navLoading: true }), 'loading');
  assert.equal(deriveCompareSeriesStatus({ klineNeeded: true, klineLoading: true, navNeeded: true, navError: '净值历史加载失败' }), 'error');
  // 与本序列无关的净值 loading 不得让 status 停在 loading。
  assert.equal(deriveCompareSeriesStatus({ klineNeeded: true, navNeeded: false, navLoading: true }), 'pending');
  assert.equal(deriveCompareSeriesStatus({ klineNeeded: true }), 'pending');
});

test('compare status reports ready/partial from candles and ignores kline error in nav mode', () => {
  assert.equal(deriveCompareSeriesStatus({ ready: true, enough: true }), 'ready');
  assert.equal(deriveCompareSeriesStatus({ ready: true, enough: false }), 'partial');
  // 净值模式只依赖净值历史：K 线 404 不阻断净值线，由净值自己的结论决定。
  assert.equal(deriveCompareSeriesStatus({
    ready: false, klineNeeded: false, klineError: true, navNeeded: true, navLoading: true,
  }), 'loading');
  assert.equal(deriveCompareSeriesStatus({
    ready: false, klineNeeded: false, klineError: true, navNeeded: true, navError: '暂无净值历史数据',
  }), 'error');
  assert.equal(deriveCompareSeriesStatus({
    ready: false, klineNeeded: false, klineError: true, navNeeded: true,
  }), 'pending');
  // 场外价格模式（净值即价格）同样只看净值结论。
  assert.equal(deriveCompareSeriesStatus({ ready: false, klineNeeded: false, navNeeded: true, navLoading: true }), 'loading');
  assert.equal(deriveCompareSeriesStatus({ ready: false, klineNeeded: false, navNeeded: true, navError: 'network down' }), 'error');
});

// ---- 5 年对比卡死回归：510300/510500（K 线 404）与 513100/513500（K 线 200）两种数据形态 ----

test('510300/510500-shape 5y compare: kline 404 settles to error and only explicit retry refetches', () => {
  const fiveYearLimit = chartKlineLimitForRange('5y');
  // 线上实测：GET /kline/510500?tf=1d&limit=1316&market=cn → 404 symbol_not_found，
  // fetchKline reject 由 effect 的 catch 记 error；200 空结果走 resolveCompareKlineOutcome。
  assert.equal(resolveCompareKlineOutcome({ error: 'symbol_not_found', symbol: '510500' }).error, true);
  for (const sym of ['510300', '510500']) {
    const key = chartKlineCacheKeyForRange(sym, '5y');
    // 请求前允许发起；errorArmed 后不再自动重试；重试按钮清除 errorArmed 后放行。
    assert.equal(shouldFetchCompareKline({ market: 'cn', symbol: sym, settled: false, inflight: false, errorArmed: false }), true);
    assert.equal(shouldFetchCompareKline({ market: 'cn', symbol: sym, settled: false, inflight: false, errorArmed: true }), false);
    assert.equal(shouldFetchCompareKline({ market: 'cn', symbol: sym, settled: false, inflight: true, errorArmed: false }), false);
    // 5 年失败不污染其他区间的键（limit 是区间身份的一部分）。
    assert.notEqual(key, chartKlineCacheKeyForRange(sym, '1y'));
    assert.notEqual(key, chartKlineCacheKeyForRange(sym, '1mo'));
    assert.equal(key, `${sym}|1d|limit=${fiveYearLimit}`);
  }
  // 价格模式 K 线确定不可用后，净值兜底请求放行（klineSettled 由 error 结论成立）。
  assert.equal(shouldFetchCompareNavHistory({ market: 'cn', code: '510500', param: 'price', klineSettled: true, klineUsable: false }), true);
});

test('513100/513500-shape 5y compare: kline 200 with full history renders ready and settles', () => {
  const today = '2026-10-02';
  for (const sym of ['513100', '513500']) {
    // 线上实测：200 + 自 2021-04-28 起的完整日线。
    const candles = dailyCandlesBetween('2021-04-28', '2026-09-30');
    const outcome = resolveCompareKlineOutcome({ candles });
    assert.equal(outcome.error, false);
    const sliced = sliceCandlesForRange(outcome.candles, '5y', null);
    assert.ok(sliced.length >= 2);
    const status = deriveCompareSeriesStatus({
      ready: sliced.length >= 2,
      enough: hasEnoughChartCandles(sliced, '5y', null, { today }),
      klineNeeded: true, klineLoading: false, klineError: false,
    });
    assert.equal(status, 'ready');
    // 成功后 settled，不再自动重发。
    assert.equal(shouldFetchCompareKline({ market: 'cn', symbol: sym, settled: true }), false);
  }
});

test('510500 5y: kline failed but nav history succeeded must never stay loading', async () => {
  // K 线 404、净值历史 200（线上实测两者独立）：状态必须按模式收敛，不卡 loading。
  const navState = await loadDetailNavHistoryState({
    code: '510500',
    query: navHistoryQueryForRange('5y', null, { today: '2026-10-02' }),
    getNavHistory: async () => ({
      items: [{ date: '2021-08-31', nav: 8.1464 }, { date: '2026-09-30', nav: 5.7373 }],
    }),
    getNavSnapshot: async () => null,
  });
  assert.equal(navState.loading, false);
  assert.equal(navState.error, '');
  // 净值模式：净值线照常渲染（ready），K 线 404 不参与判定。
  const navCandles = buildDetailMetricCandles([], navState.items, 'nav', null, '5y', false, { code: '510500', customRange: null });
  assert.ok(navCandles.length >= 2);
  assert.equal(deriveCompareSeriesStatus({
    ready: navCandles.length >= 2,
    enough: hasEnoughChartCandles(navCandles, '5y', null, { today: '2026-10-02' }),
    klineNeeded: false, klineError: true,
    navNeeded: true, navLoading: navState.loading, navError: navState.error,
  }), 'ready');
  // 溢价模式：没有价格就没有溢价线，K 线 404 后必须收敛为 error。
  const premiumCandles = buildDetailMetricCandles([], navState.items, 'premium', null, '5y', false, { code: '510500', customRange: null });
  assert.equal(premiumCandles.length, 0);
  assert.equal(deriveCompareSeriesStatus({
    ready: premiumCandles.length >= 2,
    klineNeeded: true, klineError: true,
    navNeeded: true, navLoading: navState.loading, navError: navState.error,
  }), 'error');
  // 价格模式（场内）：K 线 404 即 error，绝不因净值请求卡在 loading。
  assert.equal(deriveCompareSeriesStatus({
    ready: false, klineNeeded: true, klineError: true,
    navNeeded: false, navLoading: navState.loading, navError: navState.error,
  }), 'error');
});

test('compare nav loader rejection converges to error state instead of residual loading', () => {
  // 对比净值 effect 的 catch 兜底：异常必须写成 loading:false 的错误态，
  // 否则 navLoading 残留 true 会把序列永久卡在 loading。
  const errorState = buildDetailNavErrorState({ loading: true, items: [] }, new Error('boom'), { query: { from: '2021-08-31', to: '2026-10-02' } });
  assert.equal(errorState.loading, false);
  assert.equal(errorState.error, 'boom');
  assert.equal(deriveCompareSeriesStatus({
    ready: false, klineNeeded: true, klineError: true,
    navNeeded: true, navLoading: errorState.loading, navError: errorState.error,
  }), 'error');
  assert.equal(deriveCompareSeriesStatus({
    ready: false, klineNeeded: false, klineError: false,
    navNeeded: true, navLoading: errorState.loading, navError: errorState.error,
  }), 'error');
});

test('compare kline and nav maps keep stable per-symbol per-range keys for both repro pairs', () => {
  const symbols = ['510300', '510500', '513100', '513500'];
  const today = '2026-10-02';
  // K 线 loading/error map 的键：同一标的同一区间的写入与读取必须一致（纯函数确定性）。
  const klineKeys = new Set(symbols.map((sym) => chartKlineCacheKeyForRange(sym, '5y')));
  assert.equal(klineKeys.size, symbols.length);
  for (const sym of symbols) {
    assert.equal(chartKlineCacheKeyForRange(sym, '5y'), chartKlineCacheKeyForRange(sym, '5y'));
    assert.notEqual(chartKlineCacheKeyForRange(sym, '5y'), chartKlineCacheKeyForRange(sym, '1y'));
  }
  // 净值 map 的键与查询同源：`${code}|${from}|${to}`，写入与读取一致。
  const navKeys = new Set(symbols.map((sym) => navHistoryCacheKey(sym, '5y', null, { today })));
  assert.equal(navKeys.size, symbols.length);
  for (const sym of symbols) {
    const query = navHistoryQueryForRange('5y', null, { today });
    assert.equal(navHistoryCacheKey(sym, '5y', null, { today }), `${sym}|${query.from}|${query.to}`);
  }
});

// ---- NAV 状态构造：请求范围、首尾日期、来源与降级标记 ----

test('detail nav state records request range, coverage and source', () => {
  const query = { from: '2026-01-01', to: '2026-06-05' };
  const payloadState = buildDetailNavStateFromPayload(null, {
    items: [{ date: '2026-01-05', nav: 1 }, { date: '2026-06-04', nav: 1.2 }],
    source: 'kv',
    stale: false,
  }, { query });
  assert.equal(payloadState.loading, false);
  assert.equal(payloadState.error, '');
  assert.equal(payloadState.requestFrom, '2026-01-01');
  assert.equal(payloadState.requestTo, '2026-06-05');
  assert.equal(payloadState.firstNavDate, '2026-01-05');
  assert.equal(payloadState.lastNavDate, '2026-06-04');
  assert.equal(payloadState.source, 'kv');
  assert.equal(payloadState.degraded, false);
  assert.deepEqual(detailNavItemsMeta([{ date: '2026-01-05' }, { date: '2026-06-04' }, { date: '' }]), {
    count: 2, firstNavDate: '2026-01-05', lastNavDate: '2026-06-04',
  });
});

test('nav snapshot fallback is always marked as degraded data', () => {
  const query = { from: '2026-01-01', to: '2026-06-05' };
  const degradedState = buildDetailNavStateFromPayload(null, {
    items: [{ date: '2026-06-04', nav: 1.1 }, { date: '2026-06-05', nav: 1.2 }],
  }, { query, degraded: true, error: '' });
  assert.equal(degradedState.degraded, true);
  assert.equal(degradedState.source, 'nav-snapshot');
  assert.equal(degradedState.error, '');
});

test('detail nav error state keeps previous items and records the request range', () => {
  const prevState = {
    loading: true,
    items: [{ date: '2026-06-04', nav: 1.1 }],
    requestFrom: '2026-01-01',
    requestTo: '2026-06-05',
    firstNavDate: '2026-06-04',
    lastNavDate: '2026-06-04',
  };
  const errorState = buildDetailNavErrorState(prevState, new Error('boom'), { query: { from: '2026-01-01', to: '2026-06-05' } });
  assert.equal(errorState.loading, false);
  assert.equal(errorState.error, 'boom');
  assert.deepEqual(errorState.items, [{ date: '2026-06-04', nav: 1.1 }]);
  assert.equal(errorState.requestFrom, '2026-01-01');
  const emptyState = buildDetailNavErrorState(null, '净值历史加载失败', { query: { from: 'a', to: 'b' } });
  assert.equal(emptyState.error, '净值历史加载失败');
  assert.deepEqual(emptyState.items, []);
});

test('nav history loader skips the snapshot endpoint when history is sufficient', async () => {
  const query = { from: '2026-01-01', to: '2026-06-05' };
  const calls = { navHistory: 0, navSnapshot: 0 };
  const state = await loadDetailNavHistoryState({
    code: '513100',
    query,
    getNavHistory: async () => {
      calls.navHistory += 1;
      return { items: [{ date: '2026-01-05', nav: 1 }, { date: '2026-06-04', nav: 1.2 }], cache: { source: 'kv' } };
    },
    getNavSnapshot: async () => {
      calls.navSnapshot += 1;
      return { latestNav: 1.3, latestNavDate: '2026-06-05' };
    },
  });
  assert.equal(calls.navHistory, 1);
  assert.equal(calls.navSnapshot, 0); // 历史充足时不会调用快照接口
  assert.equal(state.degraded, false);
  assert.equal(state.source, 'kv');
  assert.equal(state.lastNavDate, '2026-06-04');
});

test('nav history loader falls back to snapshots only as degraded data', async () => {
  const query = { from: '2026-01-01', to: '2026-06-05' };
  const state = await loadDetailNavHistoryState({
    code: '513100',
    query,
    getNavHistory: async () => ({ items: [] }),
    getNavSnapshot: async () => ({ previousNav: 1.1, previousNavDate: '2026-06-04', latestNav: 1.2, latestNavDate: '2026-06-05' }),
  });
  assert.equal(state.degraded, true);
  assert.equal(state.source, 'nav-snapshot');
  assert.equal(state.items.length, 2);
  assert.equal(state.error, '');
});

test('nav history loader keeps snapshot items when the history request fails', async () => {
  const query = { from: '2026-01-01', to: '2026-06-05' };
  const state = await loadDetailNavHistoryState({
    code: '513100',
    query,
    getNavHistory: async () => { throw new Error('network down'); },
    getNavSnapshot: async () => ({ latestNav: 1.2, latestNavDate: '2026-06-05' }),
  });
  assert.equal(state.loading, false);
  assert.equal(state.degraded, true);
  assert.equal(state.items.length, 1);
  assert.equal(state.error, ''); // 有可用（降级）数据时不当作失败
});

test('nav history loader reports error only when nothing is available', async () => {
  const query = { from: '2026-01-01', to: '2026-06-05' };
  const state = await loadDetailNavHistoryState({
    code: '513100',
    query,
    prevState: { items: [{ date: '2026-06-04', nav: 1.1 }] },
    getNavHistory: async () => { throw new Error('network down'); },
    getNavSnapshot: async () => { throw new Error('snapshot down'); },
  });
  assert.equal(state.loading, false);
  assert.equal(state.error, 'network down');
  assert.deepEqual(state.items, [{ date: '2026-06-04', nav: 1.1 }]); // 保留同范围已加载数据
});
