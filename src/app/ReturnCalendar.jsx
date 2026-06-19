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
import { ChevronLeft, ChevronRight, LoaderCircle, AlertTriangle } from 'lucide-react';
import { formatCurrency } from './accumulation.js';
import { cx } from '../components/experience-ui.jsx';
import { fetchNavHistoryBatch } from './navHistoryClient.js';
import { buildDailyFundPnlMap } from './portfolioSeries.js';

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

// P3：批量拉取（同 ReturnChart）。
async function fetchAllNav(codes, from, to) {
  if (!codes || !codes.length) return { navByCode: {}, stale: false };
  const res = await fetchNavHistoryBatch({ codes, from, to });
  return { navByCode: res.navByCode, stale: res.stale };
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

// 计算颜色：未选中的涨跌日期统一使用浅红/浅绿，避免深色块过重。
export function toneFor(pnl, max) {
  if (!Number.isFinite(pnl) || pnl === 0 || !Number.isFinite(max) || max === 0) {
    return { className: 'bg-slate-50 text-slate-400 border-slate-100', kind: 'flat' };
  }
  if (pnl > 0) {
    return {
      className: 'bg-rose-50 text-rose-700 border-rose-100',
      kind: 'up'
    };
  }
  return {
    className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
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

function DayCell({ cell, pnl, max, onClick, todayIso, selectedIso, compact = false }) {
  const isToday = cell.iso === todayIso;
  const isSelected = cell.iso === selectedIso;
  const dim = !cell.inMonth;
  const tone = toneFor(pnl, max);
  const hasPnl = Number.isFinite(pnl) && pnl !== 0;
  const dayNum = Number(cell.iso.slice(-2));
  const baseClasses = dim
    ? 'bg-transparent text-slate-300 border-transparent cursor-default'
    : tone.className;
  const selectedClasses = !dim && isSelected
    ? tone.kind === 'up'
      ? 'bg-rose-500 text-white border-rose-500'
      : tone.kind === 'down'
        ? 'bg-emerald-500 text-white border-emerald-500'
        : 'bg-slate-400 text-white border-slate-400'
    : '';
  return (
    <button
      type="button"
      onClick={dim ? undefined : onClick}
      disabled={dim}
      className={cx(
        compact
          ? 'flex aspect-square min-h-0 flex-col items-start justify-between rounded-md border p-1 text-left transition-colors tabular-nums'
          : 'flex aspect-square min-h-[36px] flex-col items-start justify-between rounded-md border p-1 text-left transition-colors tabular-nums sm:min-h-[44px] md:aspect-auto md:h-[64px] lg:h-[68px]',
        isSelected && !dim ? selectedClasses : baseClasses,
        !isSelected && isToday && !dim ? 'ring-1 ring-offset-1 ring-slate-300' : '',
        !dim ? 'hover:brightness-95' : ''
      )}
      aria-label={`${cell.iso} ${hasPnl ? formatCurrency(pnl, '¥', 2) : ''}`}
      title={!dim && isToday ? '今日单元为交易时段实时估算，明日定盘后更新' : undefined}
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

function ReturnCalendar({ ledger, portfolio, className = '', selectedDate, onSelectDate, compact = false }) {
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
        // 左边界左移 30 自然日，保证 singleDayFundPnl 在节假日/月初等非交易日仍能 findNavOnOrBefore 到上一个交易日 nav。
        const navFromIso = shiftDays(fromIso, -30);
        const { navByCode, stale } = await fetchAllNav(codes, navFromIso, toIso);
        if (cancelled) return;
        // 与 DailyFundBreakdown 同源：per-fund 真·当日 pnl 之和（nav.date === day 才计）。
        // 避免「全组合 mv 相邻差」在某基金当日 nav 未披露 + 当日 BUY 双算时出现伪 pnl 与明细加和反号。
        const daily = buildDailyFundPnlMap({ tx: transactions, navByCode, fromIso, toIso });
        const latestDate = String(portfolio?.latestNavDate || '').slice(0, 10);
        // 用实时 portfolio.todayProfit 补最新交易日的格子；但非交易日 todayProfit=0 时不要覆盖
        // 已由 NAV 历史算出的该日真实收益（否则周六会把周五的收益抹成 0）。
        if (latestDate >= fromIso && latestDate <= toIso && Number.isFinite(portfolio?.todayProfit)
          && (Number(portfolio.todayProfit) !== 0 || daily[latestDate] === undefined)) {
          daily[latestDate] = Number(portfolio.todayProfit);
        }
        setState({ status: 'ready', daily, stale, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({ status: 'error', daily: {}, stale: false, error: err });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromIso, toIso, transactions, inceptionDate, portfolio]);

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

      <div className={cx('mt-3 grid grid-cols-7 text-center', compact ? 'gap-0.5' : 'gap-1')}>
        {WEEKDAYS().map((w) => (
          <div key={w} className="text-[10px] font-medium text-slate-400 sm:text-[11px]">{w}</div>
        ))}
        {grid.map((cell) => {
          const pnl = state.daily[cell.iso];
          if (!cell.inMonth) {
            return (
              <DayCell
                key={cell.iso}
                cell={cell}
                pnl={null}
                max={monthMaxAbs}
                onClick={undefined}
                todayIso={todayCellIso}
                selectedIso={selectedDate}
                compact={compact}
              />
            );
          }
          return (
            <DayCell
              key={cell.iso}
              cell={cell}
              pnl={pnl}
              max={monthMaxAbs}
              onClick={() => onSelectDate && onSelectDate(cell.iso)}
              todayIso={todayCellIso}
              selectedIso={selectedDate}
              compact={compact}
            />
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
