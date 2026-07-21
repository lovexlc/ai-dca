import { ArrowRight } from 'lucide-react';
import { cx } from '../experience-ui.jsx';
import { formatSwitchPercent } from './ui.jsx';

const STATUS_META = {
  triggered: ['已达到提醒条件', 'text-emerald-700'],
  nearReminder: ['接近提醒', 'text-amber-700'],
  watching: ['观察中', 'text-slate-500']
};

function distanceText(candidate) {
  if (candidate.status === 'triggered') return '已达到';
  if (candidate.remainingToThreshold === null || candidate.remainingToThreshold === undefined) return '暂无距离数据';
  return `还差 ${formatSwitchPercent(candidate.remainingToThreshold)}`;
}

export function CandidateFundPreview({ candidates = [], onOpen }) {
  const visible = candidates.slice(0, 3);
  return (
    <div className="border-t border-slate-100 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-slate-900">候选基金</h4>
          <p className="mt-1 text-xs text-slate-500">按照当前切换优势排序</p>
        </div>
        <span className="text-xs text-slate-400">{candidates.length} 只</span>
      </div>
      {visible.length ? (
        <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100">
          {visible.map((candidate) => {
            const [statusLabel, statusClass] = STATUS_META[candidate.status] || STATUS_META.watching;
            return (
              <button
                type="button"
                key={candidate.fundCode || candidate.code}
                onClick={onOpen}
                className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">
                    {candidate.fundCode} {candidate.fundName}
                  </span>
                  <span className={cx('mt-1 block text-xs', statusClass)}>{statusLabel} · {distanceText(candidate)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-bold tabular-nums text-slate-900">
                    {formatSwitchPercent(candidate.currentAdvantage)}
                  </span>
                  <ArrowRight className="ml-auto mt-1 h-3.5 w-3.5 text-slate-300" />
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-xs text-slate-500">暂时没有可展示的候选基金。</div>
      )}
      {candidates.length > 3 ? (
        <button
          type="button"
          onClick={onOpen}
          className="mt-3 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
        >
          查看全部候选基金 →
        </button>
      ) : null}
    </div>
  );
}
