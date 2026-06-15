import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import { cx } from './experience-ui.jsx';

/**
 * RealTimeSignalCard - 实时信号卡片
 * 显示策略触发的交易信号
 */
export function RealTimeSignalCard({ signal, className }) {
  const isRuleA = signal.rule === 'A';
  const isTriggered = signal.triggered || signal.signal === 'switch';

  const statusColor = isTriggered
    ? (isRuleA ? 'emerald' : 'indigo')
    : 'slate';

  const statusBgClass = {
    emerald: 'bg-emerald-50 border-emerald-200',
    indigo: 'bg-indigo-50 border-indigo-200',
    slate: 'bg-slate-50 border-slate-200'
  }[statusColor];

  const statusTextClass = {
    emerald: 'text-emerald-700',
    indigo: 'text-indigo-700',
    slate: 'text-slate-600'
  }[statusColor];

  const statusIconClass = {
    emerald: 'text-emerald-500',
    indigo: 'text-indigo-500',
    slate: 'text-slate-400'
  }[statusColor];

  return (
    <div className={cx(
      'rounded-xl border-2 p-4 transition-all',
      statusBgClass,
      isTriggered && 'shadow-md',
      className
    )}>
      <div className="flex items-start gap-3">
        <div className={cx('rounded-lg p-2', isTriggered ? 'bg-white' : 'bg-slate-100')}>
          {isRuleA ? (
            <TrendingDown className={cx('h-5 w-5', statusIconClass)} />
          ) : (
            <TrendingUp className={cx('h-5 w-5', statusIconClass)} />
          )}
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={cx('text-sm font-bold', statusTextClass)}>
              规则 {signal.rule}
            </span>
            {isTriggered && (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-emerald-600">
                触发
              </span>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span>卖 {signal.fromCode}</span>
            <ArrowRight className="h-4 w-4 text-slate-400" />
            <span>买 {signal.toCode}</span>
          </div>

          <div className="mt-2 text-xs text-slate-600">
            溢价差: <span className="font-semibold">{signal.gapPct}%</span>
            {' '}
            {isRuleA ? '≤' : '≥'}
            {' '}
            {signal.threshold}%
          </div>

          {signal.timestamp && (
            <div className="mt-2 text-xs text-slate-500">
              {formatTimestamp(signal.timestamp)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(ts) {
  const now = Date.now();
  const diff = now - (typeof ts === 'number' ? ts : Date.parse(ts));
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}
