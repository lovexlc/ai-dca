import {
  estimateSwitchCost,
  formatCommissionRateAsWan,
  validateFeeConfig,
  validateSwitchThresholdPair
} from '../../app/switchRuleModel.js';
import { cx } from '../experience-ui.jsx';
import { SwitchButton, SwitchPanel } from './ui.jsx';

const FEE_FIELDS = [
  ['sellCommissionRate', '卖出手续费', '%'],
  ['buyCommissionRate', '买入手续费', '%'],
  ['minimumCommission', '最低佣金', '元'],
  ['otherFee', '其他费用', '元']
];

export function SwitchCreateConfigForm({
  stepIndicator,
  fee,
  setFee,
  holdingNotional = 0,
  backtestTimeframe,
  setBacktestTimeframe,
  thresholdMode = 'backtest',
  setThresholdMode,
  manualThresholds,
  setManualThresholds,
  onBack,
  onNext
}) {
  const validation = validateFeeConfig(fee);
  const thresholdValidation = validateSwitchThresholdPair(manualThresholds);
  const updateFee = (field, value) => setFee((current) => ({ ...current, [field]: value }));
  const updateThreshold = (field, value) =>
    setManualThresholds((current) => ({ ...current, [field]: value }));
  const canContinue = validation.valid && (thresholdMode !== 'manual' || thresholdValidation.valid);

  return (
    <SwitchPanel data-switch-motion-item>
      {stepIndicator}
      <h2 className="text-xl font-bold text-slate-900">切换费用与阈值</h2>
      <p className="mt-1 text-sm text-slate-500">手续费会纳入候选匹配和历史分析，也可以直接指定双向切换阈值。</p>
      <div className="mt-5 inline-flex rounded-xl bg-slate-100 p-1 text-sm">
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
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {FEE_FIELDS.map(([field, label, suffix]) => {
            const isRate = field === 'sellCommissionRate' || field === 'buyCommissionRate';
            return (
              <label key={field} className="text-sm font-semibold text-slate-700">
                {label}
                <div className="relative mt-1.5">
                  <input
                    inputMode="decimal"
                    value={fee[field] ?? ''}
                    onChange={(event) => updateFee(field, event.target.value)}
                    className={cx(
                      'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm',
                      isRate ? 'pr-20' : 'pr-12'
                    )}
                  />
                  <span className="pointer-events-none absolute right-3 top-2.5 flex items-center gap-1.5 text-xs text-slate-400">
                    {isRate ? (
                      <span className="font-medium text-slate-500">{formatCommissionRateAsWan(fee[field])}</span>
                    ) : null}
                    <span>{suffix}</span>
                  </span>
                </div>
                {validation.errors[field] ? (
                  <span className="mt-1 block text-xs font-normal text-rose-600">
                    {validation.errors[field]}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      ) : (
        <label className="mt-5 block max-w-sm text-sm font-semibold text-slate-700">
          预计单次切换总费用
          <div className="relative mt-1.5">
            <input
              inputMode="decimal"
              value={fee.estimatedTotalFee ?? ''}
              onChange={(event) => updateFee('estimatedTotalFee', event.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 pr-12 text-sm"
            />
            <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-400">元</span>
          </div>
          {validation.errors.estimatedTotalFee ? (
            <span className="mt-1 block text-xs font-normal text-rose-600">
              {validation.errors.estimatedTotalFee}
            </span>
          ) : null}
        </label>
      )}
      <div className="mt-5 rounded-xl bg-slate-50 p-4">
        <div className="text-xs text-slate-500">预计单次切换成本</div>
        <div className="mt-1 text-2xl font-bold text-slate-900">
          约{' '}
          {formatNumber(
            fee.mode === 'estimated_total' ? fee.estimatedTotalFee : estimateSwitchCost(fee, holdingNotional)
          )}{' '}
          元
        </div>
        <div className="mt-1 text-xs text-slate-400">实际金额会根据切换金额和券商规则变化。</div>
      </div>
      <div className="mt-5 rounded-xl border border-slate-200 p-4">
        <div className="text-sm font-semibold text-slate-700">阈值配置方式</div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          自动推荐会根据历史回测选择阈值；手动配置会保留你的 H→L 与 L→H 设置，候选基金仍由系统匹配。
        </p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="阈值配置方式">
          {[
            ['backtest', '自动推荐'],
            ['manual', '手动配置']
          ].map(([mode, label]) => (
            <button
              type="button"
              key={mode}
              aria-pressed={thresholdMode === mode}
              onClick={() => setThresholdMode(mode)}
              className={cx(
                'rounded-xl border px-4 py-2.5 text-sm font-semibold',
                thresholdMode === mode
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {thresholdMode === 'manual' ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              ['intraBuyOtherPct', 'H→L 切出阈值', 'current H 比 L 贵超过该值时提醒'],
              ['intraSellLowerPct', 'L→H 切回阈值', 'H−L 收窄到该值以内时提醒']
            ].map(([field, label, hint]) => (
              <label key={field} className="text-sm font-semibold text-slate-700">
                {label}
                <div className="relative mt-1.5">
                  <input
                    aria-label={label}
                    inputMode="decimal"
                    value={manualThresholds?.[field] ?? ''}
                    min="-1"
                    max="5"
                    step="0.01"
                    onChange={(event) => updateThreshold(field, event.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 pr-10 text-sm"
                  />
                  <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-400">%</span>
                </div>
                {thresholdValidation.errors[field] ? (
                  <span className="mt-1 block text-xs font-normal text-rose-600">
                    {thresholdValidation.errors[field]}
                  </span>
                ) : (
                  <span className="mt-1 block text-xs font-normal text-slate-400">{hint}</span>
                )}
              </label>
            ))}
            <p className="text-xs leading-5 text-slate-400 sm:col-span-2">
              阈值范围为 -1%–5%，且 H→L 阈值需要大于 L→H 阈值。
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">系统会在下一步根据历史数据选择双向阈值。</p>
        )}
      </div>
      <div className="mt-5">
        <div className="mb-2 text-sm font-semibold text-slate-700">K 线周期</div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {BACKTEST_TIMEFRAME_OPTIONS.map((option) => {
            const selected = backtestTimeframe === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setBacktestTimeframe(option.key)}
                className={cx(
                  'h-10 rounded-xl border px-3 text-sm font-semibold transition',
                  selected
                    ? 'border-[var(--brand-text)] bg-[var(--brand-tint)] text-[var(--brand-text)]'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs leading-5 text-slate-400">
          {BACKTEST_TIMEFRAME_OPTIONS.find((item) => item.key === backtestTimeframe)?.desc || ''}
        </p>
      </div>
      <div className="mt-6 flex justify-between gap-3">
        <SwitchButton variant="secondary" onClick={onBack}>
          上一步
        </SwitchButton>
        <SwitchButton onClick={() => onNext(validation.value)} disabled={!canContinue}>
          {thresholdMode === 'manual' ? '匹配候选并使用手动阈值' : '生成推荐规则'}
          <span aria-hidden="true">→</span>
        </SwitchButton>
      </div>
    </SwitchPanel>
  );
}

const BACKTEST_TIMEFRAME_OPTIONS = Object.freeze([
  { key: '5m', label: '5分钟', desc: '使用全部可用缓存历史' },
  { key: '15m', label: '15分钟', desc: '使用全部可用缓存历史' },
  { key: '30m', label: '30分钟', desc: '使用全部可用缓存历史' },
  { key: '60m', label: '60分钟', desc: '使用全部可用缓存历史' },
  { key: '1d', label: '日线', desc: '使用全部可用缓存历史' }
]);

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
}
