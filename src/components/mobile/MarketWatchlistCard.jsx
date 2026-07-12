import { ChevronRight, Bell } from 'lucide-react';
import { Sparkline } from '../markets/Sparkline.jsx';
import { formatMarketPrice, formatPercent, formatSymbolDisplay } from '../../pages/markets/marketDisplayUtils.js';
import { cx } from '../experience-ui.jsx';

export function MarketWatchlistCard({ row, kline, selected = false, onClick }) {
  const change = Number(row?.changePercent);
  const tone = Number.isFinite(change) && change > 0 ? 'text-rose-600' : Number.isFinite(change) && change < 0 ? 'text-emerald-600' : 'text-slate-500';
  const isOtc = row?.kind === "otc" || row?.fundKind === "otc";
  const displayPrice = Number.isFinite(Number(row?.price)) ? (isOtc ? `¥${Number(row.price).toFixed(4)}` : formatMarketPrice(row.price, row)) : "—";
  const displayChange = Number.isFinite(Number(row?.change)) ? `${Number(row.change) > 0 ? "+" : ""}${isOtc ? `¥${Number(row.change).toFixed(4)}` : formatMarketPrice(row.change, row)}` : "—";
  const updateLabel = row?.latestNavDate || row?.updatedAt || row?.quoteTime || "—";
  return (
    <button type="button" className={cx("market-mobile-card", selected && "is-selected")} onClick={() => onClick?.(row)} aria-pressed={selected}>
      <span className="market-mobile-card__identity"><span className="flex items-center gap-2"><span className="market-mobile-card__kind">{isOtc ? "场外基金" : "场内 ETF"}</span><span className="font-mono text-xs font-bold text-slate-500">{formatSymbolDisplay(row?.symbol)}</span>{row?.isHeld ? <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">持仓</span> : null}</span><span className="mt-1 block truncate text-sm font-semibold text-slate-900">{row?.name || formatSymbolDisplay(row?.symbol)}</span></span>
      <span className="market-mobile-card__trend"><span className="text-right text-sm font-bold tabular-nums text-slate-900">{displayPrice}</span><span className={cx("mt-1 text-xs font-semibold tabular-nums", tone)}>{formatPercent(row?.changePercent)}</span>{Array.isArray(kline) && kline.length > 1 ? <Sparkline points={kline} width={72} height={24} tone={change > 0 ? "up" : change < 0 ? "down" : "flat"} showFill markLast /> : null}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" /><Bell className="absolute right-10 top-3 h-3.5 w-3.5 text-slate-300" aria-hidden="true" />
      <span className="market-mobile-card__metrics" aria-label="行情摘要"><span><small>{isOtc ? "最新净值" : "最新价"}</small><b>{displayPrice}</b></span><span><small>今日涨跌额</small><b className={tone}>{displayChange}</b></span><span><small>更新时间</small><b>{updateLabel}</b></span></span>
    </button>
  );
}
