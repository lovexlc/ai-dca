import { CheckCircle2, CircleDashed, X } from 'lucide-react';
import { candidateDecision } from './candidateFundMetrics.js';
import { cx } from '../experience-ui.jsx';
import { formatSwitchPercent, SwitchButton } from './ui.jsx';

const STATUS_META = {
  switchable: ['现在可切', 'border-emerald-200 bg-emerald-50 text-emerald-700', CheckCircle2],
  near: ['接近提醒', 'border-amber-200 bg-amber-50 text-amber-700', CircleDashed],
  wait: ['暂不建议', 'border-slate-200 bg-slate-50 text-slate-500', CircleDashed],
  unknown: ['等待数据', 'border-slate-200 bg-slate-50 text-slate-500', CircleDashed]
};

function candidateCode(candidate = {}) {
  return candidate.fundCode || candidate.code || '';
}

function candidateName(candidate = {}) {
  return candidate.fundName || candidate.name || '候选基金';
}

export function SwitchCandidatePickerModal({
  rule = {},
  candidates = [],
  onClose,
  onSelect,
  switching = false
}) {
  const rankedCandidates = Array.isArray(candidates) ? candidates : [];
  const switchableCandidates = rankedCandidates.filter((candidate) => candidateDecision(candidate) === 'switchable');

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/35 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="switch-candidate-picker-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !switching) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="switch-candidate-picker-title" className="text-lg font-bold text-slate-900">选择切换对手方</h2>
            <p className="mt-1 text-sm leading-5 text-slate-500">
              当前方案：{rule.holdingFundCode} {rule.holdingFundName || ''}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭对手方选择框"
            onClick={onClose}
            disabled={switching}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 rounded-xl bg-indigo-50 px-3 py-2.5 text-xs leading-5 text-indigo-800">
          请选择要绑定为新持仓的基金。确认后会更新方案并自动分析，不会自动下单或修改交易记录。
        </div>

        <div className="mt-4 max-h-[min(55vh,420px)] space-y-2 overflow-y-auto">
          {rankedCandidates.map((candidate) => {
            const decision = candidateDecision(candidate);
            const [statusLabel, statusClass, StatusIcon] = STATUS_META[decision] || STATUS_META.unknown;
            const code = candidateCode(candidate);
            const advantage = candidate.advantagePct ?? candidate.currentAdvantagePct;
            const disabled = decision !== 'switchable' || switching;
            return (
              <button
                type="button"
                key={code || candidate.name}
                disabled={disabled}
                onClick={() => onSelect(candidate)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                  disabled
                    ? 'cursor-not-allowed border-slate-100 bg-slate-50/70 opacity-65'
                    : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-slate-800">{code} {candidateName(candidate)}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    当前切换优势：{formatSwitchPercent(advantage)}
                  </div>
                </div>
                <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold', statusClass)}>
                  <StatusIcon className="h-3.5 w-3.5" />
                  {statusLabel}
                </span>
              </button>
            );
          })}
          {!rankedCandidates.length ? (
            <div className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">暂无候选对比方数据。</div>
          ) : null}
        </div>

        {!switchableCandidates.length && rankedCandidates.length ? (
          <div className="mt-3 text-xs text-slate-500">当前没有达到提醒条件的对手方，暂不能执行方案切换。</div>
        ) : null}

        <div className="mt-5 flex justify-end">
          <SwitchButton variant="secondary" onClick={onClose} disabled={switching}>取消</SwitchButton>
        </div>
      </div>
    </div>
  );
}
