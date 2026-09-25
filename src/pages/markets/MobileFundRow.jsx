import { ChevronDown, ChevronUp } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { buildIdentityLine, formatRowCode, isOtcFundRow, resolveMetricDisplay } from './mobileFundMetrics.js';
import { formatRedeemFeeTiers, formatRedeemFeeRate, formatMarketPrice, formatPercent } from './marketDisplayUtils.js';

function feeNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveManagementFeeBreakdown(row) {
  const fee = row?.fundFee || {};
  const items = [
    { key: 'management', label: '管理费', value: feeNumber(row?.managementFeeRate ?? fee.managementFeeRate) },
    { key: 'custody', label: '托管费', value: feeNumber(row?.custodyFeeRate ?? fee.custodyFeeRate) },
    { key: 'salesService', label: '销售服务费', value: feeNumber(row?.salesServiceFeeRate ?? fee.salesServiceFeeRate) },
    { key: 'annual', label: '综合费率', value: feeNumber(row?.annualFeeRate ?? fee.annualFeeRate ?? row?.feeRate) },
  ];
  return items.some((item) => item.value != null) ? items : [];
}

function formatFeeComponentValue(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : '—';
}

function MetricCell({ metric }) {
  return (
    <div className="min-w-0 flex-1 text-left">
      <div className="truncate text-[10px] text-slate-400">{metric.label}</div>
      <div className={cx('mt-0.5 truncate text-[13px] font-semibold tabular-nums', metric.tone)}>{metric.text}</div>
    </div>
  );
}

export function MobileFundRow({ row, isOtcList = false, metricIds = [], expandedMetricIds = [], expanded = false, onToggleExpand, onOpenDetail, rowTestIdPrefix = 'market-row-mobile' }) {
  const isOtc = isOtcFundRow(row, isOtcList);
  const code = formatRowCode(row);
  const name = row?.name || code;
  const primary = metricIds.slice(0, 3).map((id) => resolveMetricDisplay(id, row));
  const secondary = expandedMetricIds.filter((id) => !metricIds.includes(id)).slice(0, 6).map((id) => resolveMetricDisplay(id, row));
  const managementFeeBreakdown = resolveManagementFeeBreakdown(row);
  const redeemFeeTiers = isOtc ? formatRedeemFeeTiers(row) : '';

  return (
    <article
      data-testid={rowTestIdPrefix ? `${rowTestIdPrefix}-${row.symbol}` : undefined}
      data-row-symbol={row.symbol}
      className={cx('border-b border-slate-100 px-3.5 py-3 transition', expanded && 'bg-indigo-50/20')}
    >
      <button type="button" onClick={() => onToggleExpand?.(row)} className="flex w-full flex-col gap-1.5 text-left" aria-expanded={expanded}>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="font-mono text-xs font-semibold tabular-nums text-slate-800">{code}</span>
            <span className="min-w-0 truncate text-[14px] font-medium leading-5 text-slate-900" title={name}>{name}</span>
            {row.isHeld ? (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                持仓
              </span>
            ) : null}
          </div>
          <span className="shrink-0 text-slate-400" aria-hidden>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
        </div>
        <div className="truncate text-[10px] leading-4 text-slate-400">{buildIdentityLine(row, isOtc) || row?.meta || ''}</div>
        
        <div className="flex items-baseline justify-between mt-1 pt-0.5">
          <div>
            <span className="text-[10px] text-slate-400 mr-1.5">最新价</span>
            <span className="font-mono text-lg font-bold tabular-nums text-slate-900">
              {formatMarketPrice(row?.price, row)}
            </span>
          </div>
          <div>
            {(() => {
              const pct = Number(row?.changePercent);
              if (!Number.isFinite(pct) || Math.abs(pct) < 0.0001) {
                return (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold tabular-nums bg-slate-100 text-slate-500 border border-slate-200/60">
                    0.00%
                  </span>
                );
              }
              if (pct > 0) {
                return (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold tabular-nums bg-rose-50 text-rose-600 border border-rose-200/60 shadow-2xs">
                    {formatPercent(row?.changePercent)}
                  </span>
                );
              }
              return (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold tabular-nums bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-2xs">
                  {formatPercent(row?.changePercent)}
                </span>
              );
            })()}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-slate-50/80 border border-slate-100/80 p-2">
          {primary.map((metric) => (
            <div key={metric.id} className="min-w-0 text-left">
              <div className="truncate text-[10px] text-slate-400">{metric.label}</div>
              <div className={cx('mt-0.5 truncate text-[13px] font-semibold tabular-nums', metric.tone)}>{metric.text}</div>
            </div>
          ))}
        </div>
      </button>

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          {secondary.length ? (
            <div className="grid grid-cols-3 gap-x-2 gap-y-2.5">
              {secondary.map((metric) => <MetricCell key={metric.id} metric={metric} />)}
            </div>
          ) : null}
          <div className="space-y-2 text-[11px] text-slate-500">
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
              <div className="mb-1 font-semibold text-slate-700">管理费明细</div>
              {managementFeeBreakdown.length ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {managementFeeBreakdown.map((item) => (
                    <span key={item.key} className="truncate">{item.label} {formatFeeComponentValue(item.value)}</span>
                  ))}
                </div>
              ) : <span className="text-slate-400">暂无费用数据</span>}
            </div>
            {isOtc ? (
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
                <div className="mb-1 font-semibold text-slate-700">赎回费明细</div>
                {redeemFeeTiers ? (
                  <div className="space-y-0.5">
                    {redeemFeeTiers.split('\n').map((tier, index) => <div key={`${tier}-${index}`} className="truncate">{tier}</div>)}
                  </div>
                ) : <span>{formatRedeemFeeRate(row)}</span>}
              </div>
            ) : null}
            {row.latestNavDate ? <div className="text-slate-400">净值更新 {row.latestNavDate}</div> : null}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onOpenDetail?.(row); }}
              className="inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white shadow-2xs hover:bg-indigo-700"
            >
              查看详情
            </button>
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onToggleExpand?.(row); }}
              className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
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
