import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { loadMarketDetail } from './data/marketDetail.js';
import { INITIAL_MARKET_DETAIL_STATE, summarizeSeries } from './data/marketDetailCore.js';

const WINDOW_OPTIONS = [
  { key: '20', label: '近20日', size: 20 },
  { key: '60', label: '近60日', size: 60 },
  { key: '250', label: '近一年', size: 250 }
];

const DIRECTION_CLASS = {
  up: 'text-rose-600',
  down: 'text-emerald-600',
  flat: 'text-slate-500'
};

function directionOf(value) {
  if (value === null || value === undefined) return 'flat';
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined) return '—';
  return value.toFixed(digits);
}

function formatMoney(value) {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSigned(value) {
  if (value === null || value === undefined) return '—';
  return (value > 0 ? '+' : '') + formatMoney(value);
}

function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
}

function Field({ label, value, tone = 'text-slate-800' }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={'mt-0.5 text-sm font-medium ' + tone}>{value}</p>
    </div>
  );
}

// 轻量走势图：不引图表库，一条 polyline 先把体验跑通。
function Sparkline({ rows }) {
  if (rows.length < 2) return null;
  const closes = rows.map((row) => row.close);
  let min = closes[0];
  let max = closes[0];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i] < min) min = closes[i];
    if (closes[i] > max) max = closes[i];
  }
  const span = max - min || 1;
  const width = 320;
  const height = 72;
  const step = width / (closes.length - 1);
  const points = closes
    .map((close, index) => {
      const x = index * step;
      const y = height - ((close - min) / span) * height;
      return x.toFixed(1) + ',' + y.toFixed(1);
    })
    .join(' ');
  const rising = closes[closes.length - 1] >= closes[0];
  return (
    <svg
      viewBox={'0 0 ' + width + ' ' + height}
      preserveAspectRatio="none"
      className="mt-3 h-20 w-full"
      role="presentation"
    >
      <polyline
        points={points}
        fill="none"
        stroke={rising ? '#e11d48' : '#059669'}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function MarketDetailScreen({ code, onBack }) {
  const [state, setState] = useState(INITIAL_MARKET_DETAIL_STATE);
  const [windowKey, setWindowKey] = useState('60');
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const runLoad = useCallback(
    async (refresh) => {
      setState((prev) => ({
        ...prev,
        status: prev.rows.length || prev.quote ? 'refreshing' : 'loading'
      }));
      const result = await loadMarketDetail({ code, refresh });
      if (!aliveRef.current) return;
      setState({ ...INITIAL_MARKET_DETAIL_STATE, ...result, status: result.ok ? 'ready' : 'error' });
    },
    [code]
  );

  useEffect(() => {
    runLoad(false);
  }, [runLoad]);

  const size = useMemo(() => {
    const option = WINDOW_OPTIONS.find((item) => item.key === windowKey);
    return option ? option.size : 60;
  }, [windowKey]);

  const windowRows = useMemo(() => state.rows.slice(-size), [state.rows, size]);
  const windowStats = useMemo(() => summarizeSeries(windowRows), [windowRows]);
  const recentRows = useMemo(() => windowRows.slice(-10).reverse(), [windowRows]);

  const notes = useMemo(() => {
    const list = [];
    const errors = state.errors || {};
    if (errors.quote) list.push('行情：' + errors.quote);
    if (errors.history) list.push('日线：' + errors.history);
    if (errors.detail) list.push('指标：' + errors.detail);
    if (errors.ledger) list.push('账本：' + errors.ledger);
    return list;
  }, [state.errors]);

  const quote = state.quote;
  const metrics = state.metrics;
  const holding = state.holding;
  const price = (quote && quote.price) || (metrics && metrics.nav) || windowStats.lastClose;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100"
        >
          ← 返回行情
        </button>
        <button
          type="button"
          onClick={() => runLoad(true)}
          disabled={state.status === 'loading' || state.status === 'refreshing'}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 transition-colors enabled:hover:bg-slate-100 disabled:opacity-50"
        >
          {state.status === 'refreshing' ? '刷新中' : '刷新'}
        </button>
      </div>

      <div className="mt-3">
        <h2 className="text-base font-semibold text-slate-900">{state.name || code}</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          {state.code || code}
          {holding && !holding.cleared ? ' · 已持仓' : ''}
          {holding && holding.cleared ? ' · 已清仓' : ''}
        </p>
      </div>

      {!state.ok && state.error ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {state.error}
        </div>
      ) : null}

      {notes.length ? (
        <div className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : null}

      {state.status === 'loading' ? (
        <p className="mt-6 text-center text-xs text-slate-400">行情加载中…</p>
      ) : null}

      {state.ok && !state.hasData && state.status !== 'loading' ? (
        <p className="mt-6 text-center text-xs text-slate-400">
          这只基金暂时拉不到数据，稍后再试。
        </p>
      ) : null}

      {quote || metrics ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-end justify-between gap-3">
            <p className="text-2xl font-semibold text-slate-900">{formatNumber(price, 4)}</p>
            <p
              className={
                'text-sm font-semibold '
                + (DIRECTION_CLASS[directionOf(quote && quote.changePercent)] || DIRECTION_CLASS.flat)
              }
            >
              {formatPercent(quote && quote.changePercent)}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field label="开盘" value={formatNumber(quote && quote.open, 4)} />
            <Field label="最高" value={formatNumber(quote && quote.high, 4)} />
            <Field label="最低" value={formatNumber(quote && quote.low, 4)} />
            <Field label="昨收" value={formatNumber(quote && quote.prevClose, 4)} />
            <Field label="净值" value={formatNumber(metrics && metrics.nav, 4)} />
            <Field
              label="溢价率"
              value={formatPercent(metrics && metrics.premium)}
              tone={DIRECTION_CLASS[directionOf(metrics && metrics.premium)] || 'text-slate-800'}
            />
          </div>
          {metrics && metrics.navDate ? (
            <p className="mt-2 text-xs text-slate-400">净值日期 {metrics.navDate}</p>
          ) : null}
        </div>
      ) : null}

      {holding ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs text-slate-400">我的持仓</p>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <Field label="份额" value={formatNumber(holding.shares, 2)} />
            <Field label="均价" value={formatNumber(holding.avgCost, 4)} />
            <Field label="市值" value={formatMoney(holding.marketValue)} />
            <Field
              label="浮盈亏"
              value={formatSigned(holding.profit)}
              tone={DIRECTION_CLASS[directionOf(holding.profit)] || 'text-slate-800'}
            />
            <Field
              label="收益率"
              value={formatPercent(holding.profitPercent)}
              tone={DIRECTION_CLASS[directionOf(holding.profitPercent)] || 'text-slate-800'}
            />
            <Field
              label="已实现"
              value={formatSigned(holding.realized)}
              tone={DIRECTION_CLASS[directionOf(holding.realized)] || 'text-slate-800'}
            />
          </div>
          <p className="mt-2 text-xs text-slate-400">{holding.txCount + ' 笔交易 · 与持仓页同一套算法'}</p>
        </div>
      ) : null}

      {state.rows.length ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">区间走势</p>
            <div className="flex gap-1.5">
              {WINDOW_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setWindowKey(option.key)}
                  className={'rounded-full px-2.5 py-1 text-xs font-medium transition-colors '
                    + (windowKey === option.key
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100')}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <Sparkline rows={windowRows} />

          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field
              label="区间涨跌"
              value={formatPercent(windowStats.changePercent)}
              tone={DIRECTION_CLASS[directionOf(windowStats.changePercent)] || 'text-slate-800'}
            />
            <Field label="最高" value={formatNumber(windowStats.high, 4)} />
            <Field label="最低" value={formatNumber(windowStats.low, 4)} />
            <Field
              label="距高点"
              value={formatPercent(windowStats.fromHighPercent)}
              tone={DIRECTION_CLASS[directionOf(windowStats.fromHighPercent)] || 'text-slate-800'}
            />
            <Field
              label="近5日"
              value={formatPercent(windowStats.d5)}
              tone={DIRECTION_CLASS[directionOf(windowStats.d5)] || 'text-slate-800'}
            />
            <Field
              label="近20日"
              value={formatPercent(windowStats.d20)}
              tone={DIRECTION_CLASS[directionOf(windowStats.d20)] || 'text-slate-800'}
            />
          </div>

          <p className="mt-2 text-xs text-slate-400">
            {windowStats.count + ' 个交易日'}
            {windowStats.startDate ? ' · ' + windowStats.startDate + ' 起' : ''}
            {windowStats.highDate ? ' · 高点 ' + windowStats.highDate : ''}
          </p>
        </div>
      ) : null}

      {recentRows.length ? (
        <div className="mt-3">
          <p className="text-xs text-slate-400">近期日线</p>
          <ul className="mt-2 space-y-1.5">
            {recentRows.map((row, index) => {
              const prev = windowRows[windowRows.length - recentRows.length + index - 1];
              const change = prev ? ((row.close - prev.close) / prev.close) * 100 : null;
              return (
                <li
                  key={row.date || 'row-' + index}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <p className="text-xs text-slate-500">{row.date || '日期缺失'}</p>
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-slate-800">{formatNumber(row.close, 4)}</p>
                    <p
                      className={
                        'w-16 text-right text-xs font-medium '
                        + (DIRECTION_CLASS[directionOf(change)] || DIRECTION_CLASS.flat)
                      }
                    >
                      {change === null ? '—' : formatPercent(change)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-slate-400">beta 只读行情，自选与记账请回正式版。</p>
    </div>
  );
}

export default MarketDetailScreen;
