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
  size = 'default',
  threshold,
  source,
}) {
  const toneClasses = {
    positive: 'border-[var(--a-200)] bg-[var(--bg-100)]',
    negative: 'border-[var(--a-200)] bg-[var(--bg-100)]',
    neutral: 'border-[var(--a-200)] bg-[var(--bg-100)]',
    info: 'border-[var(--a-200)] bg-[var(--bg-100)]'
  };

  const valueColorClasses = {
    positive: 'text-[var(--green-text)]',
    negative: 'text-[var(--red-text)]',
    neutral: 'text-[var(--fg-1000)]',
    info: 'text-[var(--blue-text)]'
  };

  const iconColorClasses = {
    positive: 'text-[var(--green-text)]',
    negative: 'text-[var(--red-text)]',
    neutral: 'text-[var(--fg-700)]',
    info: 'text-[var(--blue-text)]'
  };

  const sizeClasses = size === 'large'
    ? 'p-4 sm:p-6'
    : 'p-3 sm:p-5';

  const valueSizeClasses = size === 'large'
    ? 'text-2xl sm:text-4xl'
    : 'text-xl sm:text-3xl';

  return (
    <div className={cx(
      'metric-card rounded-xl border border-[var(--a-200)]',
      `tone-${tone}`,
      toneClasses[tone],
      sizeClasses
    )}>
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
            {label}
          </div>
          <div className={cx(
            'mt-2 sm:mt-3 truncate font-semibold tracking-tight tabular-nums',
            valueSizeClasses,
            valueColorClasses[tone]
          )}>
            {value}
          </div>
          {threshold ? (
            <div className="mt-0.5 text-xs text-slate-400">阈值: {threshold}</div>
          ) : null}
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
      {source ? (
        <div className="mt-2 text-xs">
          <a href={source} target="_blank" rel="noopener noreferrer" className="text-slate-400 underline hover:text-slate-600">数据来源</a>
        </div>
      ) : null}
    </div>
  );
}
