import { ArrowLeft, TrendingUp } from 'lucide-react';
import {
  DEFAULT_SWITCH_HIGH_CODES,
  estimateSwitchCost,
  normalizeFeeConfig,
  validateFeeConfig,
  validateThresholdValue
} from '../../app/switchRuleModel.js';
import { SWITCH_STRATEGY_ETFS } from '../../app/nasdaqCatalog.js';
import { cx } from '../experience-ui.jsx';
import { SwitchButton, SwitchPanel } from './ui.jsx';
import { ThresholdSelector } from './ThresholdSelector.jsx';

const FEE_FIELDS = [
  ['sellCommissionRate', '卖出手续费', '%'],
  ['buyCommissionRate', '买入手续费', '%'],
  ['minimumCommission', '最低佣金', '元'],
  ['otherFee', '其他费用', '元']
];

export function StrategyEditor({
  rule,
  fee,
  setFee,
  thresholdMode,
  setThresholdMode,
  threshold,
  setThreshold,
  holdingNotional = 0,
  highCodes = DEFAULT_SWITCH_HIGH_CODES,
  setHighCodes,
  onBack,
  onSave,
  onBacktest
}) {
  const operator = rule?.triggerOperator || rule?.runtimeConfig?.triggerOperatorAtRecommendation || 'gte';
  const feeValidation = validateFeeConfig(fee);
  const thresholdValidation =
    thresholdMode === 'fixed' ? validateThresholdValue(threshold, operator) : { valid: true };
  const updateFee = (field, value) => setFee((current) => ({ ...current, [field]: value }));
  const selectedHighCodes = Array.isArray(highCodes) && highCodes.length ? highCodes : [...DEFAULT_SWITCH_HIGH_CODES];
  const toggleHighCode = (code) => {
    if (!setHighCodes) return;
    setHighCodes((current) => {
      const selected = Array.isArray(current) && current.length ? current : [...DEFAULT_SWITCH_HIGH_CODES];
      if (selected.includes(code)) return selected.length > 1 ? selected.filter((item) => item !== code) : selected;
      return [...selected, code];
    });
  };
  const save = () =>
    onSave({
      thresholdMode,
      thresholdValue:
        thresholdMode === 'fixed'
          ? Number(threshold)
          : Number(rule.backtestRecommendedValue || rule.thresholdValue),
      feeConfig: normalizeFeeConfig(fee),
      highPremiumCodes: selectedHighCodes,
      premiumClassSource: 'user'
    });
  return (
    <SwitchPanel data-switch-motion-item>
      <div className="flex items-center gap-3">
        <SwitchButton variant="quiet" className="px-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </SwitchButton>
        <div>
          <h2 className="text-xl font-bold text-slate-900">编辑规则</h2>
          <p className="mt-1 text-sm text-slate-500">保留当前持仓和候选基金，只调整提醒条件与费用。</p>
        </div>
      </div>
      <div className="mt-6">
        <ThresholdSelector
          operator={operator}
          mode={thresholdMode}
          value={threshold}
          recommendedValue={rule.backtestRecommendedValue || rule.thresholdValue}
          onModeChange={setThresholdMode}
          onValueChange={setThreshold}
        />
      </div>
      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-sm font-semibold text-slate-700">基金特征分类（高级设置）</div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          系统已按长期溢价特征预设分类。修改后需要重新生成推荐规则。
        </p>
        <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
          {SWITCH_STRATEGY_ETFS.map((fund) => {
            const checked = selectedHighCodes.includes(fund.code);
            return (
              <label
                key={fund.code}
                className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleHighCode(fund.code)}
                  className="h-4 w-4 accent-slate-900"
                />
                <span className="truncate">
                  {fund.code} {fund.name}
                </span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="mt-6 border-t border-slate-100 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-700">切换费用</div>
            <div className="mt-1 text-xs text-slate-400">费用会重新影响推荐提醒值和历史回测。</div>
          </div>
          <div className="text-sm font-bold text-slate-900">约 {estimateSwitchCost(fee, holdingNotional)} 元</div>
        </div>
        <div className="mt-3 inline-flex rounded-xl bg-slate-100 p-1 text-sm">
          {[
            ['detailed', '按明细计算'],
            ['estimated_total', '直接填写预计总费用']
          ].map(([mode, label]) => (
            <button
              type="button"
              key={mode}
              onClick={() => updateFee('mode', mode)}
              className={cx(
                'rounded-lg px-3 py-2 font-semibold',
                fee.mode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {fee.mode === 'detailed' ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {FEE_FIELDS.map(([field, label, suffix]) => (
              <label key={field} className="text-sm text-slate-600">
                {label}
                <div className="relative mt-1">
                  <input
                    inputMode="decimal"
                    value={fee[field] ?? ''}
                    onChange={(event) => updateFee(field, event.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 pr-10 text-sm"
                  />
                  <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-400">
                    {suffix}
                  </span>
                </div>
                {feeValidation.errors[field] ? (
                  <span className="mt-1 block text-xs text-rose-600">{feeValidation.errors[field]}</span>
                ) : null}
              </label>
            ))}
          </div>
        ) : (
          <label className="mt-4 block max-w-sm text-sm text-slate-600">
            预计单次切换总费用
            <div className="relative mt-1">
              <input
                inputMode="decimal"
                value={fee.estimatedTotalFee ?? ''}
                onChange={(event) => updateFee('estimatedTotalFee', event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 pr-10 text-sm"
              />
              <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-400">元</span>
            </div>
            {feeValidation.errors.estimatedTotalFee ? (
              <span className="mt-1 block text-xs text-rose-600">
                {feeValidation.errors.estimatedTotalFee}
              </span>
            ) : null}
          </label>
        )}
      </div>
      {rule.recommendationStatus === 'fee_changed' || rule.recommendationStatus === 'expired' ? (
        <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          费用或历史分析已变化，当前推荐值仅作参考。保存后请重新生成推荐。
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-between gap-2">
        <SwitchButton variant="secondary" onClick={onBack}>
          取消
        </SwitchButton>
        <div className="flex flex-wrap gap-2">
          {onBacktest ? (
            <SwitchButton variant="secondary" onClick={onBacktest}>
              <TrendingUp className="h-4 w-4" />
              回测当前策略
            </SwitchButton>
          ) : null}
          <SwitchButton onClick={save} disabled={!feeValidation.valid || !thresholdValidation.valid}>
            保存规则
          </SwitchButton>
        </div>
      </div>
    </SwitchPanel>
  );
}
