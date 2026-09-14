import { Clock3 } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { formatMarketRefreshTime } from './marketRefreshTime.js';

export function MarketRefreshTime({ timestamp = '', loading = false, className = '' }) {
  const formatted = formatMarketRefreshTime(timestamp);
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
