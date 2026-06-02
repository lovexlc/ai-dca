import { formatNav, formatShares } from '../../app/holdingsHelpers.js';

export function buildAggregateHoldingsTsv({ aggregates, kindFilter, searchText }) {
  const searchNeedle = String(searchText || '').trim().toLowerCase();
  const filtered = (Array.isArray(aggregates) ? aggregates : []).filter((agg) => {
    if (!agg.hasPosition) return false;
    if (kindFilter !== 'all' && agg.kind !== kindFilter) return false;
    if (!searchNeedle) return true;
    return String(agg.code || '').toLowerCase().includes(searchNeedle)
      || String(agg.name || '').toLowerCase().includes(searchNeedle);
  });
  const header = ['基金代码', '基金名称', '标签', '总份额', '平均成本', '当前价格', '总市值', '总收益(元)', '总收益率', '当日收益(元)', '当日收益率'];
  const rows = filtered.map((agg) => {
    const kindLabel = agg.kind === 'exchange' ? '场内' : '场外';
    return [
      agg.code,
      agg.name || '',
      kindLabel,
      formatShares(agg.totalShares),
      formatNav(agg.avgCost),
      agg.hasCurrentPrice ? formatNav(agg.currentPrice ?? agg.latestNav) : '',
      agg.hasCurrentPrice ? agg.marketValue.toFixed(2) : '',
      agg.hasCurrentPrice ? agg.unrealizedProfit.toFixed(2) : '',
      agg.hasCurrentPrice ? `${agg.unrealizedReturnRate.toFixed(2)}%` : '',
      agg.hasCurrentPrice ? (agg.hasTodayNav ? agg.todayProfit : 0).toFixed(2) : '',
      agg.hasCurrentPrice ? `${(agg.hasTodayNav ? agg.todayReturnRate : 0).toFixed(2)}%` : ''
    ].join('\t');
  });
  return { count: filtered.length, tsv: [header.join('\t'), ...rows].join('\n') };
}
