import { BarChart3, FlaskConical, Pencil, Trash2 } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { formatSwitchDate, formatSwitchPercent, formatSwitchPrice } from '../switchStrategyHelpers.js';
import { resolveCnFundName } from '../markets/marketsCatalog.js';

const HEADERS = ['方案', '持仓', '状态', 'H 组', 'L 组', '当前利差', '双向阈值', '距触发', '更新', '操作'];

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function LegCell({ quotes, fallbackQuote }) {
  const items = Array.isArray(quotes) && quotes.length ? quotes : [fallbackQuote].filter(Boolean);
  return (
    <div className="min-w-0 space-y-1.5">
      {items.length ? items.map((quote) => {
        const name = quote?.name || (quote?.code ? resolveCnFundName(quote.code) : '');
        const price = finiteNumber(quote?.price);
        const premium = finiteNumber(quote?.premiumPct);
        return (
          <div key={quote?.code || name} className="min-w-0">
            <div className="font-mono text-xs font-bold text-slate-900">{quote?.code || '未配置'}</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="max-w-[7rem] truncate text-[11px] text-slate-500">{name || '—'}</span>
              <span className="font-mono text-[11px] tabular-nums text-slate-600">{price == null ? '—' : formatSwitchPrice(price)}</span>
              <span className="font-mono text-[11px] tabular-nums text-indigo-600">{premium == null ? '—' : formatSwitchPercent(premium, 2, true)}</span>
            </div>
          </div>
        );
      }) : <span className="text-[11px] text-slate-400">未配置</span>}
    </div>
  );
}

function holdingLabel(row, holdingSide) {
  const codes = Array.isArray(row.holdingCodes) ? row.holdingCodes : [];
  if (holdingSide === 'BOTH') return `双向（${codes.length || '全部'}）`;
  const first = codes[0] || (holdingSide === 'L' ? row.lowCode : row.highCode) || '未配置';
  return `${holdingSide}（${first}${codes.length > 1 ? ` 等${codes.length}只` : ''}）`;
}

function distanceLabel(row, holdingSide) {
  const spread = finiteNumber(row.spreadPct ?? row.gauge?.spreadPct);
  const lower = finiteNumber(row.lowerPct ?? row.gauge?.lowerPct);
  const upper = finiteNumber(row.upperPct ?? row.gauge?.upperPct);
  if (spread == null || lower == null || upper == null) return '行情待更新';
  if (holdingSide === 'H') return spread >= upper ? 'H→L 已触发' : `距 H→L ${formatSwitchPercent(upper - spread)}`;
  if (holdingSide === 'L') return spread <= lower ? 'L→H 已触发' : `距 L→H ${formatSwitchPercent(spread - lower)}`;
  return row.gauge?.triggered
    ? `${row.gauge?.directionLabel} 已触发`
    : `${row.gauge?.directionLabel || '距触发'} ${formatSwitchPercent(row.gauge?.distancePct)}`;
}

// PC 高密度列表视图。仅在 ≥1024px 渲染，窄屏由看板视图接管。
export function SwitchStrategyTable({
  rows,
  busyRuleId = '',
  testingRuleId = '',
  onToggle,
  onEdit,
  onTest,
  onDelete,
  onBacktest
}) {
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
              const busy = busyRuleId === row.id;
              const testing = testingRuleId === row.id;
              const holdingSide = row.holdingSide || 'H';
              return (
                <tr key={row.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2.5">
                    <span className="block max-w-[12rem] truncate text-xs font-bold text-slate-950">{row.name}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cx(
                      'inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-bold',
                      holdingSide === 'L'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : holdingSide === 'BOTH'
                          ? 'border-slate-200 bg-slate-100 text-slate-600'
                          : 'border-rose-200 bg-rose-50 text-rose-700'
                    )}>
                      {holdingLabel(row, holdingSide)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.enabled}
                      aria-label={row.enabled ? `暂停 ${row.name}` : `启用 ${row.name}`}
                      disabled={busy || testing}
                      onClick={() => onToggle?.(row)}
                      className={cx(
                        'whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                        row.enabled ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      )}
                    >
                      {row.enabled ? '监控中' : '已停用'}
                    </button>
                  </td>
                  <td className="px-3 py-2.5"><LegCell quotes={row.highQuotes} fallbackQuote={row.high} /></td>
                  <td className="px-3 py-2.5"><LegCell quotes={row.lowQuotes} fallbackQuote={row.low} /></td>
                  <td className="px-3 py-2.5">
                    <span className={cx('font-mono text-xs font-black tabular-nums', row.gauge?.triggered ? 'text-rose-600' : 'text-slate-900')}>
                      {row.hasQuote || row.spreadPct != null ? formatSwitchPercent(row.spreadPct ?? row.gauge?.spreadPct) : '—'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] tabular-nums text-slate-600">
                    <span className="text-emerald-600">{formatSwitchPercent(row.lowerPct ?? row.gauge?.lowerPct)}</span>
                    <span className="px-1 text-slate-300">/</span>
                    <span className="text-rose-600">{formatSwitchPercent(row.upperPct ?? row.gauge?.upperPct)}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-[11px] font-bold text-slate-700">{distanceLabel(row, holdingSide)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] tabular-nums text-slate-500">{formatSwitchDate(row.computedAt) || '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <button type="button" title="回测此策略" aria-label="回测此策略" disabled={busy || testing} onClick={() => onBacktest?.(row)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"><BarChart3 className="h-3.5 w-3.5" /></button>
                      <button type="button" title="编辑方案" aria-label="编辑方案" disabled={busy || testing} onClick={() => onEdit?.(row)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" title="测试方案" aria-label="测试方案" disabled={busy || testing} onClick={() => onTest?.(row)} className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-indigo-200 bg-white px-2 text-[11px] font-bold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50">
                        {testing ? '测试中…' : <FlaskConical className="h-3.5 w-3.5" />}
                      </button>
                      <button type="button" title="删除方案" aria-label="删除方案" disabled={busy || testing} onClick={() => onDelete?.(row)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>
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
