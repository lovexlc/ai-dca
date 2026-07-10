import { ChevronRight, Star } from 'lucide-react';
import { Sparkline } from '../markets/Sparkline.jsx';
import { formatMarketPrice, formatPercent, formatSymbolDisplay } from '../../pages/markets/marketDisplayUtils.js';
import { cx } from '../experience-ui.jsx';

export function MarketWatchlistCard({ row, kline, selected = false, onClick }) {
  const change = Number(row?.changePercent);
  const tone = Number.isFinite(change) && change > 0 ? 'text-rose-600' : Number.isFinite(change) && change < 0 ? 'text-emerald-600' : 'text-slate-500';
  return (
    <button type="button" className={cx('market-mobile-card', selected && 'is-selected')} onClick={() => onClick?.(row)} aria-pressed={selected}>
      <span className="market-mobile-card__identity"><span className="flex items-center gap-2"><span className={cx('font-mono text-xs font-bold', row?.isHeld ? 'text-rose-600' : 'text-slate-500')}>{formatSymbolDisplay(row?.symbol)}</span>{row?.isHeld ? <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">持仓</span> : null}</span><span className="mt-1 block truncate text-sm font-semibold text-slate-900">{row?.name || formatSymbolDisplay(row?.symbol)}</span>{row?.meta ? <span className="mt-1 block truncate text-[11px] text-slate-400">{row.meta}</span> : null}</span>
      <span className="market-mobile-card__trend"><span className="text-right text-sm font-bold tabular-nums text-slate-900">{formatMarketPrice(row?.price, row)}</span><span className={cx('mt-1 text-xs font-semibold tabular-nums', tone)}>{formatPercent(row?.changePercent)}</span>{Array.isArray(kline) && kline.length > 1 ? <Sparkline points={kline} width={72} height={24} tone={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'} showFill markLast /> : null}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" /><Star className="absolute right-10 top-3 h-3.5 w-3.5 text-slate-300" aria-hidden="true" />
    </button>
  );
}
