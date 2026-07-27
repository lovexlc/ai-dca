import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { COMPARE_COLORS, COMPARE_MAIN_COLOR } from './MarketChartPanel.jsx';
import { formatSymbolDisplay } from './marketDisplayUtils.js';
import {
  PK_GROUP_FEES,
  PK_GROUP_LIMITS,
  PK_GROUP_RETURNS,
  buildComparePkColumns,
  buildComparePkRows,
  groupComparePkRows,
  visiblePkGroups,
} from './fundComparePkData.js';

function columnColor(index) {
  if (index === 0) return COMPARE_MAIN_COLOR;
  return COMPARE_COLORS[(index - 1) % COMPARE_COLORS.length];
}

export function FundComparePkPanel({
  mainRow,
  compareSymbols = [],
  quoteMap = {},
  feeMap = {},
  limitMap = {},
  showLimits = false,
  loadingFees = false,
  loadingLimits = false,
  loadingQuotes = false,
  className = '',
}) {
  const groups = useMemo(() => visiblePkGroups({ showLimits }), [showLimits]);
  const [activeGroup, setActiveGroup] = useState(PK_GROUP_RETURNS);

  const effectiveGroup = groups.some((g) => g.key === activeGroup)
    ? activeGroup
    : (groups[0]?.key || PK_GROUP_RETURNS);

  const columns = useMemo(
    () => buildComparePkColumns({
      mainRow,
      compareSymbols,
      quoteMap,
      feeMap,
      limitMap,
    }),
    [mainRow, compareSymbols, quoteMap, feeMap, limitMap],
  );

  const rows = useMemo(
    () => buildComparePkRows({
      columns,
      showLimits,
      loadingFees,
      loadingLimits,
    }),
    [columns, showLimits, loadingFees, loadingLimits],
  );

  const grouped = useMemo(() => groupComparePkRows(rows), [rows]);
  const activeRows = grouped.find((g) => g.key === effectiveGroup)?.rows || [];
  const colCount = Math.max(columns.length, 1);
  const gridTemplate = `minmax(88px, 1.1fr) repeat(${colCount}, minmax(72px, 1fr))`;

  if (!compareSymbols.length || columns.length < 2) return null;

  return (
    <section
      className={cx(
        'mt-2 overflow-hidden rounded-xl border border-[rgba(17,24,39,0.08)] bg-white',
        className,
      )}
      data-testid="fund-compare-pk-panel"
      aria-label="基金指标对比"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[rgba(17,24,39,0.08)] px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-[var(--market-text-strong)] sm:text-[14px]">指标对比</h3>
          <p className="mt-0.5 text-[11px] text-[var(--market-text-muted)] sm:text-[12px]">
            涨幅优先净值口径；最优值高亮
          </p>
        </div>
        {(loadingQuotes || loadingFees || loadingLimits) ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--market-text-muted)] sm:text-[12px]">
            <Loader2 size={12} className="animate-spin" />
            加载中
          </span>
        ) : null}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-[rgba(17,24,39,0.06)] px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((group) => {
          const selected = group.key === effectiveGroup;
          return (
            <button
              key={group.key}
              type="button"
              onClick={() => setActiveGroup(group.key)}
              className={cx(
                'shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold transition sm:text-[13px]',
                selected
                  ? 'bg-[var(--market-accent-soft)] text-[var(--market-accent)]'
                  : 'text-[var(--market-text-muted)] hover:bg-[var(--market-surface-muted)] hover:text-[var(--market-text-strong)]',
              )}
              data-pk-group={group.key}
            >
              {group.label}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[320px]">
          <div
            className="grid items-center gap-1 border-b border-[rgba(17,24,39,0.08)] bg-[var(--market-surface-subtle)] px-2 py-2 text-[11px] font-semibold text-[var(--market-text-muted)] sm:gap-2 sm:px-3 sm:text-[12px]"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div className="text-left">指标</div>
            {columns.map((col, index) => (
              <div key={col.symbol} className="min-w-0 text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <span className="size-1.5 shrink-0 rounded-sm" style={{ background: columnColor(index) }} />
                  <span className="truncate font-bold text-[var(--market-text-strong)]">
                    {formatSymbolDisplay(col.symbol)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[10px] font-medium text-[var(--market-text-subtle)] sm:text-[11px]">
                  {col.name}
                </div>
              </div>
            ))}
          </div>

          {activeRows.length ? activeRows.map((row) => (
            <div
              key={row.id}
              className="grid items-center gap-1 border-b border-[rgba(17,24,39,0.06)] px-2 py-2 text-[12px] sm:gap-2 sm:px-3 sm:text-[13px]"
              style={{ gridTemplateColumns: gridTemplate }}
              data-pk-row={row.id}
            >
              <div className="min-w-0 truncate text-left font-medium text-[var(--market-text-muted)]">
                {row.label}
              </div>
              {row.cells.map((cell, index) => {
                const isBest = row.bestIndexes.includes(index);
                const isPercent = row.type === 'percent';
                const n = Number(cell.raw);
                const tone = isPercent && Number.isFinite(n) && n !== 0
                  ? (n > 0 ? 'text-[var(--market-rise)]' : 'text-[var(--market-fall)]')
                  : 'text-[var(--market-text-strong)]';
                return (
                  <div
                    key={`${row.id}-${cell.symbol}`}
                    className={cx(
                      'min-w-0 text-right tabular-nums font-semibold leading-snug',
                      tone,
                      isBest && 'rounded-md bg-[var(--market-accent-soft)] px-1 py-0.5',
                    )}
                    title={cell.text}
                  >
                    <span className="line-clamp-2 break-words">{cell.text}</span>
                  </div>
                );
              })}
            </div>
          )) : (
            <div className="px-3 py-8 text-center text-[13px] text-[var(--market-text-muted)]">
              暂无该分组数据
            </div>
          )}
        </div>
      </div>

      {effectiveGroup === PK_GROUP_FEES ? (
        <div className="border-t border-[rgba(17,24,39,0.06)] px-3 py-2 text-[11px] text-[var(--market-text-subtle)] sm:text-[12px]">
          综合费率含管理/托管/销售服务费；申购取规则表较低档，赎回为持有期档位摘要。
        </div>
      ) : null}
      {effectiveGroup === PK_GROUP_LIMITS ? (
        <div className="border-t border-[rgba(17,24,39,0.06)] px-3 py-2 text-[11px] text-[var(--market-text-subtle)] sm:text-[12px]">
          限额来自场外申购规则，仅供参考；以销售平台实时披露为准。
        </div>
      ) : null}
      {effectiveGroup === PK_GROUP_RETURNS ? (
        <div className="border-t border-[rgba(17,24,39,0.06)] px-3 py-2 text-[11px] text-[var(--market-text-subtle)] sm:text-[12px]">
          场外为净值涨幅；与场内价格涨幅混比时请注意口径差异。
        </div>
      ) : null}
    </section>
  );
}
