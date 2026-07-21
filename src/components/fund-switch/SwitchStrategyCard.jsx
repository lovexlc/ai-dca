import { ArrowLeftRight, ChevronDown, FlaskConical, PauseCircle, Play, Settings2, Trash2 } from 'lucide-react';
import { cx } from '../experience-ui.jsx';
import {
  getSwitchConditionText,
  estimateSwitchCost,
  normalizeSwitchRuleModel
} from '../../app/switchRuleModel.js';
import { getRuleViewModel } from '../../pages/switchStrategy/switchStrategyViewModel.js';
import { CandidateFundList } from './CandidateFundList.jsx';
import { SwitchReveal } from './SwitchPageMotion.jsx';
import { SwitchLiveNumber } from './SwitchLiveNumber.jsx';
import { formatSwitchPercent, SwitchButton, SwitchPanel } from './ui.jsx';

const STATUS_LABELS = {
  ready: ['尚未触发', 'bg-slate-100 text-slate-600'],
  near_trigger: ['接近提醒', 'bg-amber-50 text-amber-700'],
  triggered: ['已达到提醒条件', 'bg-emerald-50 text-emerald-700'],
  pending_classification: ['等待分析', 'bg-slate-100 text-slate-500'],
  classification_expired: ['需要重新分析', 'bg-rose-50 text-rose-700'],
  stale: ['使用上次分析结果', 'bg-amber-50 text-amber-700'],
  failed: ['检测失败', 'bg-rose-50 text-rose-700']
};

export function SwitchStrategyCard({
  rule,
  snapshot,
  runtimeView,
  holdingNotional = 0,
  expanded = false,
  onOpen,
  onToggleExpand,
  onTest,
  onEdit,
  onToggle,
  onDelete
}) {
  const model = normalizeSwitchRuleModel(rule);
  const viewModel = getRuleViewModel(model, snapshot, runtimeView);
  const [statusLabel, statusClass] = STATUS_LABELS[viewModel.currentStatus] || STATUS_LABELS.ready;
  const staleState = ['pending_classification', 'classification_expired', 'stale'].includes(
    viewModel.currentStatus
  );
  return (
    <SwitchPanel
      className="cursor-pointer transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm shadow-slate-900/15">
            <ArrowLeftRight className="h-5 w-5" />
          </div>
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-slate-900">
              {model.holdingFundCode} {model.holdingFundName}
            </h3>
            <span
              className={cx(
                'rounded-full px-2 py-1 text-xs font-semibold',
                model.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
              )}
            >
              {model.enabled ? '已启用' : '已停用'}
            </span>
            <span className={cx('rounded-full px-2 py-1 text-xs font-semibold', statusClass)}>
              {statusLabel}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            当前持仓 {Number(model.holdingQuantity || 0).toLocaleString('zh-CN')} 份
          </div>
          </div>
        </div>
        <button
          type="button"
          aria-label={expanded ? '收起方案' : '展开方案'}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand?.();
          }}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
        >
          <ChevronDown className={cx('h-5 w-5 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
        <div className="rounded-xl bg-indigo-50 p-3">
          <div className="text-xs text-slate-400">当前最大切换优势</div>
          <div className="mt-1 text-lg font-bold text-indigo-900">
            <SwitchLiveNumber value={viewModel.bestAdvantagePct}>
              {formatSwitchPercent(viewModel.bestAdvantagePct)}
            </SwitchLiveNumber>
            <span className="ml-1 text-xs font-normal text-slate-400">{viewModel.directionHint}</span>
          </div>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3">
          <div className="text-xs text-slate-400">推荐提醒条件</div>
          <div className="mt-1 text-lg font-bold text-emerald-900">
            <SwitchLiveNumber value={viewModel.thresholdValue}>
              {formatSwitchPercent(viewModel.thresholdValue)}
            </SwitchLiveNumber>
          </div>
          <div className="mt-1 line-clamp-2 text-[11px] text-emerald-700">{getSwitchConditionText(model)}</div>
        </div>
        <div className="rounded-xl bg-amber-50 p-3">
          <div className="text-xs text-slate-400">当前状态</div>
          <div className="mt-1 text-sm font-bold text-amber-900">{statusLabel}</div>
          <div className="mt-1 text-[11px] text-amber-700">
            {viewModel.bestAdvantagePct === null ? '当前优势暂无数据' : viewModel.reached ? '当前优势已达到' : '当前优势未达到'}
          </div>
        </div>
        <div className="rounded-xl bg-sky-50 p-3">
          <div className="text-xs text-slate-400">切换费用（每次预估）</div>
          <div className="mt-1 text-lg font-bold text-sky-900">
            约 {viewModel.estimatedSwitchCost ?? estimateSwitchCost(model.feeConfig, holdingNotional)} 元
          </div>
          <div className="mt-1 text-[11px] text-sky-700">已包含在计算中</div>
        </div>
      </div>
      {expanded ? (
        <SwitchReveal className="mt-5">
          <div onClick={(event) => event.stopPropagation()}>
            <CandidateFundList
              candidates={viewModel.candidates}
              rule={model}
              holdingQuantity={model.holdingQuantity}
              holdingNotional={viewModel.holdingNotional > 0 ? viewModel.holdingNotional : holdingNotional}
              holdingPrice={viewModel.holdingPrice > 0 ? viewModel.holdingPrice : undefined}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <SwitchButton variant="secondary" className="px-3 py-2 text-xs" onClick={onTest}>
                <FlaskConical className="h-3.5 w-3.5" />
                快速测试
              </SwitchButton>
              <SwitchButton variant="quiet" className="px-3 py-2 text-xs" onClick={onEdit}>
                <Settings2 className="h-3.5 w-3.5" />
                编辑规则
              </SwitchButton>
              <SwitchButton variant="quiet" className="px-3 py-2 text-xs" onClick={onToggle}>
                {model.enabled ? <PauseCircle className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {model.enabled ? '停用' : '启用'}
              </SwitchButton>
              <SwitchButton variant="danger" className="px-3 py-2 text-xs" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </SwitchButton>
            </div>
          </div>
        </SwitchReveal>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
          <SwitchButton variant="secondary" className="px-3 py-2 text-xs" onClick={onTest}>
            <FlaskConical className="h-3.5 w-3.5" />
            快速测试
          </SwitchButton>
          <SwitchButton variant="quiet" className="px-3 py-2 text-xs" onClick={onEdit}>
            编辑
          </SwitchButton>
          <SwitchButton variant="quiet" className="px-3 py-2 text-xs" onClick={onToggle}>
            {model.enabled ? '停用' : '启用'}
          </SwitchButton>
          <SwitchButton variant="danger" className="px-3 py-2 text-xs" onClick={onDelete}>
            删除
          </SwitchButton>
        </div>
      )}
      {staleState ? (
        <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {viewModel.currentStatus === 'stale'
            ? '当前使用上次分类结果，建议打开 App 确认数据。'
            : '当前分类数据不足，建议重新分析候选基金。'}
        </div>
      ) : null}
    </SwitchPanel>
  );
}
