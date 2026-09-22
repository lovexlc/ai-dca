import { useEffect, useState } from 'react';
import { BarChart3, Bell, ChevronDown, ChevronUp, List, Minus, Plus } from 'lucide-react';
import { formatCurrency } from '../../app/accumulation.js';
import {
  KIND_LABELS,
  KIND_PILL_TONES,
  TAG_LABELS,
  TAG_PILL_TONES,
  formatNav,
  formatShares,
  formatSignedPercent
} from '../../app/holdingsHelpers.js';
import { Pill, cx } from '../../components/experience-ui.jsx';
import { HoldingReturnCurve } from './HoldingReturnCurve.jsx';

function trimFixed(value, digits = 2) {
  return Number(value).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function formatCompactCurrency(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const amount = Number(value);
  const abs = Math.abs(amount);
  if (abs >= 100000000) return `¥ ${trimFixed(amount / 100000000)}亿`;
  if (abs >= 10000) return `¥ ${trimFixed(amount / 10000)}万`;
  return formatCurrency(amount, '¥', 2);
}

function formatSignedCompactCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const prefix = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${prefix}${formatCompactCurrency(Math.abs(amount))}`;
}

function profitTone(value, muted = false) {
  if (muted) return 'text-slate-400';
  if (value > 0) return 'text-rose-600';
  if (value < 0) return 'text-emerald-600';
  return 'text-slate-500';
}

function DetailItem({ label, children, className = '' }) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="text-xs font-medium tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 min-w-0 text-[13px] leading-5 tabular-nums text-slate-800 sm:text-[15px] sm:leading-6">{children}</dd>
    </div>
  );
}

export function HoldingSummaryPanel({
  aggregate,
  transactions = [],
  onNavigateToMarkets,
  onBuyOrSell,
  onOpenAlertDialog,
  onOpenIncomeDetails,
  onOpenTransactionDetails
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  useEffect(() => {
    setDetailsExpanded(false);
  }, [aggregate?.code, aggregate?.aggregationKey]);

  if (!aggregate) {
    return <div className="text-sm text-slate-500" />;
  }

  const agg = aggregate;
  const tags = Array.isArray(agg.tags) && agg.tags.length > 0 ? agg.tags : [agg.kind];
  const hasValue = agg.hasLatestNav || agg.pendingBuyAmount > 0;
  const currentReady = agg.hasCurrentPrice;
  const totalReady = agg.hasLatestNav;
  const isExchangeVenue = agg.tradingVenue === 'exchange'
    || (!agg.tradingVenue && agg.kind === 'exchange');
  const changeValue = Number(agg.changePercent);
  const hasChangeValue = currentReady && Number.isFinite(changeValue);
  const premiumValue = Number(agg.premiumPercent);
  const hasPremiumValue = isExchangeVenue && Number.isFinite(premiumValue);
  const holdingAmountLabel = hasValue ? formatCompactCurrency(agg.marketValue) : '—';
  const currentChangeLabel = hasChangeValue ? formatSignedPercent(changeValue) : '—';
  const premiumLabel = hasPremiumValue ? formatSignedPercent(premiumValue) : '—';
  const totalChangeLabel = totalReady ? formatSignedPercent(agg.unrealizedReturnRate) : '—';
  const pendingHint = agg.kind === 'qdii'
    ? 'QDII：T 日净值 T+1 晚公布，T+2 确认'
    : '场外：T 日晚公布 NAV，T+1 确认';
  const totalProfitLabel = totalReady
    ? `${formatSignedCompactCurrency(agg.unrealizedProfit)} (${formatSignedPercent(agg.unrealizedReturnRate)})`
    : '—';
  const todayProfitLabel = currentReady
    ? `${formatSignedCompactCurrency(agg.hasTodayNav ? agg.todayProfit : 0)} (${formatSignedPercent(agg.hasTodayNav ? agg.todayReturnRate : 0)})`
    : '—';

  return (
    <div className="space-y-0 pb-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-[0.14em] sm:text-[13px] text-slate-400">当前基金</div>
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-lg font-bold leading-none sm:text-xl text-slate-900">{agg.code}</span>
            {tags.filter(Boolean).map((tag) => (
              <Pill key={tag} tone={TAG_PILL_TONES[tag] || KIND_PILL_TONES[tag] || 'slate'}>
                {TAG_LABELS[tag] || KIND_LABELS[tag] || tag}
              </Pill>
            ))}
          </div>
          {agg.name ? <div className="mt-1 truncate text-sm text-slate-600 sm:mt-2 sm:text-[15px]">{agg.name}</div> : null}
        </div>
        {onNavigateToMarkets ? (
          <button
            type="button"
            className="hidden shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 sm:inline-flex"
            onClick={(event) => onNavigateToMarkets(event, agg.code)}
          >
            查看行情
          </button>
        ) : null}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 border-b border-slate-100 pb-4 sm:mt-7 sm:gap-3 sm:pb-5">
        <div className="min-w-0 text-left">
          <div className="text-[11px] font-medium text-slate-400 sm:text-xs">持有金额</div>
          <div className="mt-1 truncate text-[18px] font-bold leading-none sm:mt-2 sm:text-[22px] tabular-nums text-slate-900" title={holdingAmountLabel}>
            {holdingAmountLabel}
          </div>
        </div>
        <div className="min-w-0 text-center">
          <div className="text-xs font-medium text-slate-400">当前涨跌幅</div>
          <div className={cx('mt-2 truncate text-[22px] font-bold leading-none tabular-nums', profitTone(changeValue, !hasChangeValue))} title={currentChangeLabel}>
            {currentChangeLabel}
          </div>
          {isExchangeVenue ? (
            <div className={cx('mt-1 text-[11px] tabular-nums sm:text-xs', profitTone(premiumValue, !hasPremiumValue))} title={premiumLabel}>
              溢价 {premiumLabel}
            </div>
          ) : null}
          <button
            type="button"
            className="mt-2 inline-flex rounded-full p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            onClick={() => setDetailsExpanded((value) => !value)}
            aria-expanded={detailsExpanded}
            aria-label={detailsExpanded ? '收起基金详情' : '展开基金详情'}
          >
            {detailsExpanded ? <ChevronUp className="h-4 w-4 sm:h-5 sm:w-5" /> : <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5" />}
          </button>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-xs font-medium text-slate-400">总涨跌幅</div>
          <div className={cx('mt-2 truncate text-[22px] font-bold leading-none tabular-nums', profitTone(agg.unrealizedProfit, !totalReady))} title={totalChangeLabel}>
            {totalChangeLabel}
          </div>
        </div>
      </div>

      {detailsExpanded ? (
        <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 border-b border-slate-100 py-4 sm:gap-x-5 sm:gap-y-5 sm:py-6">
          <DetailItem label="净份额">
            <div>{formatShares(agg.totalShares)}</div>
            {agg.pendingSellShares > 0 ? (
              <div className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                卖出{formatShares(agg.pendingSellShares)} 份待确认
              </div>
            ) : null}
            {agg.pendingBuyAmount > 0 ? (
              <div className="mt-1 inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                买入{formatCompactCurrency(agg.pendingBuyAmount)}待确认
              </div>
            ) : null}
            {agg.pendingSellShares > 0 || agg.pendingBuyAmount > 0 ? (
              <div className="mt-1 text-[11px] leading-4 text-slate-400">{pendingHint}</div>
            ) : null}
          </DetailItem>
          <DetailItem label="加权均价">{formatNav(agg.avgCost)}</DetailItem>
          <DetailItem label="总成本">{formatCompactCurrency(agg.totalCost)}</DetailItem>
          <DetailItem label="总市值">{hasValue ? formatCompactCurrency(agg.marketValue) : '—'}</DetailItem>
          <DetailItem label="涨跌幅">
            <span className={profitTone(changeValue, !hasChangeValue)}>{currentChangeLabel}</span>
          </DetailItem>
          {isExchangeVenue ? (
            <DetailItem label="溢价率">
              <span className={profitTone(premiumValue, !hasPremiumValue)}>{premiumLabel}</span>
            </DetailItem>
          ) : null}
          <DetailItem label="累计盈亏">
            <span className={profitTone(agg.unrealizedProfit, !totalReady)}>{totalProfitLabel}</span>
          </DetailItem>
          <DetailItem label="今日盈亏">
            <span className={profitTone(agg.hasTodayNav ? agg.todayProfit : 0, !currentReady)}>{todayProfitLabel}</span>
            {agg.hasTodayNav && agg.todayProfitHolidayDays > 0 ? (
              <span className="ml-1 rounded-sm bg-amber-50 px-1 py-0.5 text-[10px] font-semibold text-amber-700">
                跨节{agg.todayProfitSpanDays}日
              </span>
            ) : null}
          </DetailItem>
          <DetailItem label="BUY 总份额">{formatShares(agg.buyShares)}</DetailItem>
          <DetailItem label="SELL 总份额">{formatShares(agg.sellShares)}</DetailItem>
          <DetailItem label="首买日期">{agg.firstBuyDate || '—'}</DetailItem>
          <DetailItem label="最新交易">{agg.lastTxDate || '—'}</DetailItem>
        </dl>
      ) : null}

      {agg.snapshotError ? (
        <div className="mt-3 rounded-xl border border-rose-200 sm:mt-4 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          净值获取失败：{agg.snapshotError}
        </div>
      ) : null}

      <div className="mt-4 flex border-b border-slate-100 pb-4 sm:mt-5 sm:pb-5">
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-2 text-sm font-semibold text-slate-800 transition-colors hover:text-slate-950 sm:text-base"
          onClick={() => onOpenIncomeDetails?.(agg)}
        >
          <BarChart3 className="h-4 w-4 text-slate-600 sm:h-5 sm:w-5" />收益明细
        </button>
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-2 text-base font-semibold text-slate-800 transition-colors hover:text-slate-950"
          onClick={() => onOpenTransactionDetails?.(agg)}
        >
          <List className="h-4 w-4 text-slate-600 sm:h-5 sm:w-5" />交易明细
        </button>
      </div>

      <HoldingReturnCurve aggregate={agg} transactions={transactions} />

      {onOpenAlertDialog ? (
        <button
          type="button"
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold sm:mt-6 sm:h-12 sm:text-base text-slate-700 transition-colors hover:bg-slate-50"
          onClick={() => onOpenAlertDialog(agg)}
        >
          <Bell className="h-4 w-4 text-slate-600 sm:h-5 sm:w-5" />设置预警
        </button>
      ) : null}
      <div className="mt-2 flex items-center gap-3 sm:mt-3">
        <button
          type="button"
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-3 text-sm font-semibold sm:h-12 sm:text-base text-white shadow-sm transition-colors hover:bg-rose-500"
          onClick={() => onBuyOrSell?.(agg, 'BUY')}
        >
          <Plus className="h-4 w-4 sm:h-5 sm:w-5" />买入
        </button>
        <button
          type="button"
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-semibold sm:h-12 sm:text-base text-white shadow-sm transition-colors hover:bg-emerald-500"
          onClick={() => onBuyOrSell?.(agg, 'SELL')}
        >
          <Minus className="h-4 w-4 sm:h-5 sm:w-5" />卖出
        </button>
      </div>
    </div>
  );
}

export default HoldingSummaryPanel;
