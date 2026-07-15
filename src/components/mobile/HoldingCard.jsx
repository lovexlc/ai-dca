import { Bell, ChevronRight } from 'lucide-react';
import { formatCurrency } from '../../app/accumulation.js';
import { formatSignedCurrency, formatSignedPercent } from '../../app/holdingsHelpers.js';
import { cx } from '../experience-ui.jsx';

export function HoldingCard({ holding, onClick, onOpenAlert }) {
  const profit = Number(holding?.unrealizedProfit) || 0;
  const todayProfit = Number(holding?.todayProfit) || 0;
  const profitTone = profit > 0 ? 'text-rose-600' : profit < 0 ? 'text-emerald-600' : 'text-slate-500';
  const todayTone = todayProfit > 0 ? 'text-rose-600' : todayProfit < 0 ? 'text-emerald-600' : 'text-slate-500';
  const marketValue = holding?.hasLatestNav ? formatCurrency(holding.marketValue, '¥', 2) : '—';

  return (
    <article className="holding-mobile-card" data-testid={`holding-card-${holding?.code || 'unknown'}`}>
      <button type="button" className="holding-mobile-card__main" onClick={() => onClick?.(holding)}>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2"><span className="shrink-0 type-data text-xs font-bold text-slate-500">{holding?.code || '—'}</span>{holding?.kind ? <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{holding.kind}</span> : null}</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-900">{holding?.name || '未命名基金'}</div>
          <div className="mt-1 text-[11px] text-slate-400">持仓市值</div>
        </div>
        <div className="shrink-0 text-right"><div className="text-sm font-bold tabular-nums text-slate-900">{marketValue}</div><div className={cx('mt-1 text-xs font-semibold tabular-nums', todayTone)}>{holding?.hasTodayNav ? formatSignedCurrency(todayProfit) : '—'}</div></div>
        <ChevronRight className="ml-2 h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
      </button>
      <div className="holding-mobile-card__footer"><span className="text-[11px] text-slate-400">累计收益</span><span className={cx('text-xs font-semibold tabular-nums', profitTone)}>{holding?.hasLatestNav ? `${formatSignedCurrency(profit)} (${formatSignedPercent(holding.unrealizedReturnRate)})` : '—'}</span>{onOpenAlert ? <button type="button" className="holding-mobile-card__alert" aria-label={`设置 ${holding?.name || holding?.code || '基金'} 预警`} onClick={() => onOpenAlert(holding)}><Bell className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}</div>
    </article>
  );
}
