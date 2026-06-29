import { ArrowRightLeft, BellRing, CheckCircle2, ExternalLink } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';

function SignalAction({
  icon: Icon,
  label,
  count,
  tone,
  loading,
  disabled,
  onClick,
}) {
  const active = count > 0 && !disabled;
  const toneClass = tone === 'rose'
    ? 'border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100'
    : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100';
  return (
    <button
      type="button"
      disabled={!active}
      onClick={active ? onClick : undefined}
      className={cx(
        'flex min-h-[76px] min-w-0 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-default',
        active ? toneClass : 'border-slate-200 bg-white text-slate-400'
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={cx(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          active ? 'bg-white/80' : 'bg-slate-100'
        )}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-900">{label}</span>
          <span className="mt-0.5 block text-xs">
            {loading ? '读取中' : `${count || 0} 只`}
          </span>
        </span>
      </span>
      {active ? <ExternalLink className="h-4 w-4 shrink-0" /> : null}
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
    <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4" aria-label="今日信号">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">今日信号</div>
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
            {hasSignal ? <BellRing className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            {hasSignal ? '今天有需要确认的动作' : '今日无信号，持仓稳定'}
          </div>
          {hasSignal ? (
            <div className="mt-1 truncate text-xs text-slate-500">
              {switchCount > 0 ? `换仓 ${switchCount} 只` : '无换仓信号'}
              {' · '}
              {exitCount > 0 ? `出场 ${exitCount} 只` : '无出场信号'}
            </div>
          ) : null}
        </div>
        <div className="grid min-w-0 flex-[2] gap-2 sm:grid-cols-2">
          <SignalAction
            icon={ArrowRightLeft}
            label="触发换仓信号的基金"
            count={switchCount}
            loading={loading}
            tone="indigo"
            onClick={onOpenFundSwitch}
          />
          <SignalAction
            icon={BellRing}
            label="触发出场信号的基金"
            count={exitCount}
            loading={false}
            tone="rose"
            disabled={!firstExit}
            onClick={() => onOpenExitSignal?.(firstExit)}
          />
        </div>
      </div>
    </section>
  );
}

export default TodaySignalPanel;
