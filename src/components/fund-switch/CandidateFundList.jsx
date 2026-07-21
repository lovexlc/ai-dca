import { useState } from 'react';
import { CheckCircle2, ChevronDown, CircleDashed, Clock3 } from 'lucide-react';
import { cx } from '../experience-ui.jsx';
import { formatSwitchPercent } from './ui.jsx';
import { SwitchLiveNumber } from './SwitchLiveNumber.jsx';

const STATUS = {
  better: { label: '更优选择', className: 'text-emerald-600', Icon: CheckCircle2 },
  reached: { label: '已达到', className: 'text-emerald-600', Icon: CheckCircle2 },
  near: { label: '接近提醒', className: 'text-amber-600', Icon: Clock3 },
  notReached: { label: '未达到', className: 'text-slate-400', Icon: CircleDashed },
  not_reached: { label: '未达到', className: 'text-slate-400', Icon: CircleDashed },
  no_data: { label: '暂无数据', className: 'text-slate-400', Icon: CircleDashed }
};

export function CandidateFundList({
  candidates = [],
  emptyText = '运行一次后显示候选基金和当前切换优势。',
  title = '候选基金（按当前切换优势排序）',
  maxVisible = 4
}) {
  const [showAll, setShowAll] = useState(false);
  if (!candidates.length)
    return <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">{emptyText}</div>;
  const visibleCandidates = showAll ? candidates : candidates.slice(0, maxVisible);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-100">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
        <span className="text-xs font-semibold text-slate-500">{title}</span>
        {candidates.length > maxVisible ? (
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((current) => !current)}
            className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-indigo-600 transition-[background-color,color,transform] duration-200 hover:bg-indigo-50 hover:text-indigo-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
          >
            {showAll ? '收起' : '查看全部'}
            <ChevronDown className={cx('h-3.5 w-3.5 transition-transform duration-200', showAll && 'rotate-180')} />
          </button>
        ) : null}
      </div>
      <div className="hidden grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 border-b border-slate-100 px-4 py-3 text-xs font-semibold text-slate-500 sm:grid">
        <span>基金名称</span>
        <span>当前切换优势</span>
        <span>距离提醒条件</span>
        <span>状态</span>
      </div>
      {visibleCandidates.map((candidate) => {
        const status = STATUS[candidate.status] || STATUS.notReached;
        const StatusIcon = status.Icon;
        const reached = ['better', 'reached'].includes(candidate.status);
        return (
          <div
            key={candidate.code}
            className="group grid gap-2 border-b border-slate-100 px-4 py-3 transition-colors duration-200 hover:bg-slate-50/80 last:border-b-0 sm:grid-cols-[1.4fr_1fr_1fr_1fr] sm:items-center sm:gap-3"
          >
            <div>
              <div className="font-semibold text-slate-700">
                {candidate.code} {candidate.name || ''}
              </div>
              <div className="mt-1 text-xs text-slate-400 sm:hidden">{status.label}</div>
            </div>
            <div className="text-sm font-bold text-slate-900">
              <SwitchLiveNumber value={candidate.advantagePct ?? candidate.currentAdvantagePct}>
                {formatSwitchPercent(candidate.advantagePct ?? candidate.currentAdvantagePct)}
              </SwitchLiveNumber>
            </div>
            <div className="text-sm text-slate-500">
              {reached
                ? '已达到'
                : Number.isFinite(Number(candidate.distancePct))
                  ? `还差 ${formatSwitchPercent(candidate.distancePct)}`
                  : '暂无数据'}
            </div>
            <div className={cx('hidden items-center gap-1 text-sm font-semibold sm:flex', status.className)}>
              <StatusIcon className="h-4 w-4" />
              {status.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
