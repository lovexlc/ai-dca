// IncomeDetail.jsx
//
// 「周/月/年收益看板」顶部卡片：KPI 行 + 镜头选择器。
//   - 4 个 KPI：区间收益 / 区间收益率 / 累计盈亏 / 年化收益率
//   - 下嘴 TimeRangeSelector
//   - 内部走 fetchNavHistory + buildPortfolioSeries，有 loading / error / stale 提示
//   - 本 commit (2.2) 只做脚手架 + KPI 行；benchmark / 曲线 / 日历 留给 2.4 / 3.x

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoaderCircle, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatPercent } from './accumulation.js';
import { cx } from '../components/experience-ui.jsx';
import { fetchNavHistory } from './navHistoryClient.js';
import { buildPortfolioSeries, resolveRangeWindow } from './portfolioSeries.js';
import { TimeRangeSelector } from './TimeRangeSelector.jsx';
import { useRangeUrlSync, DEFAULT_RANGE } from './rangeUrlSync.js';

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
  custom: '自定义'
};

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
  if (value === null || value === undefined || !Number.isFinite(value)) return 'text-slate-700';
  if (value > 0) return 'text-rose-600';
  if (value < 0) return 'text-emerald-600';
  return 'text-slate-700';
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

function KpiCell({ label, primary, primaryClass, sub }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className={cx('text-xl font-semibold tabular-nums leading-tight', primaryClass)}>{primary}</div>
      {sub ? <div className="text-xs text-slate-500 tabular-nums">{sub}</div> : null}
    </div>
  );
}

export function IncomeDetail({ ledger, className = '' }) {
  const [{ range, customFrom, customTo }, setRange, setCustom] = useRangeUrlSync({ defaultRange: DEFAULT_RANGE });
  const transactions = useMemo(() => (Array.isArray(ledger?.transactions) ? ledger.transactions : []), [ledger]);
  const inceptionDate = useMemo(() => firstBuyDate(transactions), [transactions]);
  const today = useMemo(() => todayShanghaiIso(), []);

  const rangeWindow = useMemo(
    () =>
      safeResolveRange(range, {
        today,
        inceptionDate,
        custom: range === 'custom' && customFrom && customTo ? { from: customFrom, to: customTo } : undefined
      }),
    [range, customFrom, customTo, today, inceptionDate]
  );
  const inceptionWindow = useMemo(
    () => (inceptionDate ? { from: inceptionDate, to: today } : null),
    [inceptionDate, today]
  );

  const [rangeState, setRangeState] = useState({ status: 'idle', series: null, stale: false, error: null });
  const [inceptionState, setInceptionState] = useState({ status: 'idle', series: null, stale: false, error: null });

  const loadFor = useCallback(
    async ({ window: w, setState }) => {
      if (!w) {
        setState({ status: 'idle', series: null, stale: false, error: null });
        return;
      }
      setState((prev) => ({ ...prev, status: 'loading', error: null }));
      try {
        const codes = uniqCodes(transactions);
        const nav = codes.length ? await fetchAllNav(codes, w.from, w.to) : { navByCode: {}, stale: false };
        const series = buildPortfolioSeries({
          tx: transactions,
          navByCode: nav.navByCode,
          from: w.from,
          to: w.to
        });
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
      }
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
    // 当 range == sinceInception 且区间与 inceptionWindow 一致时，复用 rangeState 避免多余拉取。
    if (rangeWindow && rangeWindow.from === inceptionWindow.from && rangeWindow.to === inceptionWindow.to) {
      setInceptionState(rangeState);
      return undefined;
    }
    loadFor({
      window: inceptionWindow,
      setState: (next) => {
        if (cancelled) return;
        setInceptionState((prev) => (typeof next === 'function' ? next(prev) : next));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadFor, inceptionWindow, rangeWindow, rangeState]);

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

  return (
    <div
      className={cx(
        'rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
        className
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">收益明细</div>
          <div className="text-xs text-slate-500">
            {rangeLabel}
            {subWindow ? <span className="ml-2 tabular-nums">{subWindow}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {isLoading ? (
            <span className="inline-flex items-center gap-1">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              加载中
            </span>
          ) : null}
          {showStale && !isLoading ? (
            <span className="inline-flex items-center gap-1 text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              缓存数据
            </span>
          ) : null}
          {hasError && !isLoading ? (
            <span className="inline-flex items-center gap-1 text-rose-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              加载失败
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-3 divide-x divide-slate-100 md:grid-cols-4 md:divide-y-0">
        <KpiCell
          label={`${rangeLabel}收益`}
          primary={renderCurrency(rangeProfit)}
          primaryClass={signClass(rangeProfit)}
        />
        <KpiCell
          label={`${rangeLabel}收益率`}
          primary={renderPercent(rangeRate)}
          primaryClass={signClass(rangeRate)}
        />
        <KpiCell
          label="累计盈亏"
          primary={renderCurrency(inceptionProfit)}
          primaryClass={signClass(inceptionProfit)}
          sub={inceptionDate ? `起 ${inceptionDate}` : null}
        />
        <KpiCell
          label="年化收益率"
          primary={renderPercent(annualized)}
          primaryClass={signClass(annualized)}
          sub={rangeSeries?.window?.days ? `${rangeSeries.window.days} 天` : null}
        />
      </div>

      <div className="mt-4">
        <TimeRangeSelector
          value={range}
          onChange={setRange}
          customRange={customFrom && customTo ? { from: customFrom, to: customTo } : null}
          onCustomChange={setCustom}
          inceptionEnabled={!!inceptionDate}
        />
      </div>

      {inceptionDate ? null : (
        <div className="mt-3 text-xs text-slate-400">暂无成交记录，请先在下方「成交流水」录入首笔买入。</div>
      )}
    </div>
  );
}

export default IncomeDetail;
