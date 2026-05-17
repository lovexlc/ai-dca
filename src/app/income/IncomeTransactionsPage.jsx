// IncomeTransactionsPage.jsx — #/transactions
//
// 第三刀 3.4（简化版）：
//   - HoldingsExperience 内的 ledger 表是编辑表（编辑/排序/筛选/草稿/copy-row 等），完整搬走风险高且涉及大量回写逻辑。
//   - v2 这里先实现一份**只读交易记录**视图：按日期倒序，分组到月，显示 BUY/SELL 徽章 + 代码 + 名称 + 份额 + 价格 + 金额。
//   - 主页 HoldingsExperience 的编辑表保留不动；以后做归一时把编辑能力也搬来。
//
// 字段约定（来自 ledger.transactions）：{ id, code, name?, type:'BUY'|'SELL', date, shares, price, amount?, fee?, nav? }

import { useMemo } from 'react';
import { formatCurrency } from '../accumulation.js';
import { cx } from '../../components/experience-ui.jsx';
import SubPageShell from './SubPageShell.jsx';

const TONE_BUY = 'bg-rose-50 text-rose-700';
const TONE_SELL = 'bg-emerald-50 text-emerald-700';
const TONE_OTHER = 'bg-slate-100 text-slate-600';

function toIsoDay(d) {
  if (!d) return '';
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function monthKeyOf(iso) {
  return iso && iso.length >= 7 ? iso.slice(0, 7) : '未知月';
}

function toneFor(type) {
  if (type === 'BUY') return TONE_BUY;
  if (type === 'SELL') return TONE_SELL;
  return TONE_OTHER;
}

function labelFor(type) {
  if (type === 'BUY') return '买入';
  if (type === 'SELL') return '卖出';
  return type || '其他';
}

function computeAmount(tx) {
  if (Number.isFinite(tx?.amount)) return tx.amount;
  const shares = Number(tx?.shares);
  const price = Number(tx?.price);
  if (Number.isFinite(shares) && Number.isFinite(price)) return shares * price;
  return null;
}

function Row({ tx }) {
  const amount = computeAmount(tx);
  const shares = Number(tx?.shares);
  const price = Number(tx?.price);
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl border border-slate-100 bg-white px-3 py-2 text-[12px] sm:grid-cols-[auto_1.5fr_1fr_1fr_1fr] sm:text-[13px]">
      <span className={cx('inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold sm:text-[11px]', toneFor(tx.type))}>
        {labelFor(tx.type)}
      </span>
      <span className="min-w-0 truncate text-slate-800">
        <span className="font-mono text-[11px] text-slate-500 sm:text-[12px]">{tx.code || '—'}</span>
        {tx.name ? <span className="ml-2 text-slate-700">{tx.name}</span> : null}
      </span>
      <span className="hidden text-right text-slate-600 tabular-nums sm:inline">{Number.isFinite(shares) ? `${shares.toFixed(2)} 份` : '—'}</span>
      <span className="hidden text-right text-slate-600 tabular-nums sm:inline">{Number.isFinite(price) ? price.toFixed(4) : '—'}</span>
      <span className="text-right font-medium text-slate-800 tabular-nums">{amount === null ? '—' : formatCurrency(amount, '¥', 2)}</span>
    </div>
  );
}

export function IncomeTransactionsPage({ ledger, onBack }) {
  const transactions = useMemo(() => (Array.isArray(ledger?.transactions) ? ledger.transactions : []), [ledger]);

  const sortedByDateDesc = useMemo(() => {
    return [...transactions].sort((a, b) => {
      const da = toIsoDay(a?.date);
      const db = toIsoDay(b?.date);
      if (da === db) return 0;
      return da < db ? 1 : -1;
    });
  }, [transactions]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const tx of sortedByDateDesc) {
      const iso = toIsoDay(tx?.date);
      const k = monthKeyOf(iso);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(tx);
    }
    return Array.from(map.entries());
  }, [sortedByDateDesc]);

  const summary = useMemo(() => {
    let buyCount = 0;
    let sellCount = 0;
    let buyAmount = 0;
    let sellAmount = 0;
    for (const tx of transactions) {
      const amt = computeAmount(tx);
      if (tx?.type === 'BUY') {
        buyCount += 1;
        if (Number.isFinite(amt)) buyAmount += amt;
      } else if (tx?.type === 'SELL') {
        sellCount += 1;
        if (Number.isFinite(amt)) sellAmount += amt;
      }
    }
    return { buyCount, sellCount, buyAmount, sellAmount };
  }, [transactions]);

  return (
    <SubPageShell title="交易记录" onBack={onBack}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <div className="rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-slate-500">买入笔数</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-rose-600 sm:text-2xl">{summary.buyCount}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-slate-500">买入金额</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-rose-600 sm:text-2xl">{formatCurrency(summary.buyAmount, '¥', 2)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-slate-500">卖出笔数</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-600 sm:text-2xl">{summary.sellCount}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-slate-500">卖出金额</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-600 sm:text-2xl">{formatCurrency(summary.sellAmount, '¥', 2)}</div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-sm text-slate-500">
          暂无交易记录。回到主页面录入买入或卖出后再查看。
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(([month, list]) => (
            <section key={month} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between px-1 text-[11px] font-medium text-slate-500 sm:text-xs">
                <span className="tabular-nums">{month}</span>
                <span className="tabular-nums text-slate-400">{list.length} 笔</span>
              </div>
              <div className="flex flex-col gap-1">
                {list.map((tx) => (
                  <Row key={tx.id || `${tx.code}-${tx.date}-${tx.shares}`} tx={tx} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="text-[10.5px] leading-relaxed text-slate-400 sm:text-[11px]">
        提示：本页只读浏览，编辑/删除请回到主页面的交易表。后续版本会把编辑能力也搬到这里。
      </div>
    </SubPageShell>
  );
}

export default IncomeTransactionsPage;
