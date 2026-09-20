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
  let statusPart1 = '冲向终点触发切仓';
  let statusPart2 = '';

  if (normalizedHoldingSide === 'H') {
    // 持有 H 标的：只监控切出到 L (即利差扩大超过 upperPct)
    const toUpper = upper - spread;
    if (toUpper <= 0) {
      triggered = true;
      statusPart1 = '🎉 已达终点线';
      statusPart2 = '触发 H→L 切出！';
    } else {
      statusPart1 = '冲向终点触发切仓';
      statusPart2 = `距 H→L 还差 ${formatSwitchPercent(toUpper)}`;
    }
  } else {
    // 持有 L 标的：只监控切回到 H (即利差收窄低于 lowerPct)
    const toLower = spread - lower;
    if (toLower <= 0) {
      triggered = true;
      statusPart1 = '🎉 已达终点线';
      statusPart2 = '触发 L→H 切回！';
    } else {
      statusPart1 = '冲向终点触发切仓';
      statusPart2 = `距 L→H 还差 ${formatSwitchPercent(toLower)}`;
    }
  }

  // 终点旗位置：持有 L 时在左侧 10%，持有 H 时在右侧 85%
  const isFlagOnLeft = normalizedHoldingSide === 'L';

  return (
    <div className="switch-gauge-box pt-0.5 space-y-1.5">
      {/* 顶部标题栏：「溢价差监控」智能排布在终点旗对侧，绝不被遮挡 */}
      <div className={cx(
        'flex items-center text-[11px] h-4',
        isFlagOnLeft ? 'justify-end' : 'justify-start'
      )}>
        <span className="text-slate-400 font-medium tracking-wide">溢价差监控</span>
      </div>

      {/* 标尺槽 (mt-6 mb-7 为小人和小人脚下的当前值气泡留出舒适空间) */}
      <div className="relative mt-6 mb-7 h-2.5 bg-slate-100 rounded-full overflow-visible flex items-center shadow-inner">
        <div className="absolute inset-y-0 left-[10%] right-[15%] bg-indigo-50/70 rounded-full" />

        <div className={cx(
          'absolute bottom-0 left-[10%] top-0 z-10',
          normalizedHoldingSide === 'L' ? 'w-1 rounded-full bg-emerald-500 shadow-xs' : 'w-0.5 bg-emerald-300'
        )} />
        <div className={cx(
          'absolute bottom-0 left-[85%] top-0 z-10',
          normalizedHoldingSide === 'H' ? 'w-1 rounded-full bg-rose-500 shadow-xs' : 'w-0.5 bg-rose-300'
        )} />

        {/* 终点旗帜 🏁 (根据持有侧智能放在左侧 10% 或右侧 85%) */}
        <div
          className={cx(
            'pointer-events-none absolute -top-6 z-20 -translate-x-1/2 select-none transition-all duration-300 flex flex-col items-center',
            isFlagOnLeft ? 'left-[10%]' : 'left-[85%]'
          )}
        >
          <span className="gauge-flag-wave text-base leading-none drop-shadow-xs">🏁</span>
          <span className={cx(
            'mt-0.5 h-1 w-1 rounded-full',
            normalizedHoldingSide === 'L' ? 'bg-emerald-500' : 'bg-rose-500'
          )} />
        </div>

        {/* 跑道虚线区：在小人与终点旗之间延伸 */}
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

        {/* 跑者指针 (自适应朝向与奔跑姿态 + 脚下跟随当前值气泡) */}
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

            {/* 当前值气泡挂载在对应小人正下方：当小人翻转时，此处反向翻转恢复正向排版 */}
            <div className={cx(
              'absolute top-[28px] whitespace-nowrap z-40',
              normalizedHoldingSide === 'L' && '-scale-x-100'
            )}>
              <div className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-slate-900 text-white shadow-sm border border-slate-700 text-[10px] font-mono leading-none">
                <span className="text-[9px] text-slate-300 font-sans">当前</span>
                <span className="font-bold">{formatSwitchPercent(spread)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 标尺端点行：左右两端清晰显示阈值刻度 */}
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-1 pt-0.5">
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className={cx(
            normalizedHoldingSide === 'L' ? 'text-emerald-700 font-bold' : 'text-slate-400 font-medium'
          )}>
            {formatSwitchPercent(lower)} L→H
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className={cx(
            normalizedHoldingSide === 'H' ? 'text-rose-700 font-bold' : 'text-slate-400 font-medium'
          )}>
            {formatSwitchPercent(upper)} H→L
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
        </div>
      </div>

      {/* 状态说明胶囊：独占全宽，移动端/App 端自动优雅折行，绝不截断 */}
      <div className="pt-1">
        <div className={cx(
          'w-full flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg text-xs font-sans font-medium border text-center flex-wrap leading-relaxed shadow-xs',
          triggered
            ? (normalizedHoldingSide === 'H'
                ? 'bg-rose-50 text-rose-700 border-rose-300 font-bold'
                : 'bg-emerald-50 text-emerald-700 border-emerald-300 font-bold')
            : (normalizedHoldingSide === 'L'
                ? 'bg-emerald-50/80 text-emerald-800 border-emerald-200/80'
                : 'bg-indigo-50/80 text-indigo-800 border-indigo-200/80')
        )}>
          <span className="shrink-0">{triggered ? '🏁' : '🏃'}</span>
          <span className="font-semibold">{statusPart1}</span>
          <span className="text-slate-400 hidden sm:inline">·</span>
          <span className={cx(
            'font-bold',
            triggered ? '' : normalizedHoldingSide === 'L' ? 'text-emerald-900' : 'text-indigo-900'
          )}>
            {statusPart2}
          </span>
        </div>
      </div>
    </div>
  );
}

export default SwitchStrategySpreadGauge;
