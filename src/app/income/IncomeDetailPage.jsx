// IncomeDetailPage.jsx — #/income
//
// 第三刀 3.1：把 IncomeDetail.jsx 顶部卡（4 KPI + benchmark + TimeRangeSelector）整体落到子页。
// 第四刀 4.1：把 ReturnChart + ReturnCalendar 合并进同一页（蚂蚁财富同款一站式）。
//   - 顶部：4 KPI + benchmark + TimeRangeSelector
//   - PC：方案 B，左侧大 ReturnChart，右侧 ReturnCalendar + DailyFundBreakdown
//   - 点击收益曲线或收益日历都会刷新同一个 selectedDate 下的当日收益明细
//   - 旧 #/chart / #/calendar 子页已弃用，alias 到本页（见 IncomeSection.jsx）
//   - 数据契约：buildPortfolioSeries({tx,navByCode,from,to}) + fetchNavHistory，与 IncomeSummary 一致
//   - 涨红跌绿；累计盈亏/年化沿用 IncomeDetail 行为

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { LoaderCircle, AlertTriangle, ChevronDown, X } from 'lucide-react';
import SubPageShell from './SubPageShell.jsx';
import { formatCurrency, formatPercent } from '../accumulation.js';
import { cx } from '../../components/experience-ui.jsx';
import { fetchNavHistory, fetchNavHistoryBatch } from '../navHistoryClient.js';
import { buildPortfolioSeries, resolveRangeWindow, shiftDays } from '../portfolioSeries.js';
import { TimeRangeSelector } from '../TimeRangeSelector.jsx';
import { useRangeUrlSync, DEFAULT_RANGE } from '../rangeUrlSync.js';

const ReturnChart = lazy(() => import('../ReturnChart.jsx'));
const ReturnCalendar = lazy(() => import('../ReturnCalendar.jsx'));
const DailyFundBreakdown = lazy(() => import('./DailyFundBreakdown.jsx'));

