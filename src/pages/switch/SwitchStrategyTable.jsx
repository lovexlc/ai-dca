import { BarChart3, Copy, Pencil, Trash2 } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { formatSwitchDate, formatSwitchPercent, formatSwitchPrice } from '../switchStrategyHelpers.js';
import { resolveCnFundName } from '../markets/marketsCatalog.js';
import { SWITCH_CHANNEL_DEFS } from './switchBoardModel.js';

const HEADERS = ['方案', '状态', 'H 组', 'L 组', '当前利差', '双向阈值', '距触发', '渠道', '更新', '操作'];

function LegCell({ quote }) {
  const name = quote.name || (quote.code ? resolveCnFundName(quote.code) : '');
  return (
    <div className="min-w-0">
      <div className="font-mono text-xs font-bold text-slate-900">{quote.code || '未配置'}</div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="max-w-[8rem] truncate text-[11px] text-slate-500">{name || '—'}</span>
        <span className="font-mono text-[11px] tabular-nums text-slate-600">{formatSwitchPrice(quote.price)}</span>
      </div>
    </div>
  );
}

// PC 高密度列表视图。仅在 ≥1024px 渲染，窄屏由看板视图接管。
export function SwitchStrategyTable({ rows, busyRuleId = '', onToggle, onEdit, onDuplicate, onDelete, onBacktest }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              {HEADERS.map((header) => (
                <th key={header} className="whitespace-nowrap px-3 py-2.5 text-[11px] font-black uppercase tracking-wide text-slate-500">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const channelLabels = SWITCH_CHANNEL_DEFS.filter((item) => row.channels.includes(item.key)).map((item) => item.label);
              const busy = busyRuleId === row.id;
              return (
                <tr key={row.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2.5">
                    <span className="block max-w-[12rem] truncate text-xs font-bold text-slate-950">{row.name}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.enabled}
                      aria-label={row.enabled ? `暂停 ${row.name}` : `启用 ${row.name}`}
                      disabled={busy}
                      onClick={() => onToggle?.(row)}
                      className={cx(
                        'whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                        row.enabled ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      )}
                    >
                      {row.enabled ? '监控中' : '已停用'}
                    </button>
                  </td>
                  <td className="px-3 py-2.5"><LegCell quote={row.high} /></td>
                  <td className="px-3 py-2.5"><LegCell quote={row.low} /></td>
                  <td className="px-3 py-2.5">
                    <span className={cx('font-mono text-xs font-black tabular-nums', row.gauge.triggered ? 'text-rose-600' : 'text-slate-900')}>
                      {row.hasQuote ? formatSwitchPercent(row.spreadPct) : '—'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] tabular-nums text-slate-600">
                    <span className="text-emerald-600">{formatSwitchPercent(row.lowerPct)}</span>
                    <span className="px-1 text-slate-300">/</span>
                    <span className="text-rose-600">{formatSwitchPercent(row.upperPct)}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-[11px] font-bold text-slate-700">
                    {!row.hasQuote ? '等待行情' : row.gauge.triggered ? `${row.gauge.directionLabel} 已触发` : `${row.gauge.directionLabel} ${formatSwitchPercent(row.gauge.distancePct)}`}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-slate-500">{channelLabels.join(', ') || '未选'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] tabular-nums text-slate-500">{formatSwitchDate(row.computedAt)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      {[
                        { icon: BarChart3, label: '回测此策略', action: () => onBacktest?.(row), tone: 'slate' },
                        { icon: Pencil, label: '编辑方案', action: () => onEdit?.(row), tone: 'slate' },
                        { icon: Copy, label: '复制方案', action: () => onDuplicate?.(row), tone: 'slate' },
                        { icon: Trash2, label: '删除方案', action: () => onDelete?.(row), tone: 'rose' }
                      ].map(({ icon: Icon, label, action, tone }) => (
                        <button
                          key={label}
                          type="button"
                          title={label}
                          aria-label={label}
                          disabled={busy}
                          onClick={action}
                          className={cx(
                            'inline-flex h-8 w-8 items-center justify-center rounded-lg border bg-white transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                            tone === 'rose' ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default SwitchStrategyTable;
