import { cx } from '../../components/experience-ui.jsx';
import { formatSwitchDate, formatSwitchPercent, formatSwitchPrice } from '../switchStrategyHelpers.js';
import { resolveCnFundName } from '../markets/marketsCatalog.js';
import { SwitchStrategySpreadGauge } from './SwitchStrategySpreadGauge.jsx';

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function holdingLabel(row, holdingSide) {
  const codes = Array.isArray(row.holdingCodes) ? row.holdingCodes : [];
  if (holdingSide === 'BOTH') return `双向监控（${codes.length || '全部'}）`;
  const fallback = holdingSide === 'L' ? row.lowCode : row.highCode;
  const first = codes[0] || fallback || '未配置';
  return `持仓 ${holdingSide}（${first}${codes.length > 1 ? ` 等${codes.length}只` : ''}）`;
}

function LegGroup({ side, quotes, fallbackQuote }) {
  const items = Array.isArray(quotes) && quotes.length ? quotes : [fallbackQuote].filter(Boolean);
  const isHigh = side === 'H';
  return (
    <div className={cx('min-w-0 space-y-2', !isHigh && 'border-l border-slate-200 pl-2')}>
      {items.length ? items.map((quote) => {
        const name = quote?.name || (quote?.code ? resolveCnFundName(quote.code) : '');
        const premium = finiteNumber(quote?.premiumPct);
        const price = finiteNumber(quote?.price);
        return (
          <div key={quote?.code || name} className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-1">
              <span className={cx(
                'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-[9px] font-bold',
                isHigh ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
              )}>{side}</span>
              <span className="truncate font-medium text-slate-700">{quote?.code || '未配置'} {name}</span>
            </div>
            <div className="flex items-baseline justify-between gap-1 pr-1">
              <span className="font-mono text-xs font-semibold text-slate-900 sm:text-sm">
                {price == null ? '—' : formatSwitchPrice(price)}
              </span>
              <span className={cx(
                'font-mono text-[10px] font-medium sm:text-[11px]',
                isHigh ? 'text-rose-600' : 'text-emerald-600'
              )}>
                {premium == null ? '—' : formatSwitchPercent(premium, 2, true)}
              </span>
            </div>
          </div>
        );
      }) : <span className="text-[11px] text-slate-400">未配置</span>}
    </div>
  );
}

export function SwitchStrategyCardItem({
  row,
  busy = false,
  testing = false,
  onToggle,
  onEdit,
  onTest,
  onDelete
}) {
  const holdingSide = row.holdingSide || 'H';
  const computedAt = formatSwitchDate(row.computedAt);

  return (
    <div className="group flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs transition-all hover:border-indigo-300">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-3.5 py-2.5 sm:px-4 sm:py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="truncate text-xs font-bold text-slate-900 sm:text-sm">{row.name}</h3>
          <span className={cx('rounded-full border px-1.5 py-0.5 text-[10px] font-medium', row.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-slate-100 text-slate-400')}>
            {row.enabled ? '监控中' : '已暂停'}
          </span>
          <span className={cx(
            'rounded border px-1.5 py-0.5 text-[10px] font-bold',
            holdingSide === 'L'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : holdingSide === 'BOTH'
                ? 'border-slate-200 bg-slate-100 text-slate-600'
                : 'border-rose-200 bg-rose-50 text-rose-700'
          )}>
            {holdingLabel(row, holdingSide)}
          </span>
        </div>
        <label className="relative ml-2 inline-flex shrink-0 cursor-pointer items-center">
          <input
            type="checkbox"
            checked={Boolean(row.enabled)}
            disabled={busy || testing}
            onChange={onToggle}
            className="peer sr-only"
          />
          <div className="peer h-4.5 w-8 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-3.5 after:w-3.5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-indigo-600 peer-checked:after:translate-x-full peer-checked:after:border-white sm:h-5 sm:w-9 sm:after:h-4 sm:after:w-4"></div>
        </label>
      </div>

      <div className="space-y-2.5 p-3 sm:space-y-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs sm:p-2.5">
          <LegGroup side="H" quotes={row.highQuotes} fallbackQuote={row.high} />
          <LegGroup side="L" quotes={row.lowQuotes} fallbackQuote={row.low} />
        </div>

        <SwitchStrategySpreadGauge gauge={row.gauge} holdingSide={holdingSide} />
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-3.5 py-2 text-[11px] text-slate-500 sm:px-4 sm:py-2.5">
        <div className="flex items-center gap-1.5 font-mono text-[10px] sm:text-xs">
          <span>{computedAt || '行情待更新'}</span>
          <span>•</span>
          <span>今日命中 <b className="text-indigo-600">{Number(row.hitCount) || 0}</b> 次</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" disabled={busy || testing} onClick={() => onEdit?.(row)} className="cursor-pointer rounded px-2 py-0.5 text-slate-600 hover:text-indigo-600 disabled:opacity-50">编辑</button>
          <button type="button" disabled={busy || testing} onClick={() => onTest?.(row)} className="cursor-pointer rounded px-2 py-0.5 font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
            {testing ? '测试中…' : '测试'}
          </button>
          <button type="button" disabled={busy || testing} onClick={() => onDelete?.(row)} className="cursor-pointer rounded px-2 py-0.5 text-slate-400 hover:text-rose-600 disabled:opacity-50">删除</button>
        </div>
      </div>
    </div>
  );
}

export default SwitchStrategyCardItem;
