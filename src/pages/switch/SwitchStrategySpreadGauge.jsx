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
      statusText = '已达终点线 (触发 H→L 切出)';
      badgeLabel = '触发切出';
      badgeTone = 'rose';
    } else {
      statusText = `冲向终点触发切仓 · 距 H→L 还差 ${formatSwitchPercent(toUpper)}`;
      badgeLabel = '安全区间';
      badgeTone = 'slate';
    }
  } else if (holdingSide === 'L') {
    // 持有 L 标的：只监控切回 H (即利差收窄回落到 lowerPct 以下)
    const toLower = spread - lower;
    if (toLower <= 0) {
      triggered = true;
      statusText = '已达终点线 (触发 L→H 切回)';
      badgeLabel = '触发切回';
      badgeTone = 'emerald';
    } else {
      statusText = `冲向终点触发切仓 · 距 L→H 还差 ${formatSwitchPercent(toLower)}`;
      badgeLabel = '安全区间';
      badgeTone = 'slate';
    }
  } else {
    // 双向监控
    const toUpper = upper - spread;
    const toLower = spread - lower;
    if (toUpper <= 0) {
      triggered = true;
      statusText = '已达终点线 (触发 H→L 切出)';
      badgeLabel = '触发切出';
      badgeTone = 'rose';
    } else if (toLower <= 0) {
      triggered = true;
      statusText = '已达终点线 (触发 L→H 切回)';
      badgeLabel = '触发切回';
      badgeTone = 'emerald';
    } else {
      statusText = toUpper <= toLower
        ? `冲向终点触发切仓 · 距 H→L 还差 ${formatSwitchPercent(toUpper)}`
        : `冲向终点触发切仓 · 距 L→H 还差 ${formatSwitchPercent(toLower)}`;
      badgeLabel = '安全区间';
      badgeTone = 'slate';
    }
  }

  return (
    <div className="switch-gauge-box pt-0.5 space-y-1">
      {/* 顶部状态栏：当前利差与警报 */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-400 font-medium">价差监测</span>
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

      {/* 标尺槽 (增加上边距留出 🏁 终点旗飘动空间) */}
      <div className="relative mt-5 h-2.5 bg-slate-100 rounded-full overflow-visible flex items-center shadow-inner">
        <div className="absolute inset-y-0 left-[10%] right-[15%] bg-indigo-50/70 rounded-full"></div>

        {/* 触发线：按持仓高亮主触发端 */}
        <div className={cx(
          'absolute left-[10%] top-0 bottom-0 z-10',
          holdingSide === 'L' ? 'w-1 bg-emerald-500 rounded-full shadow-xs' : 'w-0.5 bg-emerald-300'
        )}></div>
        <div className={cx(
          'absolute left-[85%] top-0 bottom-0 z-10',
          holdingSide === 'H' ? 'w-1 bg-rose-500 rounded-full shadow-xs' : 'w-0.5 bg-rose-300'
        )}></div>

        {/* 终点旗帜 🏁 (位于右侧 85% 或左侧 10%) */}
        <div
          className={cx(
            "absolute -top-6 -translate-x-1/2 z-20 pointer-events-none select-none transition-all duration-300",
            holdingSide === 'L' ? 'left-[10%]' : 'left-[85%]'
          )}
        >
          <div className="flex flex-col items-center">
            <span className="gauge-flag-wave text-base leading-none drop-shadow-xs">🏁</span>
            <span className={cx(
              "w-1 h-1 rounded-full mt-0.5",
              holdingSide === 'L' ? 'bg-emerald-500' : 'bg-rose-500'
            )}></span>
          </div>
        </div>

        {/* 跑道虚线区：在小人与终点旗之间延伸 */}
        {holdingSide === 'H' && needleLeft < 85 && (
          <div
            className="absolute inset-y-0.5 rounded-full z-[5] gauge-track-dash-right bg-indigo-50/70"
            style={{
              left: `${needleLeft}%`,
              right: '15%',
            }}
          />
        )}
        {holdingSide === 'L' && needleLeft > 10 && (
          <div
            className="absolute inset-y-0.5 rounded-full z-[5] gauge-track-dash-left bg-emerald-50/70"
            style={{
              left: '10%',
              right: `${100 - needleLeft}%`,
            }}
          />
        )}

        {/* 跑者指针 (自适应朝向与奔跑姿态) */}
        <div
          className={cx(
            "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-30 transition-all duration-200 pointer-events-none select-none",
            holdingSide === 'L' && "-scale-x-100"
          )}
          style={{ left: `${needleLeft}%` }}
        >
          <div className="relative flex flex-col items-center">
            <div className={cx(
              "gauge-runner-bob flex items-center justify-center w-6 h-6 rounded-full text-white shadow-md border-2 border-white text-xs",
              holdingSide === 'L'
                ? "bg-gradient-to-tr from-emerald-700 via-emerald-600 to-teal-500"
                : "bg-gradient-to-tr from-indigo-700 via-indigo-600 to-violet-500"
            )}>
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/>
              </svg>
            </div>
            <div className={cx(
              "w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[3px]",
              holdingSide === 'L' ? "border-t-emerald-600" : "border-t-indigo-600"
            )}></div>
          </div>
        </div>
      </div>

      {/* 标尺刻度：分左右阈值与中间持仓触发距离 */}
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1.5">
        <span className={cx(
          'font-medium shrink-0',
          holdingSide === 'L' ? 'text-emerald-700 font-bold' : holdingSide === 'H' ? 'text-slate-400' : 'text-emerald-600'
        )}>
          {formatSwitchPercent(lower)} L→H
        </span>
        <span className={cx(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-sans font-semibold border mx-1 truncate',
          triggered
            ? (badgeTone === 'rose'
                ? 'bg-rose-50 text-rose-700 border-rose-200'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200')
            : (holdingSide === 'L'
                ? 'bg-emerald-50/80 text-emerald-800 border-emerald-200/80'
                : 'bg-indigo-50/80 text-indigo-800 border-indigo-200/80')
        )}>
          <span>{triggered ? '🏁' : '🏃'}</span>
          <span>{statusText}</span>
        </span>
        <span className={cx(
          'font-medium shrink-0',
          holdingSide === 'H' ? 'text-rose-700 font-bold' : holdingSide === 'L' ? 'text-slate-400' : 'text-rose-600'
        )}>
          {formatSwitchPercent(upper)} H→L
        </span>
      </div>
    </div>
  );
}

export default SwitchStrategySpreadGauge;
