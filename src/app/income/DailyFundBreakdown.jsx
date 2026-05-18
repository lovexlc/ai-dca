// DailyFundBreakdown.jsx
//
// 「当日收益明细」区—按 selectedDate 展示每只基金当日盈亏。
//   - 联动源：IncomeDetailPage 的 selectedDate state（默认 today）
//   - 数据：fetchNavHistory(code, selectedDate-30d, selectedDate) × singleDayFundPnl()
//   - 参考蚂蚁财富「当日收益明细」 UI

import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, AlertTriangle } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { formatCurrency } from '../accumulation.js';
import { fetchNavHistory } from '../navHistoryClient.js';
import { singleDayFundPnl } from '../portfolioSeries.js';

const TONE_UP = 'text-rose-600';
const TONE_DOWN = 'text-emerald-600';
const TONE_DIM = 'text-slate-400';

function shiftDays(iso, delta) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t + delta * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function uniqCodes(txs) {
  const set = new Set();
  for (const tx of txs || []) {
    if (tx?.code) set.add(String(tx.code).trim());
  }
  return Array.from(set).filter(Boolean);
}

function nameByCode(txs) {
  const map = new Map();
  for (const tx of txs || []) {
    const code = String(tx?.code || '').trim();
    const name = String(tx?.name || '').trim();
    if (!code || !name) continue;
    map.set(code, name);
  }
  return map;
}

function signClass(value) {
  if (!Number.isFinite(value) || value === 0) return TONE_DIM;
  return value > 0 ? TONE_UP : TONE_DOWN;
}

function renderPnl(value) {
  if (!Number.isFinite(value)) return '未更新';
  if (value === 0) return '0.00';
  return `${value > 0 ? '+' : ''}${formatCurrency(value, '¥', 2)}`;
}

export function DailyFundBreakdown({ ledger, selectedDate, className = '' }) {
  const transactions = useMemo(
    () => (Array.isArray(ledger?.transactions) ? ledger.transactions : []),
    [ledger]
  );
  const codes = useMemo(() => uniqCodes(transactions), [transactions]);
  const nameMap = useMemo(() => nameByCode(transactions), [transactions]);

  const [state, setState] = useState({ status: 'idle', rows: [], stale: false, error: null });

  useEffect(() => {
    let cancelled = false;
    if (!selectedDate || codes.length === 0) {
      setState({ status: 'ready', rows: [], stale: false, error: null });
      return undefined;
    }
    setState((p) => ({ ...p, status: 'loading', error: null }));
    const from = shiftDays(selectedDate, -30);
    (async () => {
      try {
        const navByCode = {};
        let anyStale = false;
        await Promise.all(
          codes.map(async (code) => {
            try {
              const res = await fetchNavHistory({ code, from, to: selectedDate });
              navByCode[code] = res?.items || [];
              if (res?.stale) anyStale = true;
            } catch {
              navByCode[code] = [];
            }
          })
        );
        if (cancelled) return;
        const rows = singleDayFundPnl({ tx: transactions, navByCode, date: selectedDate });
        setState({ status: 'ready', rows, stale: anyStale, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({ status: 'error', rows: [], stale: false, error: err });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDate, codes, transactions]);

  const isLoading = state.status === 'loading';
  const isError = state.status === 'error';
  const rows = state.rows || [];
  const hasAnyUpdate = rows.some((r) => Number.isFinite(r.pnl));

  return (
    <div className={cx('rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <div className="text-[13px] font-semibold text-slate-900 sm:text-sm">当日收益明细</div>
          <div className="text-[11px] text-slate-400 tabular-nums sm:text-xs">({selectedDate || '—'})</div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400 sm:text-xs">
          {isLoading ? (
            <span className="inline-flex items-center gap-1">
              <LoaderCircle className="size-3 animate-spin" />加载中
            </span>
          ) : null}
          {state.stale && !isLoading ? <span className="text-amber-500">缓存数据</span> : null}
          {isError ? (
            <span className="inline-flex items-center gap-1 text-rose-500">
              <AlertTriangle className="size-3" />出错
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
        {rows.length === 0 && !isLoading ? (
          <div className={cx('py-4 text-center text-[12px]', TONE_DIM)}>
            {transactions.length === 0 ? '暂无成交记录。' : '当日无持仓。'}
          </div>
        ) : null}
        {rows.map((row) => {
          const displayName = nameMap.get(row.code) || row.code;
          const hasUpdate = Number.isFinite(row.pnl);
          return (
            <div key={row.code} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="min-w-0 truncate text-[13px] font-medium text-slate-800 sm:text-sm">
                  基金 | {displayName}
                </div>
                {hasUpdate ? (
                  <span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">投资增值</span>
                ) : null}
              </div>
              <div className={cx('min-w-0 max-w-[46%] shrink-0 truncate whitespace-nowrap text-right text-sm font-semibold tabular-nums', signClass(row.pnl))}>
                {renderPnl(row.pnl)}
              </div>
            </div>
          );
        })}
      </div>

      {!isLoading && rows.length > 0 && !hasAnyUpdate ? (
        <div className={cx('mt-2 text-center text-[11px]', TONE_DIM)}>该日无净值更新（节假日或未披露）</div>
      ) : null}
    </div>
  );
}

export default DailyFundBreakdown;
