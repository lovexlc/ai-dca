import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock3,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  Wallet
} from 'lucide-react';
import { cx } from '../experience-ui.jsx';
import { SwitchLiveNumber } from './SwitchLiveNumber.jsx';
import {
  addYtdRanks,
  calculateCandidateTradeMetrics,
  candidateDecision,
  candidateSuggestion,
  formatShares,
  formatTurnover
} from './candidateFundMetrics.js';

const DECISIONS = {
  switchable: {
    label: '现在可切',
    iconLabel: '可切换',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    accentClass: 'bg-emerald-500',
    icon: CheckCircle2
  },
  near: {
    label: '接近提醒',
    iconLabel: '接近',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    accentClass: 'bg-amber-400',
    icon: Clock3
  },
  wait: {
    label: '暂不建议',
    iconLabel: '观察',
    className: 'border-slate-200 bg-slate-50 text-slate-500',
    accentClass: 'bg-slate-300',
    icon: CircleDashed
  },
  unknown: {
    label: '等待数据',
    iconLabel: '数据不足',
    className: 'border-slate-200 bg-slate-50 text-slate-500',
    accentClass: 'bg-slate-300',
    icon: CircleDashed
  }
};

function formatValue(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '暂无';
}

function formatAdvantage(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : '暂无';
}

function ytdText(candidate) {
  const value = Number(candidate?.ytdReturnPct ?? candidate?.ytdReturn);
  if (!Number.isFinite(value)) return '今年以来 暂无';
  const sign = value > 0 ? '+' : '';
  const rank = Number.isFinite(Number(candidate?.ytdRank)) && Number.isFinite(Number(candidate?.ytdRankTotal))
    ? ` · 排名 ${candidate.ytdRank}/${candidate.ytdRankTotal}`
    : '';
  return `今年以来 ${sign}${value.toFixed(2)}%${rank}`;
}

function StatusBadge({ decision, className = '' }) {
  const meta = DECISIONS[decision] || DECISIONS.unknown;
  const Icon = meta.icon;
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold', meta.className, className)}>
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}

function Metric({ icon: Icon, label, value, className = '' }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-slate-400">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-semibold text-slate-700">{value}</div>
    </div>
  );
}

