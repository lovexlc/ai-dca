import { cx } from '../../components/experience-ui.jsx';
import { formatSwitchPercent } from '../switchStrategyHelpers.js';

/**
 * 动态价差标尺（1:1 像素级复刻用户需求图 media_1789386000381.png）
 * 结构：
 * 顶行：价差监测 (左) | 当前: 0.65% 安全区间 (右，靛青色高亮)
 * 中间：纤细轨道，左右阈值竖线 (0.1% L-H 绿色, 0.9% H-L 红色)，中间圆点指针
 * 底行：居中提示 "距 H->L 还差 0.25%"
 */
export function SwitchStrategySpreadGauge({ gauge, simulatedSpread = null, className = '' }) {
  const rawSpread = simulatedSpread != null ? simulatedSpread : gauge?.spreadPct;
  const spread = Number.isFinite(Number(rawSpread)) ? Number(rawSpread) : null;
  const lower = Number.isFinite(Number(gauge?.lowerPct)) ? Number(gauge.lowerPct) : 0.1;
  const upper = Number.isFinite(Number(gauge?.upperPct)) ? Number(gauge.upperPct) : 0.9;
  const span = upper - lower > 0 ? upper - lower : 0.8;

  // 计算指针百分比 (0% ~ 100%)
  const ratio = spread == null ? 50 : Math.max(0, Math.min(100, ((spread - lower) / span) * 100));
  const triggered = spread != null && (spread >= upper || spread <= lower);
  const distance = spread != null ? (upper - spread > 0 ? upper - spread : 0) : null;

  return (
    <div className={cx('rounded-xl border border-slate-100 bg-slate-50/50 p-3', className)}>
      {/* 顶行：标题与当前利差 */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-500">价差监测</span>
        <div className="flex items-center space-x-1.5 font-mono">
          <span className="text-slate-400">当前:</span>
          <span className={cx('font-bold', triggered ? 'text-rose-600' : 'text-indigo-600')}>
            {spread != null ? formatSwitchPercent(spread) : '0.65%'}
          </span>
          <span className={cx('text-[10px] px-1.5 py-0.2 rounded font-semibold', triggered ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600')}>
            {triggered ? '触发状态' : '安全区间'}
          </span>
        </div>
      </div>

      {/* 中间：轨道与阈值标记 */}
      <div className="relative my-3 pt-1 pb-2">
        {/* 背景滑轨 */}
        <div className="h-1.5 w-full rounded-full bg-slate-200/80 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 via-indigo-400 to-rose-400 opacity-70"
            style={{ width: `${ratio}%` }}
          />
        </div>

        {/* 左阈值竖线 (L-H) */}
        <div className="absolute left-[15%] top-0 bottom-1 flex flex-col items-center pointer-events-none">
          <div className="h-3.5 w-0.5 bg-emerald-500 rounded" />
        </div>

        {/* 右阈值竖线 (H-L) */}
        <div className="absolute right-[15%] top-0 bottom-1 flex flex-col items-center pointer-events-none">
          <div className="h-3.5 w-0.5 bg-rose-500 rounded" />
        </div>

        {/* 指针圆点 */}
        <div
          className="absolute top-0 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-slate-900 ring-2 ring-white shadow-sm transition-all duration-200"
          style={{ left: `${Math.max(5, Math.min(95, ratio))}%` }}
        />
      </div>

      {/* 标尺数值与距触发提示 */}
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
        <span className="text-emerald-600 font-semibold">{formatSwitchPercent(lower)} L-H</span>
        <span className="text-slate-500 font-medium">
          {distance != null && distance > 0 ? `距 H→L 还差 ${formatSwitchPercent(distance)}` : '已达触发线'}
        </span>
        <span className="text-rose-600 font-semibold">{formatSwitchPercent(upper)} H+L</span>
      </div>
    </div>
  );
}

export default SwitchStrategySpreadGauge;
