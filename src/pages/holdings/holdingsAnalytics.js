import { readColumnFilterValue } from './tableFilters.js';

export function buildHoldingsAnalyticsSummary({
  transactions,
  aggregates,
  aggregatesTableData,
  soldLots,
  columnFilters,
  selectedCode,
  embedded,
} = {}) {
  const kindFilterValue = readColumnFilterValue(columnFilters, 'kind');
  return {
    transactionCount: Array.isArray(transactions) ? transactions.length : 0,
    aggregateCount: Array.isArray(aggregates) ? aggregates.length : 0,
    activePositionCount: Array.isArray(aggregatesTableData) ? aggregatesTableData.length : 0,
    soldLotCount: Array.isArray(soldLots) ? soldLots.length : 0,
    hasSearch: Boolean(String(readColumnFilterValue(columnFilters, 'name') || '').trim()),
    kindFilter: Array.isArray(kindFilterValue) && kindFilterValue.length
      ? kindFilterValue.join(',')
      : 'all',
    selected: Boolean(selectedCode),
    embedded,
  };
}
