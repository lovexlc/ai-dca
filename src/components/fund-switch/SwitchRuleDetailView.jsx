import { ArrowLeft, FlaskConical, Loader2, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import {
  estimateSwitchCost,
  getSwitchConditionText,
  normalizeSwitchRuleModel
} from '../../app/switchRuleModel.js';
import { getRuleViewModel } from '../../pages/switchStrategy/switchStrategyViewModel.js';
import { CandidateFundList } from './CandidateFundList.jsx';
import { formatSwitchPercent, SwitchButton, SwitchPanel } from './ui.jsx';

const STATUS_TEXT = {
  ready: '尚未触发',
  near_trigger: '接近提醒',
  triggered: '已达到提醒条件',
  pending_classification: '等待分析',
  classification_expired: '需要重新分析',
  stale: '使用上次分析结果',
  failed: '检测失败'
};

export function SwitchRuleDetailView({
  rule,
  snapshot,
  runtimeView,
  holdingNotional = 0,
  onBack,
  onTest,
  onEdit,
  onToggle,
  onDelete,
  onReanalyse,
  running = false
}) {
  const model = normalizeSwitchRuleModel(rule);
  const viewModel = getRuleViewModel(model, snapshot, runtimeView);
  const needsReanalysis = ['pending_classification', 'classification_expired'].includes(
    model.runtimeConfig?.classificationStatus
  );
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
            当前持仓 {Number(model.holdingQuantity || 0).toLocaleString('zh-CN')} 份
          </p>
        </div>
        <span
          className={
            model.enabled
              ? 'rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700'
              : 'rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500'
          }
        >
          {model.enabled ? '已启用' : '已停用'}
        </span>
      </div>
      {running ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在获取最新行情并完成首次分析…
        </div>
      ) : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-900 p-4 text-white">
          <div className="text-xs text-slate-300">当前最大切换优势</div>
          <div className="mt-2 text-2xl font-bold">{formatSwitchPercent(viewModel.bestAdvantagePct)}</div>
          <div className="mt-1 text-xs text-slate-400">{viewModel.directionHint}</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-xs text-slate-500">推荐提醒值</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">
            {formatSwitchPercent(model.thresholdValue)}
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-xs text-slate-500">当前状态</div>
          <div className="mt-2 text-lg font-bold text-slate-900">
            {STATUS_TEXT[viewModel.currentStatus] || '尚未触发'}
          </div>
        </div>
      </div>
      <div className="mt-6">
        <h3 className="font-bold text-slate-900">候选基金</h3>
        <div className="mt-3">
          <CandidateFundList candidates={viewModel.candidates} />
        </div>
      </div>
      <div className="mt-6 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
        <div>
          <span className="text-xs text-slate-400">提醒方式</span>
          <div className="mt-1 font-semibold text-slate-700">
            {model.thresholdMode === 'fixed' ? '自定义' : '推荐值'}
          </div>
        </div>
        <div>
          <span className="text-xs text-slate-400">提醒条件</span>
          <div className="mt-1 font-semibold text-slate-700">{getSwitchConditionText(model)}</div>
        </div>
        <div>
          <span className="text-xs text-slate-400">切换费用</span>
          <div className="mt-1 font-semibold text-slate-700">
            约 {viewModel.estimatedSwitchCost ?? estimateSwitchCost(model.feeConfig, holdingNotional)} 元
          </div>
        </div>
        <div>
          <span className="text-xs text-slate-400">数据比较</span>
          <div className="mt-1 font-semibold text-slate-700">实时行情</div>
        </div>
      </div>
      {model.recommendationStatus === 'fee_changed' ? (
        <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          费用已变更，当前推荐条件可能不再准确，请重新生成推荐。
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <SwitchButton onClick={onTest}>
          <FlaskConical className="h-4 w-4" />
          快速测试
        </SwitchButton>
        <SwitchButton variant="secondary" onClick={onEdit}>
          <Settings2 className="h-4 w-4" />
          编辑规则
        </SwitchButton>
        <SwitchButton variant="danger" onClick={onToggle}>
          {model.enabled ? '停用规则' : '启用规则'}
        </SwitchButton>
        {needsReanalysis ? (
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
