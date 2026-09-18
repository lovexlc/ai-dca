import { cx } from '../../components/experience-ui.jsx';
import { formatSwitchPercent } from '../switchStrategyHelpers.js';

export function SwitchStrategySpreadGauge({ gauge, simulatedSpread = null, holdingSide = 'H' }) {
  const rawSpread = simulatedSpread != null ? simulatedSpread : gauge?.spreadPct;
  const spread = Number.isFinite(Number(rawSpread)) ? Number(rawSpread) : 0.65;
  const lower = Number.isFinite(Number(gauge?.lowerPct)) ? Number(gauge.lowerPct) : 0.1;
  const upper = Number.isFinite(Number(gauge?.upperPct)) ? Number(gauge.upperPct) : 0.9;
  const span = upper - lower > 0 ? upper - lower : 0.8;
  const normalizedHoldingSide = holdingSide === 'L' ? 'L' : 'H';

  const ratio = Math.max(0, Math.min(1, (spread - lower) / span));
  const needleLeft = 10 + ratio * 75;

  let triggered = false;
  let statusText = '';
  let badgeLabel = '';
  let badgeTone = normalizedHoldingSide === 'H' ? 'rose' : 'emerald';
  if (normalizedHoldingSide === 'H') {
    const toUpper = upper - spread;
    if (toUpper <= 0) {
      triggered = true;
      statusText = '已达终点线 (触发 H→L 切出)';
      badgeLabel = '触发切出';
    } else {
      statusText = `冲向终点触发切仓 · 距 H→L 还差 ${formatSwitchPercent(toUpper)}`;
    }
  } else {
    const toLower = spread - lower;
    if (toLower <= 0) {
      triggered = true;
      statusText = '已达终点线 (触发 L→H 切回)';
      badgeLabel = '触发切回';
    } else {
      statusText = `冲向终点触发切仓 · 距 L→H 还差 ${formatSwitchPercent(toLower)}`;
    }
  }

  return (
    <div className="switch-gauge-box space-y-1 pt-0.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-slate-400">溢价差监控</span>
        <div className="flex items-center space-x-1.5 font-mono">
          <span className="font-sans text-[10px] text-slate-400">当前:</span>
          <span className="text-xs font-bold text-indigo-600">{formatSwitchPercent(spread)}</span>
          {triggered ? (
            <span className={cx(
              'rounded border px-1.5 py-0.5 text-[9px] font-medium',
              badgeTone === 'rose' ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            )}>
              {badgeLabel}
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative mt-5 flex h-2.5 items-center overflow-visible rounded-full bg-slate-100 shadow-inner">
        <div className="absolute inset-y-0 left-[10%] right-[15%] rounded-full bg-indigo-50/70" />

        <div className={cx(
          'absolute bottom-0 left-[10%] top-0 z-10',
          normalizedHoldingSide === 'L' ? 'w-1 rounded-full bg-emerald-500 shadow-xs' : 'w-0.5 bg-emerald-300'
        )} />
        <div className={cx(
          'absolute bottom-0 left-[85%] top-0 z-10',
          normalizedHoldingSide === 'H' ? 'w-1 rounded-full bg-rose-500 shadow-xs' : 'w-0.5 bg-rose-300'
        )} />

        <div
          className={cx(
            'pointer-events-none absolute -top-6 z-20 -translate-x-1/2 select-none transition-all duration-300',
            normalizedHoldingSide === 'L' ? 'left-[10%]' : 'left-[85%]'
          )}
        >
          <div className="flex flex-col items-center">
            <span className="gauge-flag-wave text-base leading-none drop-shadow-xs">🏁</span>
            <span className={cx(
              'mt-0.5 h-1 w-1 rounded-full',
              normalizedHoldingSide === 'L' ? 'bg-emerald-500' : 'bg-rose-500'
            )} />
          </div>
        </div>

        {normalizedHoldingSide === 'H' && needleLeft < 85 ? (
          <div
            className="pointer-events-none absolute inset-y-0.5 z-[5] rounded-full bg-indigo-50/70 gauge-track-dash-right"
            style={{ left: `${needleLeft}%`, right: '15%' }}
          />
        ) : null}
        {normalizedHoldingSide === 'L' && needleLeft > 10 ? (
          <div
            className="pointer-events-none absolute inset-y-0.5 z-[5] rounded-full bg-emerald-50/70 gauge-track-dash-left"
            style={{ left: '10%', right: `${100 - needleLeft}%` }}
          />
        ) : null}

        <div
          className={cx(
            'pointer-events-none absolute top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 select-none transition-all duration-200',
            normalizedHoldingSide === 'L' && '-scale-x-100'
          )}
          style={{ left: `${needleLeft}%` }}
        >
          <div className="relative flex flex-col items-center">
            <div className={cx(
              'gauge-runner-bob flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-xs text-white shadow-md',
              normalizedHoldingSide === 'L'
                ? 'bg-gradient-to-tr from-emerald-700 via-emerald-600 to-teal-500'
                : 'bg-gradient-to-tr from-indigo-700 via-indigo-600 to-violet-500'
            )}>
              <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7" />
              </svg>
            </div>
            <div className={cx(
              'h-0 w-0 border-l-[3px] border-r-[3px] border-t-[3px] border-l-transparent border-r-transparent',
              normalizedHoldingSide === 'L' ? 'border-t-emerald-600' : 'border-t-indigo-600'
            )} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1.5 text-[10px] font-mono text-slate-400">
        <span className={cx(
          'shrink-0 font-medium',
          normalizedHoldingSide === 'L' ? 'font-bold text-emerald-700' : 'text-slate-400'
        )}>
          {formatSwitchPercent(lower)} L→H
        </span>
        <span className={cx(
          'mx-1 inline-flex min-w-0 items-center gap-1 truncate rounded-md border px-2 py-0.5 text-[11px] font-sans font-semibold',
          triggered
            ? (normalizedHoldingSide === 'H'
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700')
            : (normalizedHoldingSide === 'L'
                ? 'border-emerald-200 bg-emerald-50/80 text-emerald-800'
                : 'border-indigo-200 bg-indigo-50/80 text-indigo-800')
        )}>
          <span aria-hidden="true">{triggered ? '🏁' : '🏃'}</span>
          <span>{statusText}</span>
        </span>
        <span className={cx(
          'shrink-0 font-medium',
          normalizedHoldingSide === 'H' ? 'font-bold text-rose-700' : 'text-slate-400'
        )}>
          {formatSwitchPercent(upper)} H→L
        </span>
      </div>
    </div>
  );
}

export default SwitchStrategySpreadGauge;
