import { cx } from '../../components/experience-ui.jsx';
import { formatSwitchPercent } from '../switchStrategyHelpers.js';

export function SwitchStrategySpreadGauge({ gauge, simulatedSpread = null, holdingSide = 'H' }) {
  const rawSpread = simulatedSpread != null ? simulatedSpread : gauge?.spreadPct;
  const spread = Number.isFinite(Number(rawSpread)) ? Number(rawSpread) : 0.65;
  const lower = Number.isFinite(Number(gauge?.lowerPct)) ? Number(gauge.lowerPct) : 0.1;
  const upper = Number.isFinite(Number(gauge?.upperPct)) ? Number(gauge.upperPct) : 0.9;
  const span = upper - lower > 0 ? upper - lower : 0.8;
  const normalizedHoldingSide = holdingSide === 'L' ? 'L' : 'H';

  // 计算滑轨针位置：从 10% 到 85% 映射
  const ratio = Math.max(0, Math.min(1, (spread - lower) / span));
  const needleLeft = 10 + ratio * 75;

  // 单独针对持有 H 或 L 判断触发条件与差距
  let triggered = false;
  let statusText = '';

  if (normalizedHoldingSide === 'H') {
    // 持有 H 标的：只监控切出到 L (即溢价差扩大超过 upperPct)
    const toUpper = upper - spread;
    if (toUpper <= 0) {
      triggered = true;
      statusText = '已达切出线 (H→L)';
    } else {
      statusText = `距 H→L 还差 ${formatSwitchPercent(toUpper)}`;
    }
  } else {
    // 持有 L 标的：只监控切回 H (即溢价差收窄回落到 lowerPct 以下)
    const toLower = spread - lower;
    if (toLower <= 0) {
      triggered = true;
      statusText = '已达切回线 (L→H)';
    } else {
      statusText = `距 L→H 还差 ${formatSwitchPercent(toLower)}`;
    }
  }

  return (
    <div className="pt-0.5 space-y-1">
      {/* 顶部状态栏：当前溢价差与触发状态 */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-400">溢价差监控</span>
        <div className="flex items-center space-x-1.5 font-mono">
          <span className="text-slate-400 font-sans text-[10px]">当前:</span>
          <span className="font-bold text-indigo-600 text-xs">{formatSwitchPercent(spread)}</span>
        </div>
      </div>

      {/* 标尺槽 */}
      <div className="relative h-2.5 bg-slate-100 rounded-full overflow-visible flex items-center">
        {/* 触发线：按持仓高亮主触发端 */}
        <div className={cx(
          'absolute left-[10%] top-0 bottom-0 z-10',
          normalizedHoldingSide === 'L' ? 'w-1 bg-emerald-500 rounded-full shadow-xs' : 'w-0.5 bg-emerald-300'
        )}></div>
        <div className={cx(
          'absolute left-[85%] top-0 bottom-0 z-10',
          normalizedHoldingSide === 'H' ? 'w-1 bg-rose-500 rounded-full shadow-xs' : 'w-0.5 bg-rose-300'
        )}></div>
        {/* 指针 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 bg-indigo-600 border-2 border-white rounded-full shadow-md z-20 transition-all duration-200"
          style={{ left: `${needleLeft}%` }}
        ></div>
      </div>

      {/* 标尺刻度：分左右阈值与中间持仓触发距离 */}
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-0.5">
        <span className={cx(
          'font-medium',
          normalizedHoldingSide === 'L' ? 'text-emerald-700 font-bold' : 'text-slate-400'
        )}>
          {formatSwitchPercent(lower)} L→H
        </span>
        <span className={cx(
          'text-[10px] font-sans font-medium',
          triggered
            ? (normalizedHoldingSide === 'H' ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold')
            : 'text-slate-600'
        )}>
          {statusText}
        </span>
        <span className={cx(
          'font-medium',
          normalizedHoldingSide === 'H' ? 'text-rose-700 font-bold' : 'text-slate-400'
        )}>
          {formatSwitchPercent(upper)} H→L
        </span>
      </div>
    </div>
  );
}

export default SwitchStrategySpreadGauge;