export function CandidateFundList({
  candidates = [],
  rule = {},
  holdingQuantity = 0,
  holdingNotional = 0,
  holdingPrice = 0,
  emptyText = '运行一次后显示候选基金和当前切换优势。',
  title = '候选基金',
  maxVisible = 4
}) {
  const [showAll, setShowAll] = useState(false);
  const rankedCandidates = useMemo(() => addYtdRanks(candidates), [candidates]);
  if (!candidates.length) {
    return <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">{emptyText}</div>;
  }

  const visibleCandidates = showAll ? rankedCandidates : rankedCandidates.slice(0, maxVisible);
  const counts = rankedCandidates.reduce(
    (summary, candidate) => {
      summary[candidateDecision(candidate)] += 1;
      return summary;
    },
    { switchable: 0, near: 0, wait: 0, unknown: 0 }
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 bg-slate-50/80 px-3.5 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-slate-800">{title}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">按当前切换优势排序，先看绿色和黄色状态</div>
          </div>
          {rankedCandidates.length > maxVisible ? (
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => setShowAll((current) => !current)}
              className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-bold text-indigo-600 transition-[background-color,color,transform] duration-200 hover:bg-indigo-50 hover:text-indigo-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
            >
              {showAll ? '收起' : `查看全部 ${rankedCandidates.length} 只`}
              <ChevronDown className={cx('h-3.5 w-3.5 transition-transform duration-200', showAll && 'rotate-180')} />
            </button>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold">
          <span className="rounded-md bg-emerald-100 px-2 py-1 text-emerald-700">现在可切 {counts.switchable}</span>
          <span className="rounded-md bg-amber-100 px-2 py-1 text-amber-700">接近提醒 {counts.near}</span>
          <span className="rounded-md bg-slate-200 px-2 py-1 text-slate-500">暂不建议 {counts.wait + counts.unknown}</span>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {visibleCandidates.map((candidate, index) => {
          const decision = candidateDecision(candidate);
          const meta = DECISIONS[decision] || DECISIONS.unknown;
          const StatusIcon = meta.icon;
          const advantage = candidate.advantagePct ?? candidate.currentAdvantagePct;
          const distance = Number(candidate.distancePct);
          const ytdValue = Number(candidate.ytdReturnPct ?? candidate.ytdReturn);
          const trade = calculateCandidateTradeMetrics({
            candidate,
            feeConfig: rule.feeConfig,
            holdingQuantity: rule.holdingQuantity ?? holdingQuantity,
            holdingNotional,
            holdingPrice
          });
          const feeText = trade.fee !== null ? `约 ¥${trade.fee.toFixed(2)}` : '暂无';
          const lotsText = trade.sellLots !== null && trade.buyLots !== null
            ? `可卖 ${formatShares(trade.sellLots)} 手 · 可买 ${formatShares(trade.buyLots)} 手`
            : trade.sellLots !== null
              ? `可卖 ${formatShares(trade.sellLots)} 手 · 买入价暂无`
              : '买卖手数待行情补齐';

          return (
            <article
              key={candidate.code || index}
              className="group relative px-3.5 py-3 transition-colors duration-200 hover:bg-slate-50/70 sm:px-4"
            >
              <span className={cx('absolute inset-y-0 left-0 w-1', meta.accentClass)} aria-hidden="true" />
              <div className="grid gap-3 sm:grid-cols-[minmax(190px,1.35fr)_minmax(150px,0.9fr)_auto] sm:items-start">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 font-mono text-[10px] font-bold text-slate-500">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-bold text-slate-800">{candidate.code}</span>
                      <StatusBadge decision={decision} className="sm:hidden" />
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">{candidate.name || '候选基金'}</div>
                  </div>
                </div>

                <div className="flex items-end gap-4 sm:block">
                  <div>
                    <div className="text-[10px] font-semibold text-slate-400">当前切换优势</div>
                    <div className={cx('mt-0.5 text-lg font-bold leading-none', decision === 'switchable' ? 'text-emerald-700' : decision === 'near' ? 'text-amber-700' : 'text-slate-700')}>
                      <SwitchLiveNumber value={advantage}>
                        {formatAdvantage(advantage)}
                      </SwitchLiveNumber>
                    </div>
                  </div>
                  <div className="sm:mt-2">
                    <div className="text-[10px] font-semibold text-slate-400">距离提醒</div>
                    <div className="mt-0.5 text-xs font-semibold text-slate-600">
                      {decision === 'switchable'
                        ? '已达到'
                        : Number.isFinite(distance)
                          ? `还差 ${formatValue(distance)}%`
                          : '暂无'}
                    </div>
                  </div>
                </div>

                <div className="sm:justify-self-end">
                  <StatusBadge decision={decision} className="hidden sm:inline-flex" />
                  <div className="mt-1 hidden items-center justify-end gap-1 text-[10px] text-slate-400 sm:flex">
                    <StatusIcon className="h-3 w-3" />
                    {meta.iconLabel}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
                <Metric icon={Wallet} label="成交额" value={formatTurnover(candidate.turnover)} />
                <Metric icon={ReceiptText} label="预计手续费" value={feeText} />
                <Metric
                  icon={Number.isFinite(ytdValue) ? (ytdValue >= 0 ? TrendingUp : TrendingDown) : null}
                  label="今年以来收益"
                  value={ytdText(candidate)}
                  className="col-span-2 sm:col-span-1"
                />
                <Metric label="买卖手数" value={lotsText} className="col-span-2 sm:col-span-1" />
              </div>

              <div className="mt-3 flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 sm:flex-row sm:items-center sm:justify-between">
                <span className={cx('font-semibold', decision === 'switchable' ? 'text-emerald-700' : decision === 'near' ? 'text-amber-700' : 'text-slate-500')}>
                  {candidateSuggestion(candidate, { distancePct: candidate.distancePct })}
                </span>
                <span className="text-[10px] text-slate-400">
                  {trade.buyShares !== null ? `预计买入 ${formatShares(trade.buyShares)} 份` : '买入数量待价格补齐'}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
