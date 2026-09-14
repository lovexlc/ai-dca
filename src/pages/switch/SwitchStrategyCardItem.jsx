import { BarChart3, Copy, NotebookPen, Pencil, Trash2 } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { formatSwitchDate, formatSwitchPercent, formatSwitchPrice } from '../switchStrategyHelpers.js';
import { resolveCnFundName } from '../markets/marketsCatalog.js';
import { SWITCH_CHANNEL_DEFS } from './switchBoardModel.js';
import { SwitchStrategySpreadGauge } from './SwitchStrategySpreadGauge.jsx';

function QuoteLeg({ quote }) {
  const isHigh = quote.side === 'H';
  const name = quote.name || (quote.code ? resolveCnFundName(quote.code) : '');
  const premium = Number(quote.premiumPct);
  return (
    <div className={cx('min-w-0 rounded-xl border p-2.5', isHigh ? 'border-rose-100 bg-rose-50/60' : 'border-emerald-100 bg-emerald-50/60')}>
      <div className="flex items-center justify-between gap-1.5">
        <span className={cx('whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-black leading-none', isHigh ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700')}>
          {quote.side} 组
        </span>
        <span className="truncate font-mono text-[11px] font-bold text-slate-500">{quote.code || '未配置'}</span>
      </div>
      <div className="mt-1.5 truncate text-xs font-semibold text-slate-700">{name || '等待行情'}</div>
      <div className="mt-1 flex items-baseline justify-between gap-1.5">
        <span className="font-mono text-sm font-black tabular-nums text-slate-900">{formatSwitchPrice(quote.price)}</span>
        <span
          className={cx(
            'whitespace-nowrap font-mono text-[11px] font-bold tabular-nums',
            !Number.isFinite(premium) ? 'text-slate-400' : premium >= 0 ? 'text-rose-600' : 'text-emerald-600'
          )}
        >
          {Number.isFinite(premium) ? formatSwitchPercent(premium, 2, true) : '—'}
        </span>
      </div>
    </div>
  );
}

function IconAction({ icon: Icon, label, onClick, disabled, tone = 'slate' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cx(
        'inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border bg-white transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'rose' ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function SwitchStrategyCardItem({ row, busy = false, onToggle, onEdit, onDuplicate, onDelete, onBacktest, onQuickTrade }) {
  const channelLabels = SWITCH_CHANNEL_DEFS.filter((item) => row.channels.includes(item.key)).map((item) => item.label);

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-2 px-3.5 pb-2.5 pt-3.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-black text-slate-950">{row.name}</h3>
          <span
            className={cx(
              'mt-1.5 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold leading-none',
              row.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
            )}
          >
            <span className={cx('h-1.5 w-1.5 rounded-full', row.enabled ? 'bg-emerald-500' : 'bg-slate-300')} />
            {row.enabled ? '监控中' : '已停用'}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={row.enabled}
          aria-label={row.enabled ? `暂停 ${row.name}` : `启用 ${row.name}`}
          disabled={busy}
          onClick={onToggle}
          className={cx(
            'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60',
            row.enabled ? 'bg-indigo-600' : 'bg-slate-200'
          )}
        >
          <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', row.enabled ? 'left-[22px]' : 'left-0.5')} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 px-3.5">
        <QuoteLeg quote={row.high} />
        <QuoteLeg quote={row.low} />
      </div>

      <div className="px-3.5 pt-2.5">
        <SwitchStrategySpreadGauge gauge={row.gauge} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-3.5 pt-2.5 text-[11px] text-slate-500">
        {channelLabels.length ? (
          <span className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 font-bold text-slate-600">{channelLabels.join(', ')}</span>
        ) : (
          <span className="whitespace-nowrap rounded-md bg-amber-50 px-1.5 py-0.5 font-bold text-amber-700">未选渠道</span>
        )}
        <span className="whitespace-nowrap font-mono tabular-nums">{formatSwitchDate(row.computedAt)}</span>
        <span className="whitespace-nowrap">命中 {row.hitCount} 次</span>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-1.5 px-3.5 pb-3.5 pt-2.5">
        <div className="flex items-center gap-1.5">
          <IconAction icon={BarChart3} label="回测此策略" onClick={() => onBacktest?.(row)} disabled={busy} />
          <IconAction icon={NotebookPen} label="快速记录交易" onClick={() => onQuickTrade?.(row)} disabled={busy} />
        </div>
        <div className="flex items-center gap-1.5">
          <IconAction icon={Pencil} label="编辑方案" onClick={() => onEdit?.(row)} disabled={busy} />
          <IconAction icon={Copy} label="复制方案" onClick={() => onDuplicate?.(row)} disabled={busy} />
          <IconAction icon={Trash2} label="删除方案" tone="rose" onClick={() => onDelete?.(row)} disabled={busy} />
        </div>
      </div>
    </article>
  );
}

export default SwitchStrategyCardItem;
