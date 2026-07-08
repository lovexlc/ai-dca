import { normalizeCnFundCode } from './marketDisplayUtils.js';

export function shouldFetchXueqiuFundDetail({ market, symbol, activeTab, hasNasdaqOtcFund }) {
  if (market !== 'cn') return false;
  if (activeTab !== 'fundFlow' && activeTab !== 'fundReport') return false;
  const code = normalizeCnFundCode(symbol);
  if (!/^\d{6}$/.test(code)) return false;
  if (typeof hasNasdaqOtcFund === 'function' && hasNasdaqOtcFund(code)) return false;
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
  return isMarketListColumnVisible(visibility, 'highDrawdown')
    || isMarketListColumnVisible(visibility, 'closeHighDrawdown');
}

const LIST_HISTORY_METRIC_COLUMNS = [
  'highDrawdown',
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
