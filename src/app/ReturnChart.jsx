// ReturnChart.jsx
//
// 第三刀 3.1：收益曲线（区间内）。
//   - 主线：组合累计收益率 (来自 buildPortfolioSeries.dailySeries.pnlRate)
//   - 副线：沪深 300 累计收益率 (navBench[d] / navBench[start] - 1)
//   - 复用 useRangeUrlSync，与 IncomeDetail 共享 URL 镜头
//   - 默认导出，方便 3.3 用 React.lazy 懒加载（recharts 体积大）
//   - 无业务计算副作用；纯展示

import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';
import { LoaderCircle, AlertTriangle } from 'lucide-react';
import { formatPercent } from './accumulation.js';
import { cx } from '../components/experience-ui.jsx';
import { fetchNavHistory } from './navHistoryClient.js';
import { buildPortfolioSeries, resolveRangeWindow } from './portfolioSeries.js';
import { useRangeUrlSync, DEFAULT_RANGE } from './rangeUrlSync.js';

const BENCH_CODE = '510300';
const BENCH_LABEL = '沪深300';
const PORTFOLIO_LABEL = '我的组合';
const PORTFOLIO_COLOR = '#e11d48'; // rose-600
const BENCH_COLOR = '#475569'; // slate-600

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

// 构造 ISO -> nav 映射，加 forward-fill 取截至某日的最后一个值。
function buildBenchSeries(items, dates) {
  if (!Array.isArray(items) || items.length === 0 || !Array.isArray(dates) || dates.length === 0) {
    return {};
  }
  const sorted = items
    .filter((it) => it && it.date && typeof it.nav === 'number')
    .map((it) => ({ date: String(it.date).slice(0, 10), nav: it.nav }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return {};
  // 找第一个 >= dates[0] 的 nav 做基准；如果没有，则用 sorted[0]
  const startDate = dates[0];
  let baseNav = null;
  for (const it of sorted) {
    if (it.date >= startDate) {
      baseNav = it.nav;
      break;
    }
  }
  if (baseNav === null) baseNav = sorted[sorted.length - 1].nav;
  if (!Number.isFinite(baseNav) || baseNav === 0) return {};
  // 对每个 date forward-fill 取 <= date 的最近 nav
  const out = {};
  let idx = 0;
  let lastNav = baseNav;
  for (const d of dates) {
    while (idx < sorted.length && sorted[idx].date <= d) {
      lastNav = sorted[idx].nav;
      idx += 1;
    }
    out[d] = lastNav / baseNav - 1;
  }
  return out;
}

function formatXTick(iso) {
  if (!iso || typeof iso !== 'string') return '';
  return iso.slice(5); // MM-DD
}

function formatYTick(value) {
  if (!Number.isFinite(value)) return '';
  return formatPercent(value * 100, 1, false);
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white/95 px-2 py-1.5 text-[11px] shadow-sm">
      <div className="font-medium text-slate-700 tabular-nums">{label}</div>
      {payload.map((it) => {
        const v = it?.value;
        if (!Number.isFinite(v)) return null;
        return (
          <div key={it.dataKey} className="flex items-center gap-1.5 tabular-nums">
            <span
              className="inline-block size-1.5 rounded-full"
              style={{ backgroundColor: it.color || it.stroke }}
            />
            <span className="text-slate-500">{it.name}</span>
            <span className="font-medium text-slate-800">{formatPercent(v * 100, 2, true)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ReturnChart({ ledger, className = '' }) {
  const [{ range, customFrom, customTo }] = useRangeUrlSync({ defaultRange: DEFAULT_RANGE });
  const transactions = useMemo(
    () => (Array.isArray(ledger?.transactions) ? ledger.transactions : []),
    [ledger]
  );
  const inceptionDate = useMemo(() => firstBuyDate(transactions), [transactions]);
  const today = useMemo(() => todayShanghaiIso(), []);

  const rangeWindow = useMemo(
    () =>
      safeResolveRange(range, {
        today,
        inceptionDate,
        custom:
          range === 'custom' && customFrom && customTo ? { from: customFrom, to: customTo } : undefined
      }),
    [range, customFrom, customTo, today, inceptionDate]
  );

  const [state, setState] = useState({
    status: 'idle',
    data: [],
    stale: false,
    error: null
  });

  useEffect(() => {
    let cancelled = false;
    if (!rangeWindow) {
      setState({ status: 'idle', data: [], stale: false, error: null });
      return undefined;
    }
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    (async () => {
      try {
        const codes = uniqCodes(transactions);
        const navPromise = codes.length
          ? fetchAllNav(codes, rangeWindow.from, rangeWindow.to)
          : Promise.resolve({ navByCode: {}, stale: false });
        const benchPromise = fetchNavHistory({
          code: BENCH_CODE,
          from: rangeWindow.from,
          to: rangeWindow.to
        }).catch(() => ({ items: [], stale: false }));
        const [nav, bench] = await Promise.all([navPromise, benchPromise]);
        const series = buildPortfolioSeries({
          tx: transactions,
          navByCode: nav.navByCode,
          from: rangeWindow.from,
          to: rangeWindow.to
        });
        const daily = Array.isArray(series?.dailySeries) ? series.dailySeries : [];
        const dates = daily.map((d) => d.date);
        const benchByDate = buildBenchSeries(bench.items, dates);
        const data = daily.map((d) => ({
          date: d.date,
          portfolio: Number.isFinite(d.pnlRate) ? d.pnlRate : null,
          bench: Number.isFinite(benchByDate[d.date]) ? benchByDate[d.date] : null
        }));
        if (cancelled) return;
        setState({
          status: 'ready',
          data,
          stale: !!nav.stale || !!bench.stale,
          error: null
        });
      } catch (err) {
        if (cancelled) return;
        setState({ status: 'error', data: [], stale: false, error: err });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rangeWindow, transactions]);

  const isLoading = state.status === 'loading';
  const isError = state.status === 'error';
  const isEmpty = state.status === 'ready' && state.data.length === 0;

  return (
    <div
      className={cx(
        'rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4',
        className
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-slate-900 sm:text-sm">收益曲线</div>
          <div className="text-[11px] text-slate-500 sm:text-xs">
            组合 vs {BENCH_LABEL}
            {rangeWindow ? (
              <span className="ml-2 tabular-nums">
                {rangeWindow.from} → {rangeWindow.to}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400 sm:text-xs">
          {isLoading ? (
            <span className="inline-flex items-center gap-1">
              <LoaderCircle className="size-3 animate-spin" />
              加载中
            </span>
          ) : null}
          {state.stale ? <span className="text-amber-500">数据缓存</span> : null}
          {isError ? (
            <span className="inline-flex items-center gap-1 text-rose-500">
              <AlertTriangle className="size-3" />
              出错
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 h-56 w-full sm:h-56 lg:h-52">
        {isEmpty || !state.data.length ? (
          <div className="flex h-full items-center justify-center text-[11px] text-slate-400">
            {isLoading ? '准备中…' : '暂无数据'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={state.data}
              margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id="rcPortfolio" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PORTFOLIO_COLOR} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={PORTFOLIO_COLOR} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="rcBench" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BENCH_COLOR} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={BENCH_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatXTick}
                tick={{ fontSize: 10, fill: '#64748b' }}
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1' }}
                minTickGap={24}
              />
              <YAxis
                yAxisId="left"
                tickFormatter={formatYTick}
                tick={{ fontSize: 10, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
                width={42}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={formatYTick}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
                width={42}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend
                verticalAlign="top"
                height={20}
                iconSize={8}
                iconType="circle"
                wrapperStyle={{ fontSize: 11, color: '#475569' }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="portfolio"
                name={PORTFOLIO_LABEL}
                stroke={PORTFOLIO_COLOR}
                strokeWidth={1.5}
                fill="url(#rcPortfolio)"
                connectNulls
                isAnimationActive={false}
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="bench"
                name={BENCH_LABEL}
                stroke={BENCH_COLOR}
                strokeWidth={1}
                fill="url(#rcBench)"
                connectNulls
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export { ReturnChart };
export default ReturnChart;
