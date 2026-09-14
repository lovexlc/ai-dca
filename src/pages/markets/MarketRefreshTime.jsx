import { Clock3 } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { formatMarketRefreshClockTime, formatMarketRefreshTime } from './marketRefreshTime.js';

export function MarketRefreshTime({ timestamp = '', loading = false, className = '', compact = false }) {
  const formatted = formatMarketRefreshTime(timestamp);
  if (compact) {
    const clockTime = formatMarketRefreshClockTime(timestamp);
    if (!clockTime) return null;
    return (
      <time
        data-testid="market-refresh-time"
        dateTime={String(timestamp || '').trim()}
        title={`行情数据刷新于 ${formatted || clockTime}`}
        aria-label={`行情数据刷新于 ${formatted || clockTime}`}
        className={cx('inline-flex min-w-0 shrink-0 text-[11px] leading-4 tabular-nums text-[var(--market-text-subtle)]', className)}
      >
        {clockTime}
      </time>
    );
  }
  const label = formatted ? `刷新于 ${formatted}` : (loading ? '刷新中…' : '暂无刷新记录');
  return (
    <span
      data-testid="market-refresh-time"
      title={formatted ? `行情数据刷新于 ${formatted}` : label}
      aria-label={`行情${label}`}
      className={cx('inline-flex min-w-0 items-center gap-1 text-[11px] leading-4 text-[var(--market-text-subtle)]', className)}
    >
      <Clock3 size={12} className="shrink-0" />
      <span className="truncate">行情{label}</span>
    </span>
  );
}

export default MarketRefreshTime;
