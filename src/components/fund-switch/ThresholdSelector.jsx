import { validateThresholdValue, SWITCH_THRESHOLD_RANGES } from '../../app/switchRuleModel.js';
import { cx } from '../experience-ui.jsx';

export function ThresholdSelector({
  operator = 'gte',
  mode = 'backtest',
  value,
  recommendedValue,
  onModeChange,
  onValueChange
}) {
  const range = SWITCH_THRESHOLD_RANGES[operator] || SWITCH_THRESHOLD_RANGES.gte;
  const validation = mode === 'fixed' ? validateThresholdValue(value, operator) : { valid: true, errors: {} };
  const quickValues = operator === 'lte' ? [0.1, 0.25, 0.5, 1, 1.5, 2] : [0.5, 1, 2, 2.65, 3, 4, 5];
  if (operator === 'lte') {
    return (
      <div>
        <div className="text-sm font-semibold text-slate-700">提醒方式</div>
        <div className="mt-3 rounded-xl bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-900">系统条件：H-L 小于 1% 时提醒</div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            当前持仓处于较低溢价一侧时，系统会在价差收窄到 1% 以内时提醒切换。
          </p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-sm font-semibold text-slate-700">提醒方式</div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onModeChange('backtest')}
          className={cx(
            'rounded-xl border px-4 py-2.5 text-sm font-semibold',
            mode === 'backtest'
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 text-slate-600'
          )}
        >
          推荐值
        </button>
        <button
          type="button"
          onClick={() => onModeChange('fixed')}
          className={cx(
            'rounded-xl border px-4 py-2.5 text-sm font-semibold',
            mode === 'fixed' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'
          )}
        >
          自定义
        </button>
      </div>
      {mode === 'backtest' ? (
        <p className="mt-3 text-sm text-slate-500">
          当前使用回测推荐值{' '}
          {Number.isFinite(Number(recommendedValue)) ? `${Number(recommendedValue).toFixed(2)}%` : '—'}。
        </p>
      ) : (
        <div className="mt-3">
          <div className="flex max-w-sm items-center gap-2">
            <input
              aria-label="提醒值"
              inputMode="decimal"
              value={value ?? ''}
              min={range.min}
              max={range.max}
              step="0.01"
              onChange={(event) => onValueChange(event.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500"
            />
            <span className="shrink-0 text-sm text-slate-500">% 时提醒</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {quickValues.map((quick) => (
              <button
                type="button"
                key={quick}
                onClick={() => onValueChange(String(quick))}
                className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"
              >
                {quick}%
              </button>
            ))}
          </div>
          {validation.errors.thresholdValue ? (
            <p className="mt-2 text-xs text-rose-600">{validation.errors.thresholdValue}</p>
          ) : (
            <p className="mt-2 text-xs leading-5 text-slate-400">
              数值越小，提醒越频繁；数值越大，机会要求越严格。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
