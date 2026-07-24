import { ArrowLeftRight, ChevronDown, FlaskConical, PauseCircle, Play, Settings2, TrendingUp } from 'lucide-react';
import { cx } from '../experience-ui.jsx';
import { getAdvantageCopy, buildSwitchPlanDisplayModel } from '../../pages/switchStrategy/switchStrategyViewModel.js';
import { CandidateFundPreview } from './CandidateFundPreview.jsx';
import { PlanActionMenu } from './PlanActionMenu.jsx';
import { SwitchReveal } from './SwitchPageMotion.jsx';
import { SwitchLiveNumber } from './SwitchLiveNumber.jsx';
import { formatSwitchPercent, SwitchButton, SwitchPanel } from './ui.jsx';
import { SwitchProgressBar } from './SwitchProgressBar.jsx';

const RUNTIME_STATUS_META = {
  pending_classification: ['等待分析', 'bg-slate-100 text-slate-500'],
  classification_expired: ['需要重新分析', 'bg-rose-50 text-rose-700'],
  stale: ['使用上次分析结果', 'bg-amber-50 text-amber-700'],
  failed: ['运行异常', 'bg-rose-50 text-rose-700']
};

const DISPLAY_STATUS_META = {
  watching: ['观察中', 'bg-slate-100 text-slate-600'],
  nearReminder: ['接近提醒', 'bg-amber-50 text-amber-700'],
  triggered: ['已触发', 'bg-emerald-50 text-emerald-700'],
  disabled: ['已停用', 'bg-slate-100 text-slate-500'],
  error: ['运行异常', 'bg-rose-50 text-rose-700'],
  noHolding: ['待绑定持仓', 'bg-slate-100 text-slate-500']
};

function formatHoldingQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity.toLocaleString('zh-CN') : '0';
}

function getStatusMeta(displayModel) {
  return RUNTIME_STATUS_META[displayModel.runtimeStatus] || DISPLAY_STATUS_META[displayModel.displayStatus] || DISPLAY_STATUS_META.watching;
}

