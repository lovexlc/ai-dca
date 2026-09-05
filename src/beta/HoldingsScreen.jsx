import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { loadHoldingsScreen } from './data/holdingsScreen.js';
import {
  INITIAL_HOLDINGS_STATE,
  holdingsScreenReducer,
  sortHoldingRows
} from './data/holdingsScreenCore.js';

/**
 * HoldingsScreen - beta 持仓 tab。
 * 只管渲染与交互；账本折持仓、市值估算、状态转移全在 holdingsScreenCore.js。
 */

const DIRECTION_CLASS = {
  up: 'text-rose-600',
  down: 'text-emerald-600',
  flat: 'text-slate-400'
};

const SORT_OPTIONS = [
  { key: 'marketValue', label: '市值' },
  { key: 'profit', label: '盈亏' },
  { key: 'profitPercent', label: '收益率' },
  { key: 'code', label: '代码' }
];

function formatMoney(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  try {
    return num.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch (error) {
    return num.toFixed(digits);
  }
}

function formatSigned(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return (num > 0 ? '+' : '') + formatMoney(num, digits);
}

function formatPercent(value) {
  const num = Number(value);
  if (value === null || value === undefined || !Number.isFinite(num)) return '—';
  return (num > 0 ? '+' : '') + num.toFixed(2) + '%';
}

function directionOf(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return 'flat';
  return num > 0 ? 'up' : 'down';
}

export function HoldingsScreen() {
  const [state, dispatch] = useReducer(holdingsScreenReducer, INITIAL_HOLDINGS_STATE);
  const requestRef = useRef(0);
  const aliveRef = useRef(true);

  const runLoad = useCallback(async (options = {}) => {
    requestRef.current += 1;
    const requestId = requestRef.current;
    dispatch({ type: 'request', requestId });
    let result;
    try {
      result = await loadHoldingsScreen(options);
    } catch (error) {
      result = { ok: false, error };
    }
    if (!aliveRef.current) return;
    if (result && result.ok) {
      dispatch({ type: 'success', requestId, ...result });
      // 行情挂了但持仓还在：持仓照常展示，只把提示补回去。
      if (result.error) dispatch({ type: 'failure', requestId, error: result.error });
    } else {
      dispatch({ type: 'failure', requestId, error: result && result.error });
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    runLoad();
    return () => {
      aliveRef.current = false;
    };
  }, [runLoad]);

  const handleRefresh = useCallback(() => {
    runLoad({ refresh: true });
  }, [runLoad]);

  const handleSort = useCallback((key) => {
    dispatch({ type: 'sort', by: key });
  }, []);

  const rows = useMemo(
    () => sortHoldingRows(state.rows, { by: state.sortBy, direction: state.sortDirection }),
    [state.rows, state.sortBy, state.sortDirection]
  );

  const busy = state.status === 'loading' || state.status === 'refreshing';
  const summary = state.summary;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">持仓</h2>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={busy}
          className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          {busy ? '刷新中' : '刷新'}
        </button>
      </div>

      <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <p className="text-xs text-slate-500">总市值</p>
        <p className="mt-0.5 text-2xl font-semibold text-slate-900">{formatMoney(summary.marketValue)}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <p className="text-slate-500">今日</p>
            <p className={'mt-0.5 font-semibold ' + DIRECTION_CLASS[directionOf(summary.dayProfit)]}>
              {formatSigned(summary.dayProfit)}
            </p>
          </div>
          <div>
            <p className="text-slate-500">浮盈亏</p>
            <p className={'mt-0.5 font-semibold ' + DIRECTION_CLASS[directionOf(summary.profit)]}>
              {formatSigned(summary.profit)}
            </p>
          </div>
          <div>
            <p className="text-slate-500">收益率</p>
            <p className={'mt-0.5 font-semibold ' + DIRECTION_CLASS[directionOf(summary.profitPercent)]}>
              {formatPercent(summary.profitPercent)}
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {summary.positions + ' 只持仓 · 成本 ' + formatMoney(summary.cost)}
          {summary.realized ? ' · 已实现 ' + formatSigned(summary.realized) : ''}
        </p>
      </div>

      {state.error ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {state.error}
        </div>
      ) : null}

      {summary.estimated ? (
        <p className="mt-2 text-xs text-slate-400">
          {summary.estimated + ' 只未拿到实时行情，已用账本快照或成本价估算'}
        </p>
      ) : null}

      {summary.ignoredTransactions ? (
        <p className="mt-1 text-xs text-slate-400">
          {summary.ignoredTransactions + ' 条交易因为代码或类型不识别被跳过（分红、转换等尚未搬运）'}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        {SORT_OPTIONS.map((option) => {
          const isActive = option.key === state.sortBy;
          const arrow = isActive ? (state.sortDirection === 'asc' ? ' ↑' : ' ↓') : '';
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => handleSort(option.key)}
              className={'rounded-full px-3 py-1 text-xs font-medium transition-colors '
                + (isActive
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100')}
            >
              {option.label + arrow}
            </button>
          );
        })}
      </div>

      {state.status === 'loading' ? (
        <p className="mt-6 text-center text-xs text-slate-400">持仓加载中…</p>
      ) : null}

      {state.status !== 'loading' && !rows.length ? (
        <p className="mt-6 text-center text-xs text-slate-400">还没有持仓。先到正式版记一笔买入。</p>
      ) : null}

      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li key={row.code} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-800">{row.name}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {row.code}
                  {row.kind === 'exchange' ? ' · 场内' : ' · 场外'}
                  {row.estimated ? ' · 估值' : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-slate-900">{formatMoney(row.marketValue)}</p>
                <p className={'mt-0.5 text-xs font-medium ' + DIRECTION_CLASS[row.direction]}>
                  {formatSigned(row.profit) + ' · ' + formatPercent(row.profitPercent)}
                </p>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>{formatMoney(row.shares, 2) + ' 份 · 均价 ' + formatMoney(row.avgCost, 4)}</span>
              <span>
                {'现价 ' + formatMoney(row.price, 4)}
                {row.dayProfit ? ' · 今日 ' + formatSigned(row.dayProfit) : ''}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default HoldingsScreen;
