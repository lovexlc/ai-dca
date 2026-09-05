import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { sortRows } from './data/marketsListing.js';
import { loadMarketsScreen } from './data/marketsScreen.js';
import { INITIAL_MARKETS_STATE, marketsScreenReducer } from './data/marketsScreenCore.js';

/**
 * MarketsScreen - beta 行情 tab。
 * 组件只管渲染与交互，加载编排与状态转移全在 marketsScreenCore.js（有单测）。
 */

// A 股习惯：涨红跌绿。
const DIRECTION_CLASS = {
  up: 'text-rose-600',
  down: 'text-emerald-600',
  flat: 'text-slate-400'
};

const SORT_OPTIONS = [
  { key: 'changePercent', label: '涨跌幅' },
  { key: 'premiumPercent', label: '溢价率' },
  { key: 'code', label: '代码' }
];

function formatClock(stamp) {
  if (!stamp) return '';
  try {
    return new Date(stamp).toLocaleTimeString('zh-CN', { hour12: false });
  } catch (error) {
    return '';
  }
}

function buildSummaryText(summary, listKind) {
  if (!summary || !summary.total) return '';
  const parts = [(listKind === 'exchange' ? '场内' : '场外') + ' ' + summary.total + ' 只'];
  if (summary.fresh) parts.push(summary.fresh + ' 只是今天的');
  if (summary.stale) parts.push(summary.stale + ' 只数据陈旧');
  if (summary.missing) parts.push(summary.missing + ' 只没拿到');
  if (summary.suspended) parts.push(summary.suspended + ' 只停牌');
  if (summary.marketClosed) parts.push('今天休市');
  return parts.join(' · ');
}

export function MarketsScreen({ onOpenFund }) {
  const [state, dispatch] = useReducer(marketsScreenReducer, INITIAL_MARKETS_STATE);
  const requestRef = useRef(0);
  const aliveRef = useRef(true);

  const runLoad = useCallback(async (options = {}) => {
    requestRef.current += 1;
    const requestId = requestRef.current;
    dispatch({ type: 'request', requestId });
    let result;
    try {
      result = await loadMarketsScreen(options);
    } catch (error) {
      result = { ok: false, error };
    }
    // 组件已卸载就不再 dispatch；reducer 同时会丢掉迟到的旧响应。
    if (!aliveRef.current) return;
    if (result && result.ok) {
      dispatch({ type: 'success', requestId, ...result });
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
    () => sortRows(state.rows, { by: state.sortBy, direction: state.sortDirection }),
    [state.rows, state.sortBy, state.sortDirection]
  );

  const busy = state.status === 'loading' || state.status === 'refreshing';
  const summaryText = buildSummaryText(state.summary, state.listKind);
  const clock = formatClock(state.updatedAt);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">行情</h2>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {summaryText || '自选单行情'}
            {clock ? ' · ' + clock : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={busy}
          className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          {busy ? '刷新中' : '刷新'}
        </button>
      </div>

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

      {state.error ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {state.error}
        </div>
      ) : null}

      {state.status === 'loading' ? (
        <p className="mt-6 text-center text-xs text-slate-400">行情加载中…</p>
      ) : null}

      {state.status !== 'loading' && !rows.length ? (
        <p className="mt-6 text-center text-xs text-slate-400">自选单是空的，先到正式版添加基金。</p>
      ) : null}

      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li key={row.code} className="rounded-lg border border-slate-200 bg-white">
            <button
              type="button"
              onClick={onOpenFund ? () => onOpenFund(row.code) : undefined}
              disabled={!onOpenFund}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors enabled:hover:bg-slate-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-800">{row.name}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {row.code}
                  {row.exchange ? ' · ' + row.exchange : ''}
                  {row.kind === 'qdii' ? ' · QDII' : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={'text-sm font-semibold ' + (DIRECTION_CLASS[row.direction] || DIRECTION_CLASS.flat)}>
                  {row.missing ? '—' : row.changeText}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {row.kind === 'exchange' ? row.priceText : row.navText}
                  {row.fresh ? '' : ' · 非实时'}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default MarketsScreen;
