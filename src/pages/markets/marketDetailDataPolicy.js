import { normalizeCnFundCode } from './marketDisplayUtils.js';

export function shouldFetchXueqiuFundDetail({ market, symbol, activeTab, isOtcList = false }) {
  if (market !== 'cn') return false;
  if (activeTab !== 'fundFlow' && activeTab !== 'fundReport') return false;
  const code = normalizeCnFundCode(symbol);
  if (!/^\d{6}$/.test(code)) return false;
  if (isOtcList) return false;
  return true;
}

export function shouldFetchMarketNews({ market }) {
  return market === 'us';
}

export function isMarketListColumnVisible(visibility = {}, id) {
  return visibility?.[id] !== false;
}

export function shouldFetchFundFeesForVisibility(visibility = {}) {
  return isMarketListColumnVisible(visibility, 'feeRate') || isMarketListColumnVisible(visibility, 'redeemFeeRate');
}

export function shouldFetchFundLimitsForVisibility(visibility = {}) {
  return isMarketListColumnVisible(visibility, 'limit');
}

export function shouldFetchPremiumSnapshotsForVisibility(visibility = {}) {
  return isMarketListColumnVisible(visibility, 'premium');
}

export function shouldFetchHighPointSnapshotsForVisibility(visibility = {}) {
  return isMarketListColumnVisible(visibility, 'closeHighDrawdown');
}

const LIST_HISTORY_METRIC_COLUMNS = [
  'closeHighDrawdown',
  'historicalPercentile',
  'currentYearPercent',
  'return1w',
  'return1m',
  'return3m',
  'return6m',
  'return1y',
  'returnBase',
];

const SORT_HISTORY_METRIC_COLUMNS = new Set([
  'historicalPercentile',
  'currentYearPercent',
  'return1w',
  'return1m',
  'return3m',
  'return6m',
  'return1y',
  'returnBase',
]);

/**
 * Sorting needs complete values for every row in the active list.  Keep this
 * policy limited to list-level enhancements; detail endpoints such as K-line
 * history, financials, and fund detail are intentionally excluded.
 */
export function buildMarketSortFetchPolicy({
  sorting = [],
  showLimitColumn = false,
  hidePremiumColumn = false,
} = {}) {
  const ids = new Set((Array.isArray(sorting) ? sorting : [])
    .map((item) => String(item?.id || '').trim())
    .filter(Boolean));

  return {
    includeFundFees: ids.has('feeRate') || ids.has('redeemFeeRate'),
    includePremiumSnapshots: !hidePremiumColumn && ids.has('premium'),
    includeHighPointSnapshots: ids.has('closeHighDrawdown'),
    includeFundLimits: Boolean(showLimitColumn) && ids.has('limit'),
    includeListHistoryMetrics: Array.from(ids).some((id) => SORT_HISTORY_METRIC_COLUMNS.has(id)),
  };
}

export function shouldFetchListHistoryMetricsForVisibility(visibility = {}, { hideTrendColumn = false } = {}) {
  if (!hideTrendColumn && isMarketListColumnVisible(visibility, 'trend')) return true;
  return LIST_HISTORY_METRIC_COLUMNS.some((id) => isMarketListColumnVisible(visibility, id));
}

export function buildMarketListFetchPolicy({
  visibility = {},
  showLimitColumn = false,
  hidePremiumColumn = false,
  hideTrendColumn = false,
} = {}) {
  return {
    includeFundFees: shouldFetchFundFeesForVisibility(visibility),
    includePremiumSnapshots: !hidePremiumColumn && shouldFetchPremiumSnapshotsForVisibility(visibility),
    includeHighPointSnapshots: shouldFetchHighPointSnapshotsForVisibility(visibility),
    includeFundLimits: Boolean(showLimitColumn) && shouldFetchFundLimitsForVisibility(visibility),
    includeListHistoryMetrics: shouldFetchListHistoryMetricsForVisibility(visibility, { hideTrendColumn }),
  };
}

export function shouldRenderMarketsSidebar({ mobileHidden = false, desktopHidden = false } = {}) {
  return !(mobileHidden && desktopHidden);
}

export function shouldFetchDetailNavHistory({ market, symbol, cnFundParam = 'price', isCnOtcFund = false } = {}) {
  if (market !== 'cn') return false;
  if (!symbol) return false;
  return Boolean(isCnOtcFund || cnFundParam !== 'price');
}

export function shouldFetchCnEtfPremiumSnapshot({ market, symbol, cnFundParam = 'price', isCnOtcFund = false } = {}) {
  if (market !== 'cn') return false;
  if (!symbol) return false;
  if (isCnOtcFund) return false;
  return cnFundParam === 'premium';
}
