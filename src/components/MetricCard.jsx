import { cx } from './experience-ui.jsx';

/**
 * MetricCard - 大号指标卡片
 * 用于展示核心指标（收益率、胜率、夏普比率等）
 */
export function MetricCard({
  label,
  value,
  subtitle,
  tone = 'neutral',
  Icon,
  size = 'default'
}) {
  const toneClasses = {
    positive: 'border-emerald-200 bg-emerald-50',
    negative: 'border-rose-200 bg-rose-50',
    neutral: 'border-slate-200 bg-white',
    info: 'border-indigo-200 bg-indigo-50'
  };

  const valueColorClasses = {
    positive: 'text-emerald-700',
    negative: 'text-rose-700',
    neutral: 'text-slate-900',
    info: 'text-indigo-700'
  };

  const iconColorClasses = {
    positive: 'text-emerald-500',
    negative: 'text-rose-500',
    neutral: 'text-slate-400',
    info: 'text-indigo-500'
  };

  const sizeClasses = size === 'large'
    ? 'p-4 sm:p-6'
    : 'p-3 sm:p-5';

  const valueSizeClasses = size === 'large'
    ? 'text-2xl sm:text-4xl'
    : 'text-xl sm:text-3xl';

  return (
    <div className={cx(
      'rounded-xl sm:rounded-2xl border-2 shadow-sm transition-all hover:shadow-md',
      toneClasses[tone],
      sizeClasses
    )}>
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
            {label}
          </div>
          <div className={cx(
            'mt-2 sm:mt-3 font-bold tracking-tight truncate',
            valueSizeClasses,
            valueColorClasses[tone]
          )}>
            {value}
          </div>
          {subtitle && (
            <div className="mt-1 sm:mt-2 text-xs sm:text-sm text-slate-600 truncate">
              {subtitle}
            </div>
          )}
        </div>
        {Icon && (
          <Icon className={cx('h-5 w-5 sm:h-6 sm:w-6 flex-shrink-0', iconColorClasses[tone])} />
        )}
      </div>
    </div>
  );
}
