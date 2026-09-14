import { cx } from '../../components/experience-ui.jsx';
import { formatSwitchDate, formatSwitchPercent, formatSwitchPrice } from '../switchStrategyHelpers.js';
import { resolveCnFundName } from '../markets/marketsCatalog.js';
import { SwitchStrategySpreadGauge } from './SwitchStrategySpreadGauge.jsx';

export function SwitchStrategyCardItem({
  row,
  busy = false,
  simulatedSpread = null,
  onToggle,
  onEdit,
  onTest,
  onDelete
}) {
  const highName = row.high?.name || (row.high?.code ? resolveCnFundName(row.high.code) : '') || '纳指ETF';
  const lowName = row.low?.name || (row.low?.code ? resolveCnFundName(row.low.code) : '') || '纳指科技';
  const highPremium = Number(row.high?.premiumPct);
  const lowPremium = Number(row.low?.premiumPct);
  const holdingSide = row.holdingSide || (row.benchmarkClass === 'L' ? 'L' : 'H');

  return (
    <div className="bg-white rounded-xl border border-slate-200 hover:border-indigo-300 transition-all shadow-xs flex flex-col justify-between overflow-hidden">
      {/* 卡片头部 */}
      <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center space-x-2">
          <h3 className="font-bold text-slate-900 text-xs sm:text-sm">{row.name}</h3>
          <span className={cx('px-1.5 py-0.2 rounded-full text-[10px] font-medium border', row.enabled ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200')}>
            {row.enabled ? '监控中' : '已暂停'}
          </span>
          {/* 持仓状态徽标 */}
          <span className={cx(
            'px-1.5 py-0.2 rounded text-[10px] font-bold border',
            holdingSide === 'L'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : holdingSide === 'BOTH'
                ? 'bg-slate-100 text-slate-600 border-slate-200'
                : 'bg-rose-50 text-rose-700 border-rose-200'
          )}>
            {holdingSide === 'L'
              ? `持仓: L (${row.lowCode || '513100'})`
              : holdingSide === 'BOTH'
                ? '双向监控'
                : `持仓: H (${row.highCode || '159632'})`}
          </span>
        </div>
        {/* Switch 开关 */}
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(row.enabled)}
            disabled={busy}
            onChange={onToggle}
            className="sr-only peer"
          />
          <div className="w-8 h-4.5 sm:w-9 sm:h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 sm:after:h-4 sm:after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
        </label>
      </div>

      {/* 标的行情栏 */}
      <div className="p-3 sm:p-4 space-y-2.5 sm:space-y-3">
        <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2 sm:p-2.5 rounded-lg border border-slate-100 text-xs">
          {/* H 组 */}
          <div className="space-y-1">
            <div className="flex items-center space-x-1">
              <span className="w-3.5 h-3.5 rounded bg-rose-100 text-rose-700 font-bold flex items-center justify-center text-[9px]">H</span>
              <span className="font-medium text-slate-700 truncate">{row.highCode || '159632'} {highName}</span>
            </div>
            <div className="flex items-baseline justify-between pr-1">
              <span className="text-slate-900 font-mono font-semibold text-xs sm:text-sm">{formatSwitchPrice(row.high?.price || 1.842)}</span>
              <span className="text-rose-600 font-mono text-[10px] sm:text-[11px] font-medium">
                {Number.isFinite(highPremium) ? formatSwitchPercent(highPremium, 2, true) : '+2.15%'}
              </span>
            </div>
          </div>
          {/* L 组 */}
          <div className="space-y-1 border-l border-slate-200 pl-2">
            <div className="flex items-center space-x-1">
              <span className="w-3.5 h-3.5 rounded bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-[9px]">L</span>
              <span className="font-medium text-slate-700 truncate">{row.lowCode || '513100'} {lowName}</span>
            </div>
            <div className="flex items-baseline justify-between pr-1">
              <span className="text-slate-900 font-mono font-semibold text-xs sm:text-sm">{formatSwitchPrice(row.low?.price || 1.620)}</span>
              <span className="text-emerald-600 font-mono text-[10px] sm:text-[11px] font-medium">
                {Number.isFinite(lowPremium) ? formatSwitchPercent(lowPremium, 2, true) : '-0.30%'}
              </span>
            </div>
          </div>
        </div>

        {/* 动态价差仪表盘 (含持仓单向触发判断) */}
        <SwitchStrategySpreadGauge gauge={row.gauge} simulatedSpread={simulatedSpread} holdingSide={holdingSide} />
      </div>

      {/* 卡片底栏 */}
      <div className="px-3.5 py-2 sm:px-4 sm:py-2.5 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
        <div className="flex items-center space-x-1.5 text-[10px] sm:text-xs font-mono">
          <span>{formatSwitchDate(row.computedAt) || '16:34:12'}</span>
          <span>•</span>
          <span>命中 <b className="text-indigo-600">{row.hitCount || 1}</b> 次</span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => onEdit?.(row)}
            className="px-2 py-0.5 text-slate-600 hover:text-indigo-600 rounded cursor-pointer"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={() => onTest?.(row)}
            className="px-2 py-0.5 text-indigo-600 hover:text-indigo-700 font-medium rounded cursor-pointer"
          >
            测试
          </button>
          <button
            type="button"
            onClick={() => onDelete?.(row)}
            className="px-2 py-0.5 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

export default SwitchStrategyCardItem;
