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
} from '../src/pages/markets/marketFundMetrics.js';
import { normalizeNavHistoryItems, resolveHistoricalPremiumNav } from '../src/app/fundPremiumNav.js';
import {
  buildDetailNavErrorState,
  buildDetailNavStateFromPayload,
  detailNavItemsMeta,
  loadDetailNavHistoryState,
  planDetailKlineRequest,
  planDetailNavRequest,
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
