import { cx } from '../../components/experience-ui.jsx';
import { formatSwitchPercent } from '../switchStrategyHelpers.js';

// 动态价差标尺（防压盖版）。
// 分四层从上到下排布：当前利差数值 / 左右阈值标签 / 纯轨道 / 距触发提示。
// 轨道内部不放任何文字，因此在 <640px 窄屏也不会出现文字互相压盖。
export function SwitchStrategySpreadGauge({ gauge, className = '' }) {
  const ratio = Number.isFinite(Number(gauge?.ratio)) ? Number(gauge.ratio) : null;
  const needleLeft = ratio == null ? 50 : Math.max(3, Math.min(97, ratio * 100));
  const hasQuote = Number.isFinite(Number(gauge?.spreadPct));
  const triggered = Boolean(gauge?.triggered);
  const directionLabel = String(gauge?.directionLabel || '');

  return (
    <div className={cx('rounded-xl border border-slate-200/80 bg-slate-50/70 p-3', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="whitespace-nowrap text-[11px] font-bold text-slate-500">当前利差 H−L</span>
        <span className={cx('font-mono text-base font-black tabular-nums leading-none', triggered ? 'text-rose-600' : 'text-slate-900')}>
          {hasQuote ? formatSwitchPercent(gauge.spreadPct) : '—'}
        </span>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 text-[10px] font-black leading-none">
        <span className="whitespace-nowrap rounded-md bg-emerald-50 px-1.5 py-1 text-emerald-700 tabular-nums">
          {formatSwitchPercent(gauge?.lowerPct)} L→H
        </span>
        <span className="whitespace-nowrap rounded-md bg-rose-50 px-1.5 py-1 text-rose-600 tabular-nums">
          {formatSwitchPercent(gauge?.upperPct)} H→L
        </span>
      </div>

      <div className="relative mt-2 h-2.5 rounded-full bg-gradient-to-r from-emerald-200 via-slate-200 to-rose-200">
        {hasQuote ? (
          <div
            className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-900 shadow-sm ring-2 ring-white"
            style={{ left: `${needleLeft}%` }}
          />
        ) : null}
      </div>

      <div className="mt-2.5 flex justify-center">
        <span
          className={cx(
            'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold leading-none',
            !hasQuote ? 'bg-white text-slate-400 ring-1 ring-slate-200' : triggered ? 'bg-rose-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'
          )}
        >
          {!hasQuote
            ? '等待行情'
            : triggered
              ? `${directionLabel} 已达触发线`
              : `距 ${directionLabel} 还差 ${formatSwitchPercent(gauge.distancePct)}`}
        </span>
      </div>
    </div>
  );
}

export default SwitchStrategySpreadGauge;
