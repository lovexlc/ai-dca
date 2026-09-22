import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { formatSignedPercent } from '../../app/holdingsHelpers.js';
import { fetchNavHistory } from '../../app/navHistoryClient.js';
import { buildPortfolioSeries, shiftDays } from '../../app/portfolioSeries.js';

const CHART_DIMENSION = { width: 1, height: 1 };

function todayShanghaiIso() {
  try {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function firstBuyDate(transactions, fallback = '') {
  if (fallback) return String(fallback).slice(0, 10);
  let earliest = '';
  for (const tx of transactions || []) {
    if (tx?.type !== 'BUY' || !tx?.date) continue;
    const date = String(tx.date).slice(0, 10);
    if (!earliest || date < earliest) earliest = date;
  }
  return earliest;
}

function formatXTick(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  return `${date.slice(2, 4)}/${date.slice(5, 7)}/${date.slice(8, 10)}`;
}

function formatYTick(value) {
  if (!Number.isFinite(Number(value))) return '';
  return `${Number(value).toFixed(1).replace(/\.0$/, '')}%`;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const value = Number(payload[0]?.value);
  if (!Number.isFinite(value)) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-2.5 py-2 text-[11px] shadow-lg">
      <div className="text-slate-500 tabular-nums">{label}</div>
      <div className="mt-0.5 font-semibold text-slate-800 tabular-nums">{formatSignedPercent(value, 2)}</div>
      <div className="mt-1 text-[10px] text-slate-400">按公布净值计算</div>
    </div>
  );
}

function curveStateMessage(state) {
  if (state.status === 'loading') return '计算中…';
  if (state.status === 'error') return state.error || '净值数据不足，无法绘制曲线';
  return '暂无收益数据';
}

export function HoldingReturnCurve({ aggregate, transactions = [] }) {
  const code = String(aggregate?.code || '').trim();
  const focusedTransactions = useMemo(
    () => (Array.isArray(transactions) ? transactions : []).filter((tx) => String(tx?.code || '').trim() === code),
    [transactions, code]
  );
  const inception = firstBuyDate(focusedTransactions, aggregate?.firstBuyDate);
  const [state, setState] = useState({ status: 'idle', data: [], hint: '', error: '' });

  useEffect(() => {
    let cancelled = false;
    const today = todayShanghaiIso();
    if (!code || !inception || inception > today) {
      setState({
        status: 'error',
        data: [],
        hint: inception ? `${inception} → ${today}` : '',
        error: '暂无首买日期，无法绘制曲线'
      });
      return undefined;
    }

    setState((prev) => ({ ...prev, status: 'loading', error: '' }));
    (async () => {
      try {
        const navResult = await fetchNavHistory({
          code,
          from: shiftDays(inception, -30),
          to: today
        });
        if (cancelled) return;
        const series = buildPortfolioSeries({
          tx: focusedTransactions,
          navByCode: { [code]: navResult?.items || [] },
          from: inception,
          to: today,
          cashYield: {}
        });
        const data = (Array.isArray(series?.dailySeries) ? series.dailySeries : [])
          .map((item) => ({
            date: item.date,
            value: Number.isFinite(item.twrCumulative) ? item.twrCumulative * 100 : null
          }))
          .filter((item) => item.value !== null);
        if (!data.length) {
          setState({
            status: 'error',
            data: [],
            hint: `${inception} → ${today}`,
            error: '净值数据不足，无法绘制曲线'
          });
          return;
        }
        setState({
          status: 'ready',
          data,
          hint: `${inception} → ${today}`,
          error: navResult?.stale ? '缓存净值' : ''
        });
      } catch {
        if (!cancelled) {
          setState({
            status: 'error',
            data: [],
            hint: `${inception} → ${today}`,
            error: '净值加载失败，暂时无法绘制曲线'
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, focusedTransactions, inception]);

  const ready = state.status === 'ready' && state.data.length > 0;

  return (
    <section className="mt-4 sm:mt-6" aria-label="累计收益曲线">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">累计收益曲线</h3>
        <span className="text-[11px] text-slate-400 tabular-nums sm:text-xs">{state.hint || '—'}</span>
      </div>
      <div className="mt-2 h-48 min-w-0 sm:h-56">
        {!ready ? (
          <div className={`flex h-full items-center justify-center rounded-xl bg-slate-50 text-xs ${state.status === 'error' ? 'text-rose-500' : 'text-slate-400'}`} aria-live="polite">
            {curveStateMessage(state)}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={CHART_DIMENSION}>
            <AreaChart data={state.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="holdingCurveFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#166534" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#166534" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatXTick}
                tick={{ fontSize: 10, fill: '#64748b' }}
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1' }}
                minTickGap={28}
              />
              <YAxis
                tickFormatter={formatYTick}
                tick={{ fontSize: 10, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
                width={42}
                domain={['auto', 'auto']}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#166534"
                strokeWidth={2}
                fill="url(#holdingCurveFill)"
                connectNulls
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      {state.error === '缓存净值' ? (
        <div className="mt-1 text-right text-[10px] text-amber-500">缓存净值</div>
      ) : null}
    </section>
  );
}

export default HoldingReturnCurve;
