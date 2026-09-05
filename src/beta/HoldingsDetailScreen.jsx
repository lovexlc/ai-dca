import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadHoldingsDetail } from './data/holdingsDetail.js';
import { INITIAL_DETAIL_STATE } from './data/holdingsDetailCore.js';

/**
 * HoldingsDetailScreen - beta 持仓明细（二级页）。
 * 回答「怎么变成现在这样的」：每笔买卖后的份额、均价、结转的已实现盈亏。
 * 回放与估值全在 holdingsDetailCore.js。
 */

const DIRECTION_CLASS = {
  up: 'text-rose-600',
  down: 'text-emerald-600',
  flat: 'text-slate-400'
};

function formatMoney(value, digits = 2) {
  const num = Number(value);
  if (value === null || value === undefined || !Number.isFinite(num)) return '—';
  try {
    return num.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch (error) {
    return num.toFixed(digits);
  }
}

function formatSigned(value, digits = 2) {
  const num = Number(value);
  if (value === null || value === undefined || !Number.isFinite(num)) return '—';
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

function Field({ label, value, className }) {
  return (
    <div>
      <p className="text-slate-500">{label}</p>
      <p className={'mt-0.5 font-semibold ' + (className || 'text-slate-900')}>{value}</p>
    </div>
  );
}

export function HoldingsDetailScreen({ code, onBack }) {
  const [state, setState] = useState(INITIAL_DETAIL_STATE);
  const aliveRef = useRef(true);

  const runLoad = useCallback(async (options = {}) => {
    setState((prev) => ({ ...prev, status: prev.rows.length ? 'refreshing' : 'loading', error: '' }));
    let result;
    try {
      result = await loadHoldingsDetail({ code, refresh: Boolean(options.refresh) });
    } catch (error) {
      result = { ok: false, error: error && error.message ? error.message : '明细加载失败' };
    }
    if (!aliveRef.current) return;
    if (result && result.ok) {
      setState({ ...INITIAL_DETAIL_STATE, ...result, status: 'ready' });
      return;
    }
    setState((prev) => ({
      ...prev,
      status: 'error',
      error: (result && result.error) || '明细加载失败'
    }));
  }, [code]);

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

  // 流水按最新在上：核心里是时间升序（为了回放均价），展示倒过来。
  const rows = useMemo(() => state.rows.slice().reverse(), [state.rows]);
  const busy = state.status === 'loading' || state.status === 'refreshing';
  const row = state.row;
  const stats = state.stats;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
        >
          返回持仓
        </button>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={busy}
          className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          {busy ? '刷新中' : '刷新'}
        </button>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <h2 className="truncate text-base font-semibold text-slate-900">{state.name || code}</h2>
        {state.cleared ? (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">已清仓</span>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-slate-400">
        {code}
        {state.kind === 'exchange' ? ' · 场内' : ' · 场外'}
        {row && row.estimated ? ' · 估值' : ''}
      </p>

      {state.error ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {state.error}
        </div>
      ) : null}

      {row ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs text-slate-500">市值</p>
          <p className="mt-0.5 text-2xl font-semibold text-slate-900">{formatMoney(row.marketValue)}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Field
              label="浮盈亏"
              value={formatSigned(row.profit)}
              className={DIRECTION_CLASS[directionOf(row.profit)]}
            />
            <Field
              label="收益率"
              value={formatPercent(row.profitPercent)}
              className={DIRECTION_CLASS[directionOf(row.profitPercent)]}
            />
            <Field
              label="今日"
              value={formatSigned(row.dayProfit)}
              className={DIRECTION_CLASS[directionOf(row.dayProfit)]}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Field label="份额" value={formatMoney(row.shares, 2)} />
            <Field label="均价" value={formatMoney(row.avgCost, 4)} />
            <Field label="现价" value={formatMoney(row.price, 4)} />
          </div>
        </div>
      ) : null}

      <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">累计</h3>
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <Field label="买入" value={formatMoney(stats.buyAmount)} />
          <Field label="卖出" value={formatMoney(stats.sellAmount)} />
          <Field
            label="已实现"
            value={formatSigned(stats.realized)}
            className={DIRECTION_CLASS[directionOf(stats.realized)]}
          />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {stats.txCount + ' 笔交易（买 ' + stats.buys + ' · 卖 ' + stats.sells + '）'}
          {stats.firstDate ? ' · ' + stats.firstDate + ' 起' : ''}
        </p>
        {stats.ignored ? (
          <p className="mt-1 text-xs text-slate-400">
            {stats.ignored + ' 条分红 / 转换类交易尚未搬运，未计入回放'}
          </p>
        ) : null}
      </div>

      {state.status === 'loading' ? (
        <p className="mt-6 text-center text-xs text-slate-400">明细加载中…</p>
      ) : null}

      {state.status !== 'loading' && state.empty ? (
        <p className="mt-6 text-center text-xs text-slate-400">这只基金还没有流水。到正式版记一笔买入。</p>
      ) : null}

      {rows.length ? (
        <>
          <h3 className="mt-4 text-sm font-semibold text-slate-900">历史流水</h3>
          <ul className="mt-2 space-y-2">
            {rows.map((item) => (
              <li key={item.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={'shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold '
                        + (item.type === 'BUY' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600')}
                    >
                      {item.type === 'BUY' ? '买入' : '卖出'}
                    </span>
                    <span className="truncate text-xs text-slate-500">{item.date || '日期缺失'}</span>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-slate-900">{formatMoney(item.amount)}</p>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                  <span>{formatMoney(item.shares, 2) + ' 份 · ' + formatMoney(item.price, 4)}</span>
                  <span>{'剩 ' + formatMoney(item.sharesAfter, 2) + ' 份 · 均价 ' + formatMoney(item.avgCostAfter, 4)}</span>
                </div>
                {item.realized === null ? null : (
                  <p className={'mt-1 text-xs font-medium ' + DIRECTION_CLASS[directionOf(item.realized)]}>
                    {'结转已实现 ' + formatSigned(item.realized)}
                  </p>
                )}
                {item.oversold ? (
                  <p className="mt-1 text-xs text-amber-700">卖出份额超过当时持仓，已按剩余份额截断</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="mt-4 text-center text-xs text-slate-400">beta 只读账本，记账与修正请回正式版。</p>
    </div>
  );
}

export default HoldingsDetailScreen;
