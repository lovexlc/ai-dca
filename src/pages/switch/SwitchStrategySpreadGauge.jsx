import { cx } from '../../components/experience-ui.jsx';
import { formatSwitchPercent } from '../switchStrategyHelpers.js';

export function SwitchStrategySpreadGauge({ gauge, simulatedSpread = null, holdingSide = 'H' }) {
  const rawSpread = simulatedSpread != null ? simulatedSpread : gauge?.spreadPct;
  const spread = Number.isFinite(Number(rawSpread)) ? Number(rawSpread) : 0.65;
  const lower = Number.isFinite(Number(gauge?.lowerPct)) ? Number(gauge.lowerPct) : 0.1;
  const upper = Number.isFinite(Number(gauge?.upperPct)) ? Number(gauge.upperPct) : 0.9;
  const span = upper - lower > 0 ? upper - lower : 0.8;

  // 计算滑轨针位置：从 10% 到 85% 映射
  const ratio = Math.max(0, Math.min(1, (spread - lower) / span));
  const needleLeft = 10 + ratio * 75;

  // 单独针对持有 H 或 L 判断触发条件与差距
  let triggered = false;
  let statusText = '';
  let badgeLabel = '安全区间';
  let badgeTone = 'slate';

  if (holdingSide === 'H') {
    // 持有 H 标的：只监控切出到 L (即利差扩大超过 upperPct)
    const toUpper = upper - spread;
    if (toUpper <= 0) {
      triggered = true;
      statusText = '已达切出线 (H→L)';
      badgeLabel = '触发切出';
      badgeTone = 'rose';
    } else {
      statusText = `距 H→L 还差 ${formatSwitchPercent(toUpper)}`;
      badgeLabel = '安全区间';
      badgeTone = 'slate';
    }
  } else if (holdingSide === 'L') {
    // 持有 L 标的：只监控切回 H (即利差收窄回落到 lowerPct 以下)
    const toLower = spread - lower;
    if (toLower <= 0) {
      triggered = true;
      statusText = '已达切回线 (L→H)';
      badgeLabel = '触发切回';
      badgeTone = 'emerald';
    } else {
      statusText = `距 L→H 还差 ${formatSwitchPercent(toLower)}`;
      badgeLabel = '安全区间';
      badgeTone = 'slate';
    }
  } else {
    // 双向监控
    const toUpper = upper - spread;
    const toLower = spread - lower;
    if (toUpper <= 0) {
      triggered = true;
      statusText = '已达切出线 (H→L)';
      badgeLabel = '触发切出';
      badgeTone = 'rose';
    } else if (toLower <= 0) {
      triggered = true;
      statusText = '已达切回线 (L→H)';
      badgeLabel = '触发切回';
      badgeTone = 'emerald';
    } else {
      statusText = toUpper <= toLower
        ? `距 H→L 还差 ${formatSwitchPercent(toUpper)}`
        : `距 L→H 还差 ${formatSwitchPercent(toLower)}`;
      badgeLabel = '安全区间';
      badgeTone = 'slate';
    }
  }

  return (
    <div className="pt-0.5 space-y-1">
      {/* 顶部状态栏：当前利差与警报 */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-400">价差监测</span>
        <div className="flex items-center space-x-1.5 font-mono">
          <span className="text-slate-400 font-sans text-[10px]">当前:</span>
          <span className="font-bold text-indigo-600 text-xs">{formatSwitchPercent(spread)}</span>
          <span className={cx(
            'text-[9px] px-1.5 py-0.2 rounded font-medium border',
            badgeTone === 'rose' && 'bg-rose-50 text-rose-600 border-rose-200',
            badgeTone === 'emerald' && 'bg-emerald-50 text-emerald-700 border-emerald-200',
            badgeTone === 'slate' && 'bg-slate-100 text-slate-500 border-slate-200'
          )}>
            {badgeLabel}
          </span>
        </div>
      </div>

      {/* 标尺槽 */}
      <div className="relative h-2.5 bg-slate-100 rounded-full overflow-visible flex items-center">
        <div className="absolute inset-y-0 left-[10%] right-[15%] bg-indigo-50/80 rounded-full"></div>
        {/* 触发线：按持仓高亮主触发端 */}
        <div className={cx(
          'absolute left-[10%] top-0 bottom-0 z-10',
          holdingSide === 'L' ? 'w-1 bg-emerald-500 rounded-full shadow-xs' : 'w-0.5 bg-emerald-300'
        )}></div>
        <div className={cx(
          'absolute left-[85%] top-0 bottom-0 z-10',
          holdingSide === 'H' ? 'w-1 bg-rose-500 rounded-full shadow-xs' : 'w-0.5 bg-rose-300'
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
          holdingSide === 'L' ? 'text-emerald-700 font-bold' : holdingSide === 'H' ? 'text-slate-400' : 'text-emerald-600'
        )}>
          {formatSwitchPercent(lower)} L→H
        </span>
        <span className={cx(
          'text-[10px] font-sans font-medium',
          triggered
            ? (badgeTone === 'rose' ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold')
            : 'text-slate-600'
        )}>
          {statusText}
        </span>
        <span className={cx(
          'font-medium',
          holdingSide === 'H' ? 'text-rose-700 font-bold' : holdingSide === 'L' ? 'text-slate-400' : 'text-rose-600'
        )}>
          {formatSwitchPercent(upper)} H→L
        </span>
      </div>
    </div>
  );
}

export default SwitchStrategySpreadGauge;
