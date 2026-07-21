import { cx } from '../experience-ui.jsx';

const STATUS_META = {
  noHolding: { label: '未检测到持仓', bar: 'bg-slate-300', text: 'text-slate-500' },
  watching: { label: '观察中', bar: 'bg-indigo-500', text: 'text-slate-500' },
  nearReminder: { label: '接近提醒', bar: 'bg-indigo-500', text: 'text-amber-700' },
  triggered: { label: '已触发', bar: 'bg-emerald-500', text: 'text-emerald-700' },
  disabled: { label: '已停用', bar: 'bg-slate-300', text: 'text-slate-500' },
  error: { label: '运行异常', bar: 'bg-rose-500', text: 'text-rose-700' }
};

export function SwitchProgressBar({ progressPercent = 0, status = 'watching', loading = false }) {
  const meta = STATUS_META[status] || STATUS_META.watching;
  const value = Number.isFinite(Number(progressPercent)) ? Math.max(0, Math.min(100, Number(progressPercent))) : 0;

  return (
    <div className="min-w-0" data-switch-progress>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-slate-700">切换进度</span>
        <span className="tabular-nums text-slate-500">{Math.round(value)}%</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label="切换进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
      >
        <div
          className={cx('h-full rounded-full transition-[width] duration-300 ease-out', meta.bar, loading && 'animate-pulse')}
          style={{ width: `${value}%` }}
        />
      </div>
      <div className={cx('mt-1.5 text-[11px]', meta.text)}>{meta.label}</div>
    </div>
  );
}

export function getSwitchProgressStatusLabel(status) {
  return STATUS_META[status]?.label || STATUS_META.watching.label;
}