function LazyFallback({ label }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white px-3 py-6 text-[11px] text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:text-xs">
      <LoaderCircle className="size-3 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

const RANGE_LABELS = {
  today: '今日',
  week: '本周',
  lastWeek: '上周',
  month: '本月',
  lastMonth: '上月',
  ytd: '今年来',
  year: '今年来',
  lastYear: '去年',
  last365d: '近一年',
  sinceInception: '投资以来',
  custom: '自定义',
};

const BENCH_CODE = '510300';
const BENCH_LABEL = '沪深300';

const TONE_UP = 'text-rose-600';
const TONE_DOWN = 'text-emerald-600';
const TONE_NEUTRAL = 'text-slate-700';
const TONE_DIM = 'text-slate-400';

function navOnOrBefore(items, isoDate) {
  if (!Array.isArray(items) || items.length === 0 || !isoDate) return null;
  let pick = null;
  for (const it of items) {
    if (!it || !it.date || typeof it.nav !== 'number') continue;
    if (it.date <= isoDate) {
      if (!pick || it.date > pick.date) pick = it;
    }
  }
  return pick ? pick.nav : null;
}

function navOnOrAfter(items, isoDate) {
  if (!Array.isArray(items) || items.length === 0 || !isoDate) return null;
  let pick = null;
  for (const it of items) {
    if (!it || !it.date || typeof it.nav !== 'number') continue;
    if (it.date >= isoDate) {
      if (!pick || it.date < pick.date) pick = it;
    }
  }
  return pick ? pick.nav : null;
}

function todayShanghaiIso() {
  try {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function firstBuyDate(txs) {
  let min = null;
  for (const tx of txs || []) {
    if (tx?.type !== 'BUY' || !tx?.date) continue;
    const iso = String(tx.date).slice(0, 10);
    if (!min || iso < min) min = iso;
  }
  return min;
}

function uniqCodes(txs) {
  const set = new Set();
  for (const tx of txs || []) {
    if (tx?.code) set.add(String(tx.code).trim());
  }
  return Array.from(set).filter(Boolean);
}

// P3：批量拉取（同 ReturnChart）。bench (510300) 仍走单次 fetchNavHistory。
async function fetchAllNav(codes, from, to) {
  if (!codes || !codes.length) return { navByCode: {}, stale: false };
  const res = await fetchNavHistoryBatch({ codes, from, to });
  return { navByCode: res.navByCode, stale: res.stale };
}

function safeResolveRange(range, opts) {
  try {
    return resolveRangeWindow(range, opts);
  } catch {
    return null;
  }
}

function signClass(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return TONE_NEUTRAL;
  if (value > 0) return TONE_UP;
  if (value < 0) return TONE_DOWN;
  return TONE_NEUTRAL;
}

function renderCurrency(value, { keepSign = true } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = keepSign && value > 0 ? '+' : '';
  return `${sign}${formatCurrency(value, '¥', 2)}`;
}

function renderPercent(value, { keepSign = true, digits = 2 } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return formatPercent(value * 100, digits, keepSign);
}

function BigKpi({ label, primary, primaryClass, sub }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
      <div className="min-w-0 truncate text-[11px] font-medium uppercase tracking-[0.04em] text-slate-500">{label}</div>
      <div className={cx('min-w-0 truncate whitespace-nowrap text-lg font-semibold leading-tight tabular-nums min-[380px]:text-xl sm:text-2xl', primaryClass)}>{primary}</div>
      {sub ? <div className="min-w-0 truncate whitespace-nowrap text-[11px] text-slate-500 tabular-nums">{sub}</div> : null}
    </div>
  );
}

function MobileOverview({ rangeLabel, todayProfit, rangeProfit, rangeRate, onOpenRange }) {
  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:hidden">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[16px] font-semibold text-slate-900">收益总览</div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] text-slate-500">今日收益(元)</div>
          <div className={cx('mt-2 truncate whitespace-nowrap text-[18px] font-semibold tabular-nums', signClass(todayProfit))}>
            {renderCurrency(todayProfit)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-[12px] text-slate-500">{rangeLabel}收益(元)</div>
          <div className={cx('mt-2 truncate whitespace-nowrap text-[18px] font-semibold tabular-nums', signClass(rangeProfit))}>
            {renderCurrency(rangeProfit)}
          </div>
        </div>
        <button type="button" onClick={onOpenRange} className="min-w-0 rounded-2xl text-left" aria-label="选择收益率时间">
          <div className="flex items-center gap-1 text-[12px] text-slate-500">
            <span>收益率</span>
            <ChevronDown className="size-3" />
          </div>
          <div className={cx('mt-2 truncate whitespace-nowrap text-[18px] font-semibold tabular-nums', signClass(rangeRate))}>
            {renderPercent(rangeRate)}
          </div>
        </button>
      </div>
    </div>
  );
}

const MOBILE_RANGE_OPTIONS = [
  { key: 'lastWeek', label: '上周' },
  { key: 'lastMonth', label: '上月' },
  { key: 'ytd', label: '本年' },
  { key: 'lastYear', label: '去年' },
  { key: 'last365d', label: '近一年' },
  { key: 'sinceInception', label: '投资以来' }
];

function MobileRangeSheet({ open, activeRange, inceptionEnabled, onClose, onSelect }) {
  if (!open) return null;
  const activeKey = activeRange === 'year' ? 'ytd' : activeRange;
  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <button type="button" aria-label="关闭时间选择" className="absolute inset-0 bg-slate-950/55" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-5 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="text-[20px] font-semibold text-slate-900">更多时间选择</div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-slate-600" aria-label="关闭">
            <X className="size-6" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {MOBILE_RANGE_OPTIONS.map((item) => {
            const disabled = item.key === 'sinceInception' && !inceptionEnabled;
            const active = activeKey === item.key;
            return (
              <button
                key={item.key}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  onSelect(item.key);
                  onClose();
                }}
                className={cx(
                  'relative h-[68px] rounded-sm text-[18px] font-medium transition-colors',
                  disabled
                    ? 'bg-slate-50 text-slate-300'
                    : active
                      ? 'bg-blue-50 text-blue-600'
                      : 'bg-slate-50 text-slate-800'
                )}
              >
                {item.label}
                {active ? (
                  <span className="absolute bottom-0 right-0 h-0 w-0 border-b-[28px] border-l-[28px] border-b-blue-500 border-l-transparent">
                    <span className="absolute -bottom-[26px] right-0 text-[16px] leading-none text-white">✓</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-8 h-14 w-full rounded-full bg-blue-600 text-[20px] font-semibold text-white shadow-sm active:bg-blue-700"
        >
          确定
        </button>
      </div>
    </div>
  );
}

export function IncomeDetailPage({ ledger, portfolio, onBack, navigate, currentRoute }) {
  const [{ range, customFrom, customTo }, setRange, setCustom] = useRangeUrlSync({ defaultRange: DEFAULT_RANGE });
  const transactions = useMemo(() => (Array.isArray(ledger?.transactions) ? ledger.transactions : []), [ledger]);
  const inceptionDate = useMemo(() => firstBuyDate(transactions), [transactions]);
  const today = useMemo(() => todayShanghaiIso(), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [mobileRangeOpen, setMobileRangeOpen] = useState(false);
  const [mobileChartExpanded, setMobileChartExpanded] = useState(true);

  const rangeWindow = useMemo(
    () =>
      safeResolveRange(range, {
        today,
        inceptionDate,
        custom: range === 'custom' && customFrom && customTo ? { from: customFrom, to: customTo } : undefined,
      }),
    [range, customFrom, customTo, today, inceptionDate]
  );
  const inceptionWindow = useMemo(() => (inceptionDate ? { from: inceptionDate, to: today } : null), [inceptionDate, today]);
  const todayWindow = useMemo(() => ({ from: today, to: today }), [today]);

  const [rangeState, setRangeState] = useState({ status: 'idle', series: null, stale: false, error: null });
  const [inceptionState, setInceptionState] = useState({ status: 'idle', series: null, stale: false, error: null });
  const [todayState, setTodayState] = useState({ status: 'idle', series: null, stale: false, error: null });
  const [benchState, setBenchState] = useState({ status: 'idle', rate: null, stale: false, error: null });

  const loadFor = useCallback(
    async ({ window: w, setState }) => {
      if (!w) {
        setState({ status: 'idle', series: null, stale: false, error: null });
        return;
      }
      setState((prev) => ({ ...prev, status: 'loading', error: null }));
      try {
        const codes = uniqCodes(transactions);
        // 左边界左移 30d，保证 vStart 在节假日/元旦等非交易日上能 fallback 到上个交易日 nav。
        const navFromIso = shiftDays(w.from, -30);
        const nav = codes.length ? await fetchAllNav(codes, navFromIso, w.to) : { navByCode: {}, stale: false };
        const series = buildPortfolioSeries({ tx: transactions, navByCode: nav.navByCode, from: w.from, to: w.to });
        setState({ status: 'ready', series, stale: nav.stale, error: null });
      } catch (err) {
        setState({ status: 'error', series: null, stale: false, error: err });
      }
    },
    [transactions]
  );

  useEffect(() => {
    let cancelled = false;
    if (!rangeWindow) {
      setRangeState({ status: 'idle', series: null, stale: false, error: null });
      return undefined;
    }
    loadFor({
      window: rangeWindow,
      setState: (next) => {
        if (cancelled) return;
        setRangeState((prev) => (typeof next === 'function' ? next(prev) : next));
      },
    });
    return () => {
      cancelled = true;
    };
  }, [loadFor, rangeWindow]);

  useEffect(() => {
    let cancelled = false;
    if (!todayWindow) {
      setTodayState({ status: 'idle', series: null, stale: false, error: null });
      return undefined;
    }
    loadFor({
      window: todayWindow,
      setState: (next) => {
        if (cancelled) return;
        setTodayState((prev) => (typeof next === 'function' ? next(prev) : next));
      },
    });
    return () => {
      cancelled = true;
    };
  }, [loadFor, todayWindow]);

  useEffect(() => {
    let cancelled = false;
    if (!inceptionWindow) {
      setInceptionState({ status: 'idle', series: null, stale: false, error: null });
      return undefined;
    }
    if (rangeWindow && rangeWindow.from === inceptionWindow.from && rangeWindow.to === inceptionWindow.to) {
      setInceptionState(rangeState);
      return undefined;
    }
    loadFor({
      window: inceptionWindow,
      setState: (next) => {
        if (cancelled) return;
        setInceptionState((prev) => (typeof next === 'function' ? next(prev) : next));
      },
    });
    return () => {
      cancelled = true;
    };
  }, [loadFor, inceptionWindow, rangeWindow, rangeState]);

  useEffect(() => {
    let cancelled = false;
    if (!rangeWindow) {
      setBenchState({ status: 'idle', rate: null, stale: false, error: null });
      return undefined;
    }
    setBenchState((prev) => ({ ...prev, status: 'loading', error: null }));
    (async () => {
      try {
        const res = await fetchNavHistory({ code: BENCH_CODE, from: rangeWindow.from, to: rangeWindow.to });
        if (cancelled) return;
        const items = res?.items || [];
        const startNav = navOnOrAfter(items, rangeWindow.from);
        const endNav = navOnOrBefore(items, rangeWindow.to);
        if (!startNav || !endNav) {
          setBenchState({ status: 'ready', rate: null, stale: !!res?.stale, error: null });
          return;
        }
        setBenchState({ status: 'ready', rate: endNav / startNav - 1, stale: !!res?.stale, error: null });
      } catch (err) {
        if (cancelled) return;
        setBenchState({ status: 'error', rate: null, stale: false, error: err });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rangeWindow]);

  const isLoading = rangeState.status === 'loading' || inceptionState.status === 'loading' || todayState.status === 'loading';
  const hasError = rangeState.status === 'error' || inceptionState.status === 'error' || todayState.status === 'error';
  const showStale = rangeState.stale || inceptionState.stale || todayState.stale;
  const rangeSeries = rangeState.series;
  const rangeLabel = RANGE_LABELS[range] || range;
  const subWindow = rangeWindow ? `${rangeWindow.from} → ${rangeWindow.to}` : '';

  const rangeProfit = rangeSeries?.windowProfit ?? null;
  const todayProfit = todayState.series?.windowProfit ?? null;
  const rangeRate = rangeSeries?.twrReturnRate ?? null;
  const annualized = rangeSeries?.annualizedTwrReturnRate ?? null;
  // 累计盈亏 = portfolio.cumulativeProfit（含已实现盈亏），与 IncomeSummary 顶部卡片同口径同数字，避免「同名两个值」误导。
  const cumulativeProfit = portfolio?.cumulativeProfit ?? null;
  const cumulativeReturnRate = portfolio?.cumulativeReturnRate ?? null;
  const benchRate = benchState.rate;
  const alphaRate = Number.isFinite(rangeRate) && Number.isFinite(benchRate) ? rangeRate - benchRate : null;
  const alphaVerb = alphaRate === null ? null : alphaRate >= 0 ? '跑赢' : '落后';

  const statusBadge = (
    <div className="flex items-center gap-2 text-[11px] text-slate-400 sm:text-xs">
      {isLoading ? (
        <span className="inline-flex items-center gap-1">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />加载中
        </span>
      ) : null}
      {showStale && !isLoading ? (
        <span className="inline-flex items-center gap-1 text-amber-500">
          <AlertTriangle className="h-3.5 w-3.5" />缓存数据
        </span>
      ) : null}
      {hasError && !isLoading ? (
        <span className="inline-flex items-center gap-1 text-rose-500">
          <AlertTriangle className="h-3.5 w-3.5" />加载失败
        </span>
      ) : null}
      {subWindow ? <span className="tabular-nums">{subWindow}</span> : null}
    </div>
  );

  return (
    <SubPageShell title="收益明细" onBack={onBack} navigate={navigate} currentRoute={currentRoute} right={statusBadge}>
      <MobileOverview
        rangeLabel={rangeLabel}
        todayProfit={todayProfit}
        rangeProfit={rangeProfit}
        rangeRate={rangeRate}
        onOpenRange={() => setMobileRangeOpen(true)}
      />

      <div className="hidden grid-cols-2 gap-2 sm:gap-3 md:grid md:grid-cols-4">
        <BigKpi label={`${rangeLabel}收益`} primary={renderCurrency(rangeProfit)} primaryClass={signClass(rangeProfit)} />
        <BigKpi label={`${rangeLabel}收益率`} primary={renderPercent(rangeRate)} primaryClass={signClass(rangeRate)} />
        <BigKpi
          label="累计盈亏"
          primary={renderCurrency(cumulativeProfit)}
          primaryClass={signClass(cumulativeProfit)}
          sub={Number.isFinite(cumulativeReturnRate)
            ? `${cumulativeReturnRate >= 0 ? '+' : ''}${cumulativeReturnRate.toFixed(2)}% 已卖出`
            : (inceptionDate ? `起 ${inceptionDate}` : null)}
        />
        <BigKpi
          label="年化收益率"
          primary={renderPercent(annualized)}
          primaryClass={signClass(annualized)}
          sub={rangeSeries?.window?.days ? `${rangeSeries.window.days} 天` : null}
        />
      </div>

      <div className="hidden rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4 md:block">
        <TimeRangeSelector
          value={range}
          onChange={setRange}
          customRange={customFrom && customTo ? { from: customFrom, to: customTo } : null}
          onCustomChange={setCustom}
          inceptionEnabled={!!inceptionDate}
        />

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs">
          {benchState.status === 'loading' ? (
            <span className={TONE_DIM}>基准加载中…</span>
          ) : alphaRate !== null ? (
            <span className={cx('font-medium', signClass(alphaRate))}>
              {alphaVerb}基准 {renderPercent(Math.abs(alphaRate), { keepSign: false })}
            </span>
          ) : (
            <span className={TONE_DIM}>基准不可用</span>
          )}
          <span className={TONE_DIM}>
            基准 {BENCH_LABEL} {Number.isFinite(benchRate) ? renderPercent(benchRate) : '—'}
          </span>
        </div>

        {inceptionDate ? null : (
          <div className={cx('mt-3 text-[11px] sm:text-xs', TONE_DIM)}>
            暂无成交记录，请先在「交易记录」录入首笔买入。
          </div>
        )}
      </div>

      {inceptionDate ? (
        <>
          <div className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:hidden">
            <button
              type="button"
              onClick={() => setMobileChartExpanded((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-3 text-left"
              aria-expanded={mobileChartExpanded}
            >
              <div>
                <div className="text-[13px] font-semibold text-slate-900">收益曲线</div>
                <div className="mt-0.5 text-[11px] text-slate-500">组合 vs {BENCH_LABEL} · {rangeLabel}</div>
              </div>
              <ChevronDown className={cx('size-4 text-slate-400 transition-transform', mobileChartExpanded ? 'rotate-180' : '')} />
            </button>
            {mobileChartExpanded ? (
              <Suspense fallback={<LazyFallback label="加载收益曲线…" />}>
                <ReturnChart
                  ledger={ledger}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  className="border-0 p-3 pt-0 shadow-none"
                  chartClassName="h-72"
                  hideHeader
                  range={range}
                  customFrom={customFrom}
                  customTo={customTo}
                />
              </Suspense>
            ) : null}
          </div>

          <div className="grid gap-3 md:hidden">
            <Suspense fallback={<LazyFallback label="加载收益日历…" />}>
              <ReturnCalendar
                ledger={ledger}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                compact
              />
            </Suspense>
            <Suspense fallback={<LazyFallback label="加载当日明细…" />}>
              <DailyFundBreakdown
                ledger={ledger}
                selectedDate={selectedDate}
              />
            </Suspense>
          </div>

          <div className="hidden gap-3 md:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
            <Suspense fallback={<LazyFallback label="加载收益曲线…" />}>
              <ReturnChart
                ledger={ledger}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                chartClassName="lg:h-[500px]"
                range={range}
                customFrom={customFrom}
                customTo={customTo}
              />
            </Suspense>
            <div className="grid gap-3 lg:h-[580px] lg:min-h-0 lg:grid-rows-[auto_minmax(0,1fr)]">
              <Suspense fallback={<LazyFallback label="加载收益日历…" />}>
                <ReturnCalendar
                  ledger={ledger}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  compact
                />
              </Suspense>
              <Suspense fallback={<LazyFallback label="加载当日明细…" />}>
                <DailyFundBreakdown
                  ledger={ledger}
                  selectedDate={selectedDate}
                  className="lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden"
                />
              </Suspense>
            </div>
          </div>
        </>
      ) : null}

      <MobileRangeSheet
        open={mobileRangeOpen}
        activeRange={range}
        inceptionEnabled={!!inceptionDate}
        onClose={() => setMobileRangeOpen(false)}
        onSelect={setRange}
      />
    </SubPageShell>
  );
}

export default IncomeDetailPage;
