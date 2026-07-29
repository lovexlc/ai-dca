import { ChevronDown, ChevronUp } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import {
  buildIdentityLine,
  formatRowCode,
  isOtcFundRow,
  resolveMetricDisplay,
} from './mobileFundMetrics.js';
import {
  formatFeeComponentValue,
  formatRedeemFeeTiers,
  formatRedeemFeeRate,
  resolveManagementFeeBreakdown,
} from './marketDisplayUtils.js';

function MetricCell({ metric }) {
  return (
    <div className="min-w-0 flex-1 text-left">
      <div className="truncate text-[11px] leading-4 text-[var(--market-text-muted)]">{metric.label}</div>
      <div className={cx('mt-0.5 truncate text-[15px] font-semibold leading-5 tabular-nums', metric.tone)}>
        {metric.text}
      </div>
    </div>
  );
}

export function MobileFundRow({
  row,
  isOtcList = false,
  metricIds = [],
  expandedMetricIds = [],
  expanded = false,
  onToggleExpand,
  onOpenDetail,
  rowTestIdPrefix = 'market-row-mobile',
}) {
  const isOtc = isOtcFundRow(row, isOtcList);
  const code = formatRowCode(row);
  const name = row?.name || code;
  const identity = buildIdentityLine(row, isOtc) || row?.meta || '';
  const primary = (metricIds || []).slice(0, 3).map((id) => resolveMetricDisplay(id, row));
  const secondaryIds = (expandedMetricIds || []).filter((id) => !(metricIds || []).includes(id)).slice(0, 6);
  const secondary = secondaryIds.map((id) => resolveMetricDisplay(id, row));
  const managementFeeBreakdown = resolveManagementFeeBreakdown(row);
  const redeemFeeTiers = isOtc ? formatRedeemFeeTiers(row) : '';

  return (
    <article
      data-testid={rowTestIdPrefix ? `${rowTestIdPrefix}-${row.symbol}` : undefined}
      data-row-symbol={row.symbol}
      className={cx(
        'border-b border-[var(--market-border)] bg-white px-3 py-2.5 transition',
        !expanded && 'min-h-[104px]',
        expanded && 'bg-[var(--market-accent-soft)]/40'
      )}
    >
      <button
        type="button"
        onClick={() => onToggleExpand?.(row)}
        className="flex w-full flex-col gap-1.5 text-left"
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cx(
              'w-16 shrink-0 font-mono text-[13px] font-semibold tabular-nums',
              row.isHeld ? 'text-[var(--market-rise)]' : 'text-[var(--market-text-strong)]'
            )}
          >
            {code}
          </span>
          <span
            className={cx(
              'min-w-0 flex-1 truncate text-[14px] font-medium leading-5',
              row.isHeld ? 'text-[var(--market-rise)]' : 'text-[var(--market-text-strong)]'
            )}
            title={name}
          >
            {name}
          </span>
          {row.isHeld ? (
            <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--market-rise)]">
              持仓
            </span>
          ) : null}
          <span className="shrink-0 text-[var(--market-text-muted)]" aria-hidden>
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </div>

        <div className="truncate pl-[4.5rem] text-[11px] leading-4 text-[var(--market-text-muted)]">
          {identity}
        </div>

        <div className="mt-1 flex items-start gap-2 pl-0">
          {primary.map((metric) => (
            <MetricCell key={metric.id} metric={metric} />
          ))}
        </div>
      </button>

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-[var(--market-border)]/70 pt-3">
          {secondary.length ? (
            <div className="grid grid-cols-3 gap-x-2 gap-y-2.5">
              {secondary.map((metric) => (
                <MetricCell key={metric.id} metric={metric} />
              ))}
            </div>
          ) : null}

          <div className="space-y-2 text-[11px] text-[var(--market-text-muted)]">
            <div className="rounded-xl bg-[var(--market-surface-muted)]/70 px-3 py-2">
              <div className="mb-1 font-semibold text-[var(--market-text-strong)]">管理费明细</div>
              {managementFeeBreakdown.length ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {managementFeeBreakdown.map((item) => (
                    <span key={item.key} className="truncate">
                      {item.label} {formatFeeComponentValue(item.value)}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-[var(--market-text-subtle)]">暂无费用数据</span>
              )}
            </div>

            {isOtc ? (
              <div className="rounded-xl bg-[var(--market-surface-muted)]/70 px-3 py-2">
                <div className="mb-1 font-semibold text-[var(--market-text-strong)]">赎回费明细</div>
                {redeemFeeTiers ? (
                  <div className="space-y-0.5">
                    {redeemFeeTiers.split('\n').map((tier, index) => (
                      <div key={`${tier}-${index}`} className="truncate">{tier}</div>
                    ))}
                  </div>
                ) : (
                  <span>{formatRedeemFeeRate(row)}</span>
                )}
              </div>
            ) : null}

            {row.latestNavDate ? (
              <div className="text-[var(--market-text-subtle)]">净值更新 {row.latestNavDate}</div>
            ) : null}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenDetail?.(row);
              }}
              className="inline-flex h-9 flex-1 items-center justify-center rounded-full bg-[var(--market-accent)] px-3 text-sm font-semibold text-white"
            >
              查看详情
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand?.(row);
              }}
              className="inline-flex h-9 items-center justify-center rounded-full border border-[var(--market-border-strong)] px-3 text-sm font-medium text-[var(--market-text-muted)]"
            >
              收起
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default MobileFundRow;