export function SwitchStrategyCard({
  rule,
  snapshot,
  runtimeView,
  holdingNotional = 0,
  holdingQuantity,
  expanded = false,
  onOpen,
  onToggleExpand,
  onTest,
  onEdit,
  onToggle,
  onDelete,
  onSwitchCandidate,
  switching = false
}) {
  const displayModel = buildSwitchPlanDisplayModel(rule, snapshot, runtimeView, holdingNotional, holdingQuantity);
  const { model, viewModel } = displayModel;
  const marketWatch = model.ruleType === 'market_watch';
  const advantageCopy = getAdvantageCopy(viewModel);
  const [statusLabel, statusClass] = getStatusMeta(displayModel);
  const noHolding = displayModel.displayStatus === 'noHolding';
  const classificationBlocked = ['pending_classification', 'classification_expired'].includes(displayModel.runtimeStatus);
  const switchableCandidate = displayModel.candidates.find((candidate) =>
    ['better', 'reached', 'triggered'].includes(String(candidate?.status || '').toLowerCase())
  );

  return (
    <SwitchPanel
      className="cursor-pointer overflow-visible transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
      onClick={onOpen}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(250px,320px)_minmax(180px,1fr)_150px_150px_190px] sm:items-center sm:gap-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 max-w-full truncate text-sm font-bold text-slate-900 sm:text-base">
                {displayModel.fundCode} {displayModel.fundName || displayModel.ruleName}
              </h3>
              <span className={cx('rounded-full px-2 py-1 text-xs font-semibold', statusClass)}>{statusLabel}</span>
            </div>
            <div className={cx('mt-1 text-xs', noHolding ? 'font-semibold text-slate-500' : 'text-slate-500')}>
              {marketWatch ? '全市场观察提醒' : noHolding ? '未检测到持仓' : `当前持仓 ${formatHoldingQuantity(displayModel.holdingQuantity)} 份`}
            </div>
            {!noHolding && model.enabled ? <div className="mt-1 text-xs text-emerald-600">规则已启用</div> : null}
          </div>
        </div>

        <SwitchProgressBar
          progressPercent={displayModel.progressPercent}
          status={displayModel.displayStatus}
          loading={classificationBlocked}
        />

        <div className="min-w-0 text-sm sm:border-l sm:border-slate-100 sm:pl-5">
          <div className="text-xs text-slate-400">提醒条件</div>
          <div className="mt-1 font-semibold tabular-nums text-slate-900">
            {formatSwitchPercent(displayModel.reminderThreshold)}
          </div>
          <div className="mt-1 line-clamp-2 text-xs leading-4 text-slate-500">
            {noHolding ? '绑定持仓后开始分析' : advantageCopy.progress}
          </div>
        </div>

        <div className="min-w-0 text-sm sm:border-l sm:border-slate-100 sm:pl-5">
          <div className="text-xs text-slate-400">当前最大优势</div>
          <div className="mt-1 font-semibold tabular-nums text-slate-900">
            <SwitchLiveNumber value={displayModel.currentAdvantage}>
              {formatSwitchPercent(displayModel.currentAdvantage)}
            </SwitchLiveNumber>
          </div>
          <div className="mt-1 line-clamp-1 text-xs text-slate-500">{noHolding ? '绑定持仓后计算费用' : advantageCopy.hint}</div>
          <div className="mt-1 line-clamp-1 text-xs text-slate-500">
            {marketWatch ? '无需绑定持仓' : noHolding ? '' : `预计费用 ¥${Number(displayModel.estimatedSwitchFee || 0).toFixed(2)}`}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end" onClick={(event) => event.stopPropagation()}>
          <SwitchButton
            variant="secondary"
            className="min-h-10 px-3 text-xs text-indigo-700"
            onClick={onTest}
          >
            <FlaskConical className="h-3.5 w-3.5" />
            快速测试
          </SwitchButton>
          <PlanActionMenu
            enabled={model.enabled}
            noHolding={noHolding}
            onEdit={onEdit}
            onToggle={onToggle}
            onDelete={onDelete}
          />
          <button
            type="button"
            aria-label={expanded ? '收起方案' : '展开方案'}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand?.();
            }}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <ChevronDown className={cx('h-5 w-5 transition-transform duration-200', expanded && 'rotate-180')} />
          </button>
        </div>
      </div>

      {expanded ? (
        <SwitchReveal className="mt-5">
          <div onClick={(event) => event.stopPropagation()}>
            {noHolding ? (
              <div className="border-t border-slate-100 pt-4">
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <div className="text-sm font-semibold text-slate-700">规则已暂停分析</div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">重新选择一只当前持仓，系统会继续分析切换机会。</p>
                </div>
              </div>
            ) : (
              <CandidateFundPreview candidates={displayModel.candidates} onOpen={onOpen} />
            )}
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <SwitchButton variant="secondary" className="min-h-9 px-3 text-xs text-indigo-700" onClick={onTest}>
                <FlaskConical className="h-3.5 w-3.5" />
                快速测试
              </SwitchButton>
              {switchableCandidate && onSwitchCandidate ? (
                <SwitchButton
                  variant="secondary"
                  className="min-h-9 border-emerald-200 px-3 text-xs text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50"
                  onClick={() => onSwitchCandidate(displayModel.candidates)}
                  disabled={switching}
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  {switching ? '正在切换…' : '一键切换'}
                </SwitchButton>
              ) : null}
              <SwitchButton variant="secondary" className="min-h-9 px-3 text-xs" onClick={onEdit}>
                <Settings2 className="h-3.5 w-3.5" />
                {noHolding ? '重新选择持仓' : '编辑规则'}
              </SwitchButton>
              <SwitchButton variant="quiet" className="min-h-9 px-3 text-xs" onClick={onToggle}>
                {model.enabled ? <PauseCircle className="h-3.5 w-3.5 text-amber-600" /> : <Play className="h-3.5 w-3.5 text-emerald-600" />}
                {model.enabled ? '暂停规则' : '恢复规则'}
              </SwitchButton>
            </div>
          </div>
        </SwitchReveal>
      ) : null}

      {displayModel.runtimeStatus === 'stale' ? (
        <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          当前使用上次分析结果，建议打开 App 确认数据。
        </div>
      ) : null}
      {classificationBlocked ? (
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {displayModel.runtimeStatus === 'classification_expired' ? '分类数据已过期，请重新分析候选基金。' : '正在等待分类数据，暂不生成正式提醒。'}
        </div>
      ) : null}
    </SwitchPanel>
  );
}
