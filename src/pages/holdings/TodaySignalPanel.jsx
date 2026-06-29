import { ArrowRightLeft, BellRing, CheckCircle2, ChevronRight } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';

function SignalCount({ label, count, tone }) {
  return (
    <span className={cx(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
      tone === 'rose'
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : 'border-indigo-200 bg-indigo-50 text-indigo-700'
    )}>
      <span>{label}</span>
      <span className="tabular-nums">{count} 只</span>
    </span>
  );
}

function SignalAction({
  icon: Icon,
  label,
  description,
  count,
  tone,
  loading,
  disabled,
  onClick,
}) {
  const active = count > 0 && !disabled;
  const toneClass = tone === 'rose'
    ? 'border-rose-200 bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50'
    : 'border-indigo-200 bg-white text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50';
  return (
    <button
      type="button"
      disabled={!active}
      onClick={active ? onClick : undefined}
      className={cx(
        'flex min-h-[64px] min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-default',
        active ? toneClass : 'border-slate-200 bg-white text-slate-400'
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={cx(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          active ? (tone === 'rose' ? 'bg-rose-50' : 'bg-indigo-50') : 'bg-slate-100'
        )}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-900">
            {label}
            <span className="ml-2 tabular-nums text-current">{loading ? '读取中' : `${count || 0} 只`}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {description}
          </span>
        </span>
      </span>
      {active ? <ChevronRight className="h-4 w-4 shrink-0" /> : null}
    </button>
  );
}

export function TodaySignalPanel({
  loading = false,
  switchSummary,
  exitSummary,
  onOpenFundSwitch,
  onOpenExitSignal,
}) {
  const switchCount = Number(switchSummary?.count) || 0;
  const exitCount = Number(exitSummary?.count) || 0;
  const hasSignal = switchCount > 0 || exitCount > 0;
  const firstExit = Array.isArray(exitSummary?.rows) ? exitSummary.rows[0] : null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm" aria-label="今日信号">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cx(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              hasSignal ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
            )}>
              {hasSignal ? <BellRing className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">今日信号</div>
              <div className="mt-0.5 truncate text-sm font-semibold text-slate-900">
                {hasSignal ? '今天有需要确认的动作' : '今日无信号，持仓稳定'}
              </div>
            </div>
          </div>
        </div>
        {hasSignal ? (
        <div className="grid min-w-0 flex-[1.6] gap-2 sm:grid-cols-2">
          <SignalAction
            icon={ArrowRightLeft}
            label="换仓信号"
            description="查看基金切换建议"
            count={switchCount}
            loading={loading}
            tone="indigo"
            onClick={onOpenFundSwitch}
          />
          <SignalAction
            icon={BellRing}
            label="出场信号"
            description="打开对应持仓详情"
            count={exitCount}
            loading={false}
            tone="rose"
            disabled={!firstExit}
            onClick={() => onOpenExitSignal?.(firstExit)}
          />
        </div>
        ) : (
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <SignalCount label="换仓" count={loading ? '...' : switchCount} tone="indigo" />
            <SignalCount label="出场" count={exitCount} tone="rose" />
          </div>
        )}
      </div>
    </section>
  );
}

export default TodaySignalPanel;
