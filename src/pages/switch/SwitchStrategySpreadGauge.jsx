import { cx } from '../../components/experience-ui.jsx';
import { formatSwitchPercent } from '../switchStrategyHelpers.js';

export function SwitchStrategySpreadGauge({ gauge, simulatedSpread = null }) {
  const rawSpread = simulatedSpread != null ? simulatedSpread : gauge?.spreadPct;
  const spread = Number.isFinite(Number(rawSpread)) ? Number(rawSpread) : 0.65;
  const lower = Number.isFinite(Number(gauge?.lowerPct)) ? Number(gauge.lowerPct) : 0.1;
  const upper = Number.isFinite(Number(gauge?.upperPct)) ? Number(gauge.upperPct) : 0.9;
  const span = upper - lower > 0 ? upper - lower : 0.8;

  // 计算滑轨针位置：从 10% 到 85% 映射
  const ratio = Math.max(0, Math.min(1, (spread - lower) / span));
  const needleLeft = 10 + ratio * 75;
  const distance = upper - spread > 0 ? upper - spread : 0;
  const triggered = spread >= upper || spread <= lower;

  return (
    <div className="pt-0.5 space-y-1">
      {/* 顶部状态栏：当前利差与警报 */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-400">价差监测</span>
        <div className="flex items-center space-x-1.5 font-mono">
          <span className="text-slate-400 font-sans text-[10px]">当前:</span>
          <span className="font-bold text-indigo-600 text-xs">{formatSwitchPercent(spread)}</span>
          <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-500">
            {triggered ? '已达触发线' : '安全区间'}
          </span>
        </div>
      </div>

      {/* 标尺槽 */}
      <div className="relative h-2.5 bg-slate-100 rounded-full overflow-visible flex items-center">
        <div className="absolute inset-y-0 left-[10%] right-[15%] bg-indigo-50/80 rounded-full"></div>
        {/* 触发线 */}
        <div className="absolute left-[10%] top-0 bottom-0 w-0.5 bg-emerald-400 z-10"></div>
        <div className="absolute left-[85%] top-0 bottom-0 w-0.5 bg-rose-400 z-10"></div>
        {/* 指针 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 bg-indigo-600 border-2 border-white rounded-full shadow-md z-20 transition-all duration-200"
          style={{ left: `${needleLeft}%` }}
        ></div>
      </div>

      {/* 标尺刻度：分两层展示，左右两端只放阈值，中间单独展示“距触发距离”，绝不重叠挤压 */}
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-0.5">
        <span className="text-emerald-600 font-medium">{formatSwitchPercent(lower)} L→H</span>
        <span className="text-slate-500 font-sans text-[10px]">距 H→L 还差 {formatSwitchPercent(distance)}</span>
        <span className="text-rose-600 font-medium">{formatSwitchPercent(upper)} H→L</span>
      </div>
    </div>
  );
}
