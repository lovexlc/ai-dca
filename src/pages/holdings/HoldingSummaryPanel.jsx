import { ExternalLink, Minus, Plus } from 'lucide-react';
import { formatCurrency } from '../../app/accumulation.js';
import {
  KIND_LABELS,
  KIND_PILL_TONES,
  TAG_LABELS,
  TAG_PILL_TONES,
  formatNav,
  formatShares,
  formatSignedCurrency,
  formatSignedPercent
} from '../../app/holdingsHelpers.js';
import { Pill, cx } from '../../components/experience-ui.jsx';

export function HoldingSummaryPanel({ aggregate, onNavigateToMarkets, onBuyOrSell }) {
  if (!aggregate) {
    return <div className="text-sm text-slate-500" />;
  }

  const agg = aggregate;
  const profitTone = agg.unrealizedProfit > 0 ? 'text-red-600' : agg.unrealizedProfit < 0 ? 'text-emerald-600' : 'text-slate-700';
  const todayTone = agg.todayProfit > 0 ? 'text-red-600' : agg.todayProfit < 0 ? 'text-emerald-600' : 'text-slate-700';

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">当前基金</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-base font-bold text-slate-900">{agg.code}</span>
          {(Array.isArray(agg.tags) && agg.tags.length > 0 ? agg.tags : [agg.kind]).map((tag) => (
            <Pill key={tag} tone={TAG_PILL_TONES[tag] || KIND_PILL_TONES[tag] || 'slate'}>
              {TAG_LABELS[tag] || KIND_LABELS[tag] || tag}
            </Pill>
          ))}
        </div>
        {agg.name ? <div className="mt-1 text-sm text-slate-600">{agg.name}</div> : null}
      </div>
      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">净份额</dt>
          <dd className="mt-1 min-w-0 truncate whitespace-nowrap tabular-nums text-slate-900">
            {formatShares(agg.totalShares)}
            {agg.pendingSellShares > 0 ? (
              <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-600" title={agg.kind === 'qdii' ? 'QDII 赎回：T 日净值由 T+1 晚公布，T+2 确认后自动扣减' : '场外赎回：T 日晚公布 NAV，T+1 确认后自动扣减'}>
                卖出{formatShares(agg.pendingSellShares)} 份待确认
              </span>
            ) : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">加权均价</dt>
          <dd className="mt-1 min-w-0 truncate whitespace-nowrap tabular-nums text-slate-900">{formatNav(agg.avgCost)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">总成本</dt>
          <dd className="mt-1 min-w-0 truncate whitespace-nowrap tabular-nums text-slate-900">{formatCurrency(agg.totalCost, '¥', 2)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">总市值</dt>
          <dd className="mt-1 min-w-0 truncate whitespace-nowrap tabular-nums text-slate-900">{agg.hasLatestNav ? formatCurrency(agg.marketValue, '¥', 2) : '—'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">累计盈亏</dt>
          <dd className={cx('mt-1 min-w-0 truncate whitespace-nowrap tabular-nums', profitTone)}>
            {agg.hasLatestNav ? `${formatSignedCurrency(agg.unrealizedProfit)} (${formatSignedPercent(agg.unrealizedReturnRate)})` : '—'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">今日盈亏</dt>
          <dd className={cx('mt-1 min-w-0 truncate whitespace-nowrap tabular-nums', todayTone)}>
            {agg.hasTodayNav ? `${formatSignedCurrency(agg.todayProfit)} (${formatSignedPercent(agg.todayReturnRate)})` : '—'}
            {agg.hasTodayNav && agg.todayProfitHolidayDays > 0 ? (
              <sup
                className="ml-1 inline-block rounded-sm bg-amber-50 px-1 py-px align-super text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200"
                title={`跨越节假日：${agg.previousNavDate} → ${agg.latestNavDate}（共 ${agg.todayProfitSpanDays} 天，含 ${agg.todayProfitHolidayDays} 个法定假期工作日）。该「今日盈亏」为整段空窗的累计涨跌，非单日波动。`}
              >跨节{agg.todayProfitSpanDays}日</sup>
            ) : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">BUY 总份额</dt>
          <dd className="mt-1 min-w-0 truncate whitespace-nowrap tabular-nums text-slate-900">{formatShares(agg.buyShares)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">SELL 总份额</dt>
          <dd className="mt-1 min-w-0 truncate whitespace-nowrap tabular-nums text-slate-900">{formatShares(agg.sellShares)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">首买日期</dt>
          <dd className="mt-1 text-slate-700">{agg.firstBuyDate || '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">最新交易</dt>
          <dd className="mt-1 text-slate-700">{agg.lastTxDate || '—'}</dd>
        </div>
      </dl>
      {agg.snapshotError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          净值获取失败：{agg.snapshotError}
        </div>
      ) : null}
      <button
        type="button"
        className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
        onClick={(event) => onNavigateToMarkets(event, agg.code)}
      >
        <ExternalLink className="h-4 w-4" />查看行情详情
      </button>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          className="flex-1 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500"
          onClick={() => onBuyOrSell(agg, 'BUY')}
        >
          <Plus className="h-4 w-4" />买入
        </button>
        <button
          type="button"
          className="flex-1 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-500"
          onClick={() => onBuyOrSell(agg, 'SELL')}
        >
          <Minus className="h-4 w-4" />卖出
        </button>
      </div>
    </div>
  );
}
