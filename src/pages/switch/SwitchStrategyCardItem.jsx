import { cx } from '../../components/experience-ui.jsx';
import { formatSwitchDate, formatSwitchPercent, formatSwitchPrice } from '../switchStrategyHelpers.js';
import { resolveCnFundName } from '../markets/marketsCatalog.js';
import { SwitchStrategySpreadGauge } from './SwitchStrategySpreadGauge.jsx';

const CHANNEL_ICONS = {
  ios: '📱 iOS',
  serverchan3: '🤖 Android',
  pc: '💻 PC',
  email: '✉️ Email'
};

export function SwitchStrategyCardItem({
  row,
  busy = false,
  simulatedSpread = null,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete
}) {
  const highName = row.high?.name || (row.high?.code ? resolveCnFundName(row.high.code) : '') || '纳指ETF';
  const lowName = row.low?.name || (row.low?.code ? resolveCnFundName(row.low.code) : '') || '纳指科技';
  const highPremium = Number(row.high?.premiumPct);
  const lowPremium = Number(row.low?.premiumPct);

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] hover:shadow-md transition-shadow">
      {/* 头部：方案名称 + 状态徽章 + 开关切换 */}
      <div className="flex items-center justify-between gap-2 pb-3.5">
        <div className="flex items-center space-x-2">
          <h3 className="text-base font-bold text-slate-900 truncate">{row.name}</h3>
          <span
            className={cx(
              'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none',
              row.enabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80' : 'bg-slate-100 text-slate-500'
            )}
          >
            {row.enabled ? '监控中' : '已暂停'}
          </span>
        </div>

        {/* 启停 Switch 开关 */}
        <button
          type="button"
          role="switch"
          aria-checked={row.enabled}
          disabled={busy}
          onClick={onToggle}
          className={cx(
            'relative h-6 w-11 shrink-0 rounded-full transition-colors cursor-pointer',
            row.enabled ? 'bg-indigo-600' : 'bg-slate-200'
          )}
        >
          <span
            className={cx(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
              row.enabled ? 'left-[22px]' : 'left-0.5'
            )}
          />
        </button>
      </div>

      {/* H / L 标的行情卡片 */}
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 mb-3">
        {/* H 腿 */}
        <div className="min-w-0">
          <div className="flex items-center space-x-1.5">
            <span className="rounded bg-rose-100 px-1 py-0.2 text-[10px] font-bold text-rose-700">H</span>
            <span className="text-xs font-semibold text-slate-700 truncate">{row.highCode || '159632'} {highName}</span>
          </div>
          <div className="mt-1.5 flex items-baseline space-x-2">
            <span className="font-mono text-base font-bold text-slate-900">{formatSwitchPrice(row.high?.price || 1.842)}</span>
            <span className="font-mono text-xs font-semibold text-rose-600">
              {Number.isFinite(highPremium) ? formatSwitchPercent(highPremium, 2, true) : '+2.15%'}
            </span>
          </div>
        </div>

        {/* L 腿 */}
        <div className="min-w-0 border-l border-slate-200/60 pl-3">
          <div className="flex items-center space-x-1.5">
            <span className="rounded bg-emerald-100 px-1 py-0.2 text-[10px] font-bold text-emerald-700">L</span>
            <span className="text-xs font-semibold text-slate-700 truncate">{row.lowCode || '513100'} {lowName}</span>
          </div>
          <div className="mt-1.5 flex items-baseline space-x-2">
            <span className="font-mono text-base font-bold text-slate-900">{formatSwitchPrice(row.low?.price || 1.620)}</span>
            <span className="font-mono text-xs font-semibold text-emerald-600">
              {Number.isFinite(lowPremium) ? formatSwitchPercent(lowPremium, 2, true) : '-0.30%'}
            </span>
          </div>
        </div>
      </div>

      {/* 价差监测标尺 */}
      <div className="mb-3">
        <SwitchStrategySpreadGauge gauge={row.gauge} simulatedSpread={simulatedSpread} />
      </div>

      {/* 预警渠道徽章列表 */}
      <div className="flex items-center space-x-2 text-xs py-2 border-t border-slate-100">
        <span className="text-slate-400 text-[11px] font-medium">预警渠道:</span>
        <div className="flex flex-wrap gap-1.5">
          {(row.channels || ['pc', 'email']).map((ch) => (
            <span
              key={ch}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600"
            >
              {CHANNEL_ICONS[ch] || ch}
            </span>
          ))}
        </div>
      </div>

      {/* 卡片底栏：时间戳与文字操作按钮 */}
      <div className="mt-auto flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-400">
        <div className="flex items-center space-x-1.5 font-mono text-[11px]">
          <span>{formatSwitchDate(row.computedAt) || '16:34:12'}</span>
          <span>·</span>
          <span>命中 <strong className="text-slate-700 font-bold">{row.hitCount || 1}</strong> 次</span>
        </div>

        <div className="flex items-center space-x-3 text-xs">
          <button
            type="button"
            onClick={() => onEdit?.(row)}
            className="text-slate-400 hover:text-indigo-600 font-medium transition-colors cursor-pointer"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={() => onDuplicate?.(row)}
            className="text-slate-400 hover:text-indigo-600 font-medium transition-colors cursor-pointer"
          >
            复制
          </button>
          <button
            type="button"
            onClick={() => onDelete?.(row)}
            className="text-slate-400 hover:text-rose-600 font-medium transition-colors cursor-pointer"
          >
            删除
          </button>
        </div>
      </div>
    </article>
  );
}

export default SwitchStrategyCardItem;
