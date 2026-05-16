// ReturnCalendar.jsx
//
// 第三刀 3.2：月度收益日历（热力图）。
//   - 网格：当月 + 前后填充周一起的 6 周 = 42 天
//   - 单日盈亏 = dailySeries[i].pnl - dailySeries[i-1].pnl
//     （pnl 公式：MV - vStart - cumulativeNetCF，相邻日相减即剔除当日现金流，得净盈亏）
//   - 颜色：红涨 / 绿跌 / 灰持平；色深按本月 |pnl| 最大值归一
//   - 月份切换：当月 ± 2 月限位
//   - 点格子 → Radix popover 展示当日交易明细 + 单日盈亏数字
//   - 默认导出，便于 3.3 React.lazy 懒加载

import { useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronLeft, ChevronRight, LoaderCircle, AlertTriangle } from 'lucide-react';
import { formatCurrency } from './accumulation.js';
import { cx } from '../components/experience-ui.jsx';
import { fetchNavHistory } from './navHistoryClient.js';
import { buildPortfolioSeries } from './portfolioSeries.js';

const TONE_UP = 'text-rose-600';
const TONE_DOWN = 'text-emerald-600';
const TONE_DIM = 'text-slate-400';

const MAX_MONTH_OFFSET = 2;

function todayShanghaiIso() {
  try {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function monthKey(year, month1) {
  return year * 12 + (month1 - 1);
}

function monthFromKey(k) {
  const y = Math.floor(k / 12);
  const m = (k % 12) + 1;
  return { year: y, month: m };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function firstOfMonthIso(year, month1) {
  return `${year}-${pad2(month1)}-01`;
}

function lastDayOfMonth(year, month1) {
  // month1 is 1..12; new Date(y, month1, 0) = last day of month1
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function lastOfMonthIso(year, month1) {
  return `${year}-${pad2(month1)}-${pad2(lastDayOfMonth(year, month1))}`;
}

// 返回该 ISO 日期是周几 (ISO: 1=Mon..7=Sun)
function isoDow(iso) {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function shiftDays(iso, delta) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t + delta * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// 生成 42 天网格：从「该月 1 号所在周的周一」开始
function buildGrid(year, month1) {
  const first = firstOfMonthIso(year, month1);
  const dow = isoDow(first); // 1=Mon..7=Sun
  const start = shiftDays(first, -(dow - 1));
  const out = [];
  for (let i = 0; i < 42; i += 1) {
    const iso = shiftDays(start, i);
    const [yy, mm] = iso.split('-').map(Number);
    out.push({ iso, inMonth: yy === year && mm === month1 });
  }
  return out;
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

// dailySeries -> 当日 pnl 映射。第一条无前一日，按 vStart 为基线 → daily = pnl[0]。
export function dailyPnlByDate(dailySeries) {
  const out = {};
  if (!Array.isArray(dailySeries) || dailySeries.length === 0) return out;
  let prev = 0;
  for (const it of dailySeries) {
    if (!it || !it.date || !Number.isFinite(it.pnl)) continue;
    out[it.date] = it.pnl - prev;
    prev = it.pnl;
  }
  return out;
}

export function txsOnDate(transactions, isoDate) {
  if (!Array.isArray(transactions) || !isoDate) return [];
  return transactions.filter((tx) => String(tx?.date || '').slice(0, 10) === isoDate);
}

// 计算颜色：根据本月 |pnl| 最大值归一到 5 档透明度。
export function toneFor(pnl, max) {
  if (!Number.isFinite(pnl) || pnl === 0 || !Number.isFinite(max) || max === 0) {
    return { className: 'bg-slate-50 text-slate-400 border-slate-100', kind: 'flat' };
  }
  const ratio = Math.min(1, Math.abs(pnl) / max);
  const bucket = ratio > 0.8 ? 4 : ratio > 0.6 ? 3 : ratio > 0.4 ? 2 : ratio > 0.2 ? 1 : 0;
  if (pnl > 0) {
    const ups = ['bg-rose-50', 'bg-rose-100', 'bg-rose-200', 'bg-rose-300', 'bg-rose-400'];
    return {
      className: `${ups[bucket]} text-rose-800 border-rose-200`,
      kind: 'up'
    };
  }
  const downs = ['bg-emerald-50', 'bg-emerald-100', 'bg-emerald-200', 'bg-emerald-300', 'bg-emerald-400'];
  return {
    className: `${downs[bucket]} text-emerald-900 border-emerald-200`,
    kind: 'down'
  };
}

function formatPnlCompact(pnl) {
  if (!Number.isFinite(pnl) || pnl === 0) return '·';
  const sign = pnl > 0 ? '+' : '-';
  const abs = Math.abs(pnl);
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}万`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${abs.toFixed(0)}`;
}

function WEEKDAYS() {
  return ['一', '二', '三', '四', '五', '六', '日'];
}

function DayCell({ cell, pnl, max, onClick, todayIso }) {
  const isToday = cell.iso === todayIso;
  const dim = !cell.inMonth;
  const tone = toneFor(pnl, max);
  const hasPnl = Number.isFinite(pnl) && pnl !== 0;
  const dayNum = Number(cell.iso.slice(-2));
  const baseClasses = dim
    ? 'bg-transparent text-slate-300 border-transparent cursor-default'
    : tone.className;
  return (
    <button
      type="button"
      onClick={dim ? undefined : onClick}
      disabled={dim}
      className={cx(
        'flex aspect-square min-h-[36px] flex-col items-start justify-between rounded-md border p-1 text-left transition-colors tabular-nums sm:min-h-[44px]',
        baseClasses,
        isToday && !dim ? 'ring-1 ring-offset-1 ring-slate-400' : '',
        !dim && hasPnl ? 'hover:brightness-95' : ''
      )}
      aria-label={`${cell.iso} ${hasPnl ? formatCurrency(pnl, '¥', 2) : ''}`}
    >
      <span className="text-[10px] font-medium sm:text-[11px]">{dayNum}</span>
      {!dim && hasPnl ? (
        <span className="w-full truncate text-right text-[10px] font-semibold sm:text-[11px]">
          {formatPnlCompact(pnl)}
        </span>
      ) : null}
    </button>
  );
}

function DayDetail({ iso, pnl, txsToday }) {
  const hasTx = Array.isArray(txsToday) && txsToday.length > 0;
  return (
    <div className="w-64 rounded-md border border-slate-200 bg-white p-3 text-[12px] shadow-md">
      <div className="flex items-center justify-between">
        <div className="font-medium text-slate-700 tabular-nums">{iso}</div>
        <div
          className={cx(
            'font-semibold tabular-nums',
            pnl > 0 ? TONE_UP : pnl < 0 ? TONE_DOWN : 'text-slate-400'
          )}
        >
          {Number.isFinite(pnl) && pnl !== 0
            ? `${pnl > 0 ? '+' : ''}${formatCurrency(pnl, '¥', 2)}`
            : '—'}
        </div>
      </div>
      <div className="mt-2">
        <div className="text-[11px] uppercase tracking-wide text-slate-400">交易</div>
        {hasTx ? (
          <ul className="mt-1 space-y-1">
            {txsToday.map((tx, idx) => (
              <li key={`${tx.code}-${idx}`} className="flex items-center justify-between tabular-nums">
                <span className={cx('rounded px-1 text-[10px] font-semibold', tx.type === 'BUY' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>
                  {tx.type}
                </span>
                <span className="flex-1 truncate px-1 text-slate-700">{tx.code}</span>
                <span className="text-slate-500">{Number(tx.shares || 0).toFixed(2)} · {Number(tx.price || 0).toFixed(4)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-1 text-slate-400">无交易</div>
        )}
      </div>
    </div>
  );
}

function ReturnCalendar({ ledger, className = '' }) {
  const transactions = useMemo(
    () => (Array.isArray(ledger?.transactions) ? ledger.transactions : []),
    [ledger]
  );
  const today = useMemo(() => todayShanghaiIso(), []);
  const todayKey = useMemo(() => {
    const [y, m] = today.split('-').map(Number);
    return monthKey(y, m);
  }, [today]);
  const inceptionDate = useMemo(() => firstBuyDate(transactions), [transactions]);

  const [cursorKey, setCursorKey] = useState(todayKey);
  const { year, month } = monthFromKey(cursorKey);
  const fromIso = firstOfMonthIso(year, month);
  const toIso = lastOfMonthIso(year, month);
  const todayCellIso = today;

  const canPrev = cursorKey > todayKey - MAX_MONTH_OFFSET;
  const canNext = cursorKey < todayKey + MAX_MONTH_OFFSET;

  const [state, setState] = useState({ status: 'idle', daily: {}, stale: false, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((p) => ({ ...p, status: 'loading', error: null }));
    (async () => {
      try {
        if (!inceptionDate || transactions.length === 0) {
          if (!cancelled) setState({ status: 'ready', daily: {}, stale: false, error: null });
          return;
        }
        const codes = uniqCodes(transactions);
        const { navByCode, stale } = await fetchAllNav(codes, fromIso, toIso);
        if (cancelled) return;
        const series = buildPortfolioSeries({ tx: transactions, navByCode, from: fromIso, to: toIso });
        const daily = dailyPnlByDate(series.dailySeries || []);
        setState({ status: 'ready', daily, stale, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({ status: 'error', daily: {}, stale: false, error: err });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromIso, toIso, transactions, inceptionDate]);

  const grid = useMemo(() => buildGrid(year, month), [year, month]);

  const monthMaxAbs = useMemo(() => {
    let max = 0;
    for (const c of grid) {
      if (!c.inMonth) continue;
      const v = state.daily[c.iso];
      if (Number.isFinite(v) && Math.abs(v) > max) max = Math.abs(v);
    }
    return max;
  }, [grid, state.daily]);

  const monthTotal = useMemo(() => {
    let total = 0;
    let n = 0;
    for (const c of grid) {
      if (!c.inMonth) continue;
      const v = state.daily[c.iso];
      if (Number.isFinite(v)) {
        total += v;
        n += 1;
      }
    }
    return { total, days: n };
  }, [grid, state.daily]);

  const isLoading = state.status === 'loading';
  const isError = state.status === 'error';

  return (
    <div
      className={cx(
        'rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4',
        className
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-slate-900 sm:text-sm">收益日历</div>
          <div className="text-[11px] text-slate-500 sm:text-xs">
            红涨绿跌 · 当月 ± 2 月
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400 sm:text-xs">
          {isLoading ? (
            <span className="inline-flex items-center gap-1">
              <LoaderCircle className="size-3 animate-spin" />
              加载中
            </span>
          ) : null}
          {state.stale && !isLoading ? <span className="text-amber-500">缓存数据</span> : null}
          {isError ? (
            <span className="inline-flex items-center gap-1 text-rose-500">
              <AlertTriangle className="size-3" />
              出错
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => canPrev && setCursorKey((k) => k - 1)}
          disabled={!canPrev}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-40"
          aria-label="上一月"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="text-[12px] font-medium tabular-nums text-slate-700 sm:text-sm">
          {year} 年 {pad2(month)} 月
          <span className={cx('ml-3 font-semibold tabular-nums', monthTotal.total > 0 ? TONE_UP : monthTotal.total < 0 ? TONE_DOWN : TONE_DIM)}>
            {monthTotal.days === 0
              ? '—'
              : `${monthTotal.total > 0 ? '+' : ''}${formatCurrency(monthTotal.total, '¥', 2)}`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => canNext && setCursorKey((k) => k + 1)}
          disabled={!canNext}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-40"
          aria-label="下一月"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS().map((w) => (
          <div key={w} className="text-[10px] font-medium text-slate-400 sm:text-[11px]">{w}</div>
        ))}
        {grid.map((cell) => {
          const pnl = state.daily[cell.iso];
          const txsToday = cell.inMonth ? txsOnDate(transactions, cell.iso) : [];
          if (!cell.inMonth) {
            return (
              <DayCell
                key={cell.iso}
                cell={cell}
                pnl={null}
                max={monthMaxAbs}
                onClick={undefined}
                todayIso={todayCellIso}
              />
            );
          }
          return (
            <Popover.Root key={cell.iso}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="contents"
                  aria-label={cell.iso}
                >
                  <DayCell
                    cell={cell}
                    pnl={pnl}
                    max={monthMaxAbs}
                    onClick={() => {}}
                    todayIso={todayCellIso}
                  />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content sideOffset={6} className="z-50">
                  <DayDetail iso={cell.iso} pnl={pnl} txsToday={txsToday} />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          );
        })}
      </div>

      {transactions.length === 0 ? (
        <div className={cx('mt-3 text-[11px] sm:text-xs', TONE_DIM)}>暂无成交记录。</div>
      ) : null}
    </div>
  );
}

export { ReturnCalendar };
export default ReturnCalendar;
