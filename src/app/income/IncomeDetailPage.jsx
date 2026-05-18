// IncomeDetailPage.jsx — #/income
//
// 第三刀 3.1：把 IncomeDetail.jsx 顶部卡（4 KPI + benchmark + TimeRangeSelector）整体落到子页。
// 第四刀 4.1：把 ReturnChart + ReturnCalendar 合并进同一页（蚂蚁财富同款一站式）。
//   - 顶部：4 KPI + benchmark + TimeRangeSelector
//   - 中部：ReturnChart（lazy，与上面的 selector 共享 URL range）
//   - 下部：ReturnCalendar（lazy，自带月份切换）
//   - 旧 #/chart / #/calendar 子页已弃用，alias 到本页（见 IncomeSection.jsx）
//   - 数据契约：buildPortfolioSeries({tx,navByCode,from,to}) + fetchNavHistory，与 IncomeSummary 一致
//   - 涨红跌绿；累计盈亏/年化沿用 IncomeDetail 行为

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { LoaderCircle, AlertTriangle } from 'lucide-react';
import SubPageShell from './SubPageShell.jsx';
import { formatCurrency, formatPercent } from '../accumulation.js';
import { cx } from '../../components/experience-ui.jsx';
import { fetchNavHistory } from '../navHistoryClient.js';
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

async function fetchAllNav(codes, from, to) {
  const map = {};
  let anyStale = false;
  await Promise.all(
    codes.map(async (code) => {
      try {
        const res = await fetchNavHistory({ code, from, to });
        map[code] = res.items || [];
        if (res.stale) anyStale = true;
      } catch {
        map[code] = [];
      }
    })
  );
  return { navByCode: map, stale: anyStale };
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
      <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-slate-500">{label}</div>
      <div className={cx('text-xl font-semibold leading-tight tabular-nums sm:text-2xl', primaryClass)}>{primary}</div>
      {sub ? <div className="text-[11px] text-slate-500 tabular-nums">{sub}</div> : null}
    </div>
  );
}

export function IncomeDetailPage({ ledger, onBack }) {
  const [{ range, customFrom, customTo }, setRange, setCustom] = useRangeUrlSync({ defaultRange: DEFAULT_RANGE });
  const transactions = useMemo(() => (Array.isArray(ledger?.transactions) ? ledger.transactions : []), [ledger]);
  const inceptionDate = useMemo(() => firstBuyDate(transactions), [transactions]);
  const today = useMemo(() => todayShanghaiIso(), []);
  const [selectedDate, setSelectedDate] = useState(today);

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

  const [rangeState, setRangeState] = useState({ status: 'idle', series: null, stale: false, error: null });
  const [inceptionState, setInceptionState] = useState({ status: 'idle', series: null, stale: false, error: null });
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

  const isLoading = rangeState.status === 'loading' || inceptionState.status === 'loading';
  const hasError = rangeState.status === 'error' || inceptionState.status === 'error';
  const showStale = rangeState.stale || inceptionState.stale;
  const rangeSeries = rangeState.series;
  const inceptionSeries = inceptionState.series || rangeSeries;

  const rangeLabel = RANGE_LABELS[range] || range;
  const subWindow = rangeWindow ? `${rangeWindow.from} → ${rangeWindow.to}` : '';

  const rangeProfit = rangeSeries?.profit ?? null;
  const rangeRate = rangeSeries?.returnRate ?? null;
  const annualized = rangeSeries?.annualizedReturn ?? null;
  const inceptionProfit = inceptionSeries?.profit ?? null;
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
    <SubPageShell title="收益明细" onBack={onBack} right={statusBadge}>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
        <BigKpi label={`${rangeLabel}收益`} primary={renderCurrency(rangeProfit)} primaryClass={signClass(rangeProfit)} />
        <BigKpi label={`${rangeLabel}收益率`} primary={renderPercent(rangeRate)} primaryClass={signClass(rangeRate)} />
        <BigKpi
          label="累计盈亏"
          primary={renderCurrency(inceptionProfit)}
          primaryClass={signClass(inceptionProfit)}
          sub={inceptionDate ? `起 ${inceptionDate}` : null}
        />
        <BigKpi
          label="年化收益率"
          primary={renderPercent(annualized)}
          primaryClass={signClass(annualized)}
          sub={rangeSeries?.window?.days ? `${rangeSeries.window.days} 天` : null}
        />
      </div>

      <div className="rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
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
          <Suspense fallback={<LazyFallback label="加载收益曲线…" />}>
            <ReturnChart ledger={ledger} />
          </Suspense>
          <Suspense fallback={<LazyFallback label="加载收益日历…" />}>
            <div className="rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
              <ReturnCalendar ledger={ledger} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
            </div>
          </Suspense>
          <Suspense fallback={<LazyFallback label="加载当日明细…" />}>
            <DailyFundBreakdown ledger={ledger} selectedDate={selectedDate} />
          </Suspense>
        </>
      ) : null}
    </SubPageShell>
  );
}

export default IncomeDetailPage;
