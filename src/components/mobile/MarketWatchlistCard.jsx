import { ChevronRight, Bell } from 'lucide-react';
import { Sparkline } from '../markets/Sparkline.jsx';
import { formatMarketPrice, formatPercent, formatPremiumPercent, formatSignedPercent, formatSymbolDisplay } from '../../pages/markets/marketDisplayUtils.js';
import { cx } from '../experience-ui.jsx';

export function MarketWatchlistCard({ row, kline, selected = false, onClick, columns = [], cardAnalysisColumns = [], showTrend = true }) {
  const change = Number(row?.changePercent);
  const tone = Number.isFinite(change) && change > 0 ? 'text-rose-600' : Number.isFinite(change) && change < 0 ? 'text-emerald-600' : 'text-slate-500';
  const isOtc = row?.kind === "otc" || row?.fundKind === "otc";
  const displayPrice = Number.isFinite(Number(row?.price)) ? (isOtc ? `¥${Number(row.price).toFixed(4)}` : formatMarketPrice(row.price, row)) : "—";
  const displayChange = Number.isFinite(Number(row?.change)) ? `${Number(row.change) > 0 ? "+" : ""}${isOtc ? `¥${Number(row.change).toFixed(4)}` : formatMarketPrice(row.change, row)}` : "—";
  const visible = new Set(columns.length ? columns : ['kind', 'symbol', 'name', 'price', 'changePercent', 'change', 'updatedAt', 'isHeld', 'alert']);
  const metrics = (cardAnalysisColumns.length ? cardAnalysisColumns : ['changePercent', 'change']).slice(0, 3);
  const updateLabel = row?.latestNavDate || row?.updatedAt || row?.quoteTime || '—';
  const metricValue = (id) => {
    if (id === 'changePercent') return formatPercent(row?.changePercent);
    if (id === 'change') return displayChange;
    if (id === 'premium') return formatPremiumPercent(row);
    if (id === 'highDrawdown') return row?.dayHighDrawdownPct == null ? '—' : formatSignedPercent(row.dayHighDrawdownPct);
    if (id === 'closeHighDrawdown') return row?.closeHighDrawdownPct == null ? '—' : formatSignedPercent(row.closeHighDrawdownPct);
    if (id === 'historicalPercentile') return row?.historicalPercentile == null ? '—' : `${Number(row.historicalPercentile).toFixed(2)}%`;
    if (id === 'currentYearPercent') return row?.currentYearPercent == null && row?.ytdReturn == null ? '—' : formatSignedPercent(row?.currentYearPercent ?? row?.ytdReturn);
    if (id.startsWith('return')) return row?.[id] == null ? '—' : formatSignedPercent(row[id]);
    if (id === 'limit') return row?.fundLimit?.maxPurchasePerDay ? String(row.fundLimit.maxPurchasePerDay) : '—';
    return row?.[id] == null ? '—' : String(row[id]);
  };
  const metricLabel = (id) => ({ changePercent: '今日涨跌幅', change: '今日涨跌额', premium: '溢价率', highDrawdown: '日高下跌', closeHighDrawdown: '收盘高点下跌', historicalPercentile: '历史水位', currentYearPercent: '今年以来', return1w: '近1周', return1m: '近1月', return3m: '近3月', return6m: '近6月', return1y: '近1年', returnBase: '成立以来', limit: '申购限额' }[id] || id);
  return (
    <button type="button" className={cx("market-mobile-card", selected && "is-selected")} onClick={() => onClick?.(row)} aria-pressed={selected}>
      <span className="market-mobile-card__identity"><span className="flex items-center gap-2">{visible.has("kind") ? <span className="market-mobile-card__kind">{isOtc ? "场外基金" : "场内 ETF"}</span> : null}{visible.has("symbol") ? <span className="font-mono text-xs font-bold text-slate-500">{formatSymbolDisplay(row?.symbol)}</span> : null}{visible.has("isHeld") && row?.isHeld ? <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">持仓</span> : null}</span>{visible.has("name") ? <span className="mt-1 block truncate text-sm font-semibold text-slate-900">{row?.name || formatSymbolDisplay(row?.symbol)}</span> : null}</span>
      <span className="market-mobile-card__trend">{visible.has('price') ? <span className="text-right text-sm font-bold tabular-nums text-slate-900">{displayPrice}</span> : null}{visible.has('changePercent') ? <span className={cx('mt-1 text-xs font-semibold tabular-nums', tone)}>{formatPercent(row?.changePercent)}</span> : null}{showTrend && Array.isArray(kline) && kline.length > 1 ? <Sparkline points={kline} width={72} height={24} tone={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'} showFill markLast /> : null}</span>
      {visible.has('alert') ? <Bell className="absolute right-10 top-3 h-3.5 w-3.5 text-slate-300" aria-hidden="true" /> : null}<ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
      <span className="market-mobile-card__metrics" aria-label="行情分析指标">{visible.has('price') ? <span><small>{isOtc ? '最新净值' : '最新价'}</small><b>{displayPrice}</b></span> : null}{metrics.map((id) => <span key={id}><small>{metricLabel(id)}</small><b className={id.includes('change') || id.includes('Percent') || id.includes('return') || id.includes('Drawdown') ? tone : ''}>{metricValue(id)}</b></span>)}{visible.has('updatedAt') ? <span><small>更新时间</small><b>{updateLabel}</b></span> : null}</span>
    </button>
  );
}
