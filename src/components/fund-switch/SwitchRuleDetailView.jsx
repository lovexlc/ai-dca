import { ArrowLeft, FlaskConical, Loader2, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import {
  estimateSwitchCost,
  getSwitchConditionText,
  normalizeSwitchRuleModel
} from '../../app/switchRuleModel.js';
import {
  buildSwitchPlanDisplayModel,
  getAdvantageCopy
} from '../../pages/switchStrategy/switchStrategyViewModel.js';
import { CandidateFundList } from './CandidateFundList.jsx';
import { PlanActionMenu } from './PlanActionMenu.jsx';
import { SwitchProgressBar } from './SwitchProgressBar.jsx';
import { formatSwitchPercent, SwitchButton, SwitchPanel } from './ui.jsx';

const STATUS_TEXT = {
  noHolding: '待绑定持仓',
  watching: '观察中',
  nearReminder: '接近提醒',
  triggered: '已触发',
  disabled: '已停用',
  error: '运行异常',
  pending_classification: '等待分析',
  classification_expired: '需要重新分析',
  stale: '使用上次分析结果',
  failed: '运行异常'
};

const STATUS_CLASS = {
  noHolding: 'bg-slate-100 text-slate-500',
  watching: 'bg-slate-100 text-slate-600',
  nearReminder: 'bg-amber-50 text-amber-700',
  triggered: 'bg-emerald-50 text-emerald-700',
  disabled: 'bg-slate-100 text-slate-500',
  error: 'bg-rose-50 text-rose-700',
  pending_classification: 'bg-slate-100 text-slate-500',
  classification_expired: 'bg-rose-50 text-rose-700',
  stale: 'bg-amber-50 text-amber-700',
  failed: 'bg-rose-50 text-rose-700'
};

export function SwitchRuleDetailView({
  rule,
  snapshot,
  runtimeView,
  holdingNotional = 0,
  holdingQuantity,
  onBack,
  onTest,
  onAddHolding,
  onEdit,
  onToggle,
  onDelete,
  onReanalyse,
  running = false,
  onSwitchCandidate,
  switching = false
}) {
  const model = normalizeSwitchRuleModel(rule);
  const marketWatch = model.ruleType === 'market_watch';
  const displayModel = buildSwitchPlanDisplayModel(rule, snapshot, runtimeView, holdingNotional, holdingQuantity);
  const viewModel = displayModel.viewModel;
  const advantageCopy = getAdvantageCopy(viewModel);
  const noHolding = displayModel.displayStatus === 'noHolding';
  const statusKey = noHolding ? 'noHolding' : displayModel.runtimeStatus === 'ready' ? displayModel.displayStatus : displayModel.runtimeStatus;
  const needsReanalysis = noHolding || ['pending_classification', 'classification_expired'].includes(
    model.runtimeConfig?.classificationStatus
  );
  const fee = displayModel.estimatedSwitchFee ?? estimateSwitchCost(model.feeConfig, holdingNotional);

  return (
    <SwitchPanel data-switch-motion-item>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            我的方案
          </button>
          <h2 className="text-xl font-bold text-slate-900">
            {model.holdingFundCode} {model.holdingFundName}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {marketWatch ? '全市场观察提醒' : noHolding ? '未检测到持仓' : `当前持仓 ${Number(displayModel.holdingQuantity || 0).toLocaleString('zh-CN')} 份`}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${STATUS_CLASS[statusKey] || STATUS_CLASS.watching}`}>
          {noHolding ? '待绑定持仓' : model.enabled ? '已启用' : '已停用'}
        </span>
      </div>
      {running ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在获取最新行情并完成首次分析…
        </div>
      ) : null}
      {noHolding ? (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-base font-bold text-slate-800">等待持仓后恢复分析</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">添加这只基金的持仓后，系统会自动恢复候选基金分析。</p>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-4 rounded-xl border border-slate-100 p-4 sm:grid-cols-[minmax(200px,1.2fr)_repeat(3,minmax(120px,1fr))] sm:items-center">
            <SwitchProgressBar progressPercent={displayModel.progressPercent} status={displayModel.displayStatus} loading={running} />
            <div>
              <div className="text-xs text-slate-500">当前最大切换优势</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{formatSwitchPercent(displayModel.currentAdvantage)}</div>
              <div className="mt-1 text-xs text-slate-500">{advantageCopy.hint}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">推荐提醒值</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{formatSwitchPercent(displayModel.reminderThreshold)}</div>
              <div className="mt-1 text-xs text-slate-500">{advantageCopy.progress}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">当前状态</div>
              <div className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[statusKey] || STATUS_CLASS.watching}`}>
                {STATUS_TEXT[statusKey] || '观察中'}
              </div>
            </div>
          </div>
          <div className="mt-6">
            <h3 className="font-bold text-slate-900">候选基金</h3>
            <div className="mt-3">
              <CandidateFundList
                candidates={viewModel.candidates}
                rule={model}
                holdingQuantity={displayModel.holdingQuantity}
                holdingNotional={viewModel.holdingNotional > 0 ? viewModel.holdingNotional : holdingNotional}
                holdingPrice={viewModel.holdingPrice > 0 ? viewModel.holdingPrice : undefined}
                onSwitchCandidate={onSwitchCandidate}
                switching={switching}
              />
            </div>
          </div>
        </>
      )}
      <div className="mt-6 grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm sm:grid-cols-2">
        <div>
          <span className="text-xs text-slate-400">提醒方式</span>
          <div className="mt-1 font-semibold text-slate-700">{model.thresholdMode === 'fixed' ? '自定义' : '推荐值'}</div>
        </div>
        <div>
          <span className="text-xs text-slate-400">提醒条件</span>
          <div className="mt-1 font-semibold text-slate-700">{noHolding ? '绑定持仓后恢复' : getSwitchConditionText(model)}</div>
        </div>
        <div>
          <span className="text-xs text-slate-400">切换费用</span>
          <div className="mt-1 font-semibold text-slate-700">{marketWatch ? '无需绑定持仓' : noHolding ? '绑定持仓后计算' : `约 ${Number(fee).toFixed(2)} 元`}</div>
        </div>
        <div>
          <span className="text-xs text-slate-400">数据比较</span>
          <div className="mt-1 font-semibold text-slate-700">实时行情</div>
        </div>
      </div>
      {model.recommendationStatus === 'fee_changed' ? (
        <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">费用已变更，当前推荐条件可能不再准确，请重新生成推荐。</div>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <SwitchButton onClick={noHolding ? onAddHolding : onTest}>
          {noHolding ? <Plus className="h-4 w-4" /> : <FlaskConical className="h-4 w-4" />}
          {noHolding ? '一键增加持仓' : '快速测试'}
        </SwitchButton>
        {noHolding ? (
          <PlanActionMenu
            enabled={model.enabled}
            noHolding
            onTest={onTest}
            showManagement={false}
          />
        ) : null}
        <SwitchButton variant="secondary" onClick={onEdit}>
          <Settings2 className="h-4 w-4" />
          {noHolding ? '重新选择持仓' : '编辑规则'}
        </SwitchButton>
        <SwitchButton variant="quiet" onClick={onToggle}>
          {model.enabled ? '暂停规则' : '恢复规则'}
        </SwitchButton>
        {needsReanalysis && !noHolding ? (
          <SwitchButton variant="secondary" onClick={onReanalyse}>
            <RefreshCw className="h-4 w-4" />
            重新分析候选基金
          </SwitchButton>
        ) : null}
        <SwitchButton variant="danger" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          删除规则
        </SwitchButton>
      </div>
    </SwitchPanel>
  );
}
