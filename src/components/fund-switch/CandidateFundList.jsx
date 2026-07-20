import { CheckCircle2, CircleDashed, Clock3 } from 'lucide-react';
import { cx } from '../experience-ui.jsx';
import { formatSwitchPercent } from './ui.jsx';

const STATUS = {
  reached: { label: '已达到', className: 'text-emerald-600', Icon: CheckCircle2 },
  near: { label: '接近提醒', className: 'text-amber-600', Icon: Clock3 },
  notReached: { label: '未达到', className: 'text-slate-400', Icon: CircleDashed }
};

export function CandidateFundList({ candidates = [], emptyText = '运行一次后显示候选基金和当前切换优势。' }) {
  if (!candidates.length)
    return <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">{emptyText}</div>;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-100">
      <div className="hidden grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 sm:grid">
        <span>候选基金</span>
        <span>当前切换优势</span>
        <span>距离提醒条件</span>
        <span>状态</span>
      </div>
      {candidates.map((candidate) => {
        const status = STATUS[candidate.status] || STATUS.notReached;
        const StatusIcon = status.Icon;
        const reached = candidate.status === 'reached';
        return (
          <div
            key={candidate.code}
            className="grid gap-2 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:grid-cols-[1.4fr_1fr_1fr_1fr] sm:items-center sm:gap-3"
          >
            <div>
              <div className="font-semibold text-slate-700">
                {candidate.code} {candidate.name || ''}
              </div>
              <div className="mt-1 text-xs text-slate-400 sm:hidden">{status.label}</div>
            </div>
            <div className="text-sm font-bold text-slate-900">
              {formatSwitchPercent(candidate.advantagePct)}
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
