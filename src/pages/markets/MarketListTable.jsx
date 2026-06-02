import { cx } from '../../components/experience-ui.jsx';
import { Sparkline } from '../../components/markets/Sparkline.jsx';
import {
  changeToneClass,
  feeRateToneClass,
  formatFeeRate,
  formatNumber,
  formatPercent,
  formatPremiumPercent,
  formatSymbolDisplay,
  formatTotalShares,
  formatYearPercent,
  resolvePremiumPercent
} from './marketDisplayUtils.js';
import {
  formatSwitchLimitAmount,
  switchLimitToneFor,
  switchLimitLabelFor,
} from '../switchStrategyHelpers.js';

export function MarketListTable({ rows = [], klineMap = {}, selectedSymbol = '', onSelect, compact = false, stickyHeader = false, stickyFirstColumn = false, showLimitColumn = false }) {
  if (!rows.length) {
    return <p className="px-2 py-2 text-sm text-[#5f6368]">未配置自选。</p>;
  }
  const cellPad = compact ? 'px-2 py-2' : 'px-3 py-2';
  const stickyHeadCell = stickyFirstColumn
    ? 'sticky left-0 z-20 border-r border-[#e8eaed] bg-[#f8fafd] shadow-[8px_0_12px_-12px_rgba(60,64,67,0.45)]'
    : '';
  const stickyBodyCell = (selected) => stickyFirstColumn
    ? cx('sticky left-0 z-10 border-r border-[#e8eaed] shadow-[8px_0_12px_-12px_rgba(60,64,67,0.35)]', selected ? 'bg-[#e8f0fe]' : 'bg-white group-hover:bg-[#f1f3f4]')
    : '';
  return (
    <div className={cx('overflow-x-auto', compact ? 'rounded-xl border border-[#e8eaed] bg-white' : 'rounded-2xl border border-[#e8eaed] bg-white shadow-sm')}>
      <table className={cx('w-full min-w-[980px] border-separate border-spacing-0 text-sm', compact && 'min-w-[900px] text-[12px]')}>
        <thead className={cx('bg-[#f8fafd] text-[11px] font-semibold text-[#5f6368]', stickyHeader && 'sticky top-0 z-10')}>
          <tr>
            <th className={cx(cellPad, 'text-left', stickyHeadCell)}>代码</th>
            <th className={cx(cellPad, 'text-left')}>名称</th>
            <th className={cx(cellPad, 'text-right')}>最新价</th>
            <th className={cx(cellPad, 'text-right')}>涨跌幅</th>
            {showLimitColumn ? <th className={cx(cellPad, 'text-right')}>限额</th> : null}
            <th className={cx(cellPad, 'text-right')}>溢价</th>
            <th className={cx(cellPad, 'text-right')}>年内涨幅</th>
            <th className={cx(cellPad, 'text-right')}>总份额</th>
            <th className={cx(cellPad, 'text-right')}>费率</th>
            <th className={cx(cellPad, 'text-right')}>趋势</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e8eaed]">
          {rows.map((row) => {
            const displaySymbol = formatSymbolDisplay(row.symbol);
            const pct = Number(row.changePercent);
            const flat = !Number.isFinite(pct) || Math.abs(pct) < 0.0001;
            const up = pct > 0;
            const premiumPct = resolvePremiumPercent(row);
            const selected = row.symbol === selectedSymbol;
            return (
              <tr
                key={row.symbol}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                onClick={() => onSelect?.(row)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect?.(row);
                  }
                }}
                className={cx(
                  'group cursor-pointer transition hover:bg-[#f1f3f4] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30',
                  selected && 'bg-[#e8f0fe] hover:bg-[#e8f0fe]'
                )}
              >
                <td className={cx(cellPad, 'w-[88px] whitespace-nowrap font-mono text-xs font-semibold text-[#1f1f1f]', stickyBodyCell(selected))}>{displaySymbol}</td>
                <td className={cx(cellPad, 'min-w-[120px] text-[#1f1f1f]')}>
                  <div className="truncate font-medium">{row.name || displaySymbol}</div>
                  {row.meta ? <div className="truncate text-[10px] text-[#5f6368]">{row.meta}</div> : null}
                </td>
                <td className={cx(cellPad, 'whitespace-nowrap text-right tabular-nums text-[#1f1f1f]')}>{formatNumber(row.price)}</td>
                <td className={cx(cellPad, 'whitespace-nowrap text-right font-semibold tabular-nums', flat ? 'text-[#5f6368]' : up ? 'text-[#a50e0e]' : 'text-[#137333]')}>{formatPercent(row.changePercent)}</td>
                {showLimitColumn ? (
                  <td className={cx(cellPad, 'whitespace-nowrap text-right text-xs')}>
                    {row.fundLimit ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={cx(
                          'inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                          switchLimitToneFor(row.fundLimit.buyStatus) === 'emerald' ? 'bg-emerald-50 text-emerald-700' :
                          switchLimitToneFor(row.fundLimit.buyStatus) === 'amber' ? 'bg-amber-50 text-amber-700' :
                          switchLimitToneFor(row.fundLimit.buyStatus) === 'red' ? 'bg-red-50 text-red-700' :
                          'bg-slate-50 text-slate-500'
                        )}>{switchLimitLabelFor(row.fundLimit.buyStatus)}</span>
                        {Number(row.fundLimit.maxPurchasePerDay) > 0 ? (
                          <span className="tabular-nums text-[#5f6368]">{formatSwitchLimitAmount(row.fundLimit.maxPurchasePerDay)}</span>
                        ) : null}
                      </div>
                    ) : <span className="text-[#9aa0a6]">—</span>}
                  </td>
                ) : null}
                <td className={cx(cellPad, 'whitespace-nowrap text-right font-semibold tabular-nums', changeToneClass(premiumPct))}>{formatPremiumPercent(row)}</td>
                <td className={cx(cellPad, 'whitespace-nowrap text-right font-semibold tabular-nums', changeToneClass(Number(row.currentYearPercent)))}>{formatYearPercent(row)}</td>
                <td className={cx(cellPad, 'whitespace-nowrap text-right tabular-nums text-[#1f1f1f]')}>{formatTotalShares(row.totalShares)}</td>
                <td className={cx(cellPad, 'whitespace-nowrap text-right font-semibold tabular-nums', feeRateToneClass(row))}>{formatFeeRate(row)}</td>
                <td className={cx(cellPad, 'text-right')}>
                  <div className="inline-flex justify-end">
                    <Sparkline points={klineMap[row.symbol]} width={compact ? 72 : 86} height={compact ? 24 : 26} tone={flat ? 'flat' : up ? 'up' : 'down'} showFill markLast />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
