import { isCnExchangeFundRow, normalizeCnFundCode } from './marketDisplayUtils.js';
import { isCnOtcFundQuote } from './marketFundMetrics.js';

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
  'drawdownPercentile',
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

/**
 * Compare/PK extras (fees, limits) only after the user adds compare symbols.
 * List pages must not call this path.
 */
export function shouldFetchComparePkExtras({
  market = '',
  compareCount = 0,
  includeFees = true,
  includeLimits = false,
} = {}) {
  if (String(market || '').toLowerCase() !== 'cn') {
    return { includeFundFees: false, includeFundLimits: false };
  }
  if (!Number(compareCount) || Number(compareCount) < 1) {
    return { includeFundFees: false, includeFundLimits: false };
  }
  return {
    includeFundFees: Boolean(includeFees),
    includeFundLimits: Boolean(includeLimits),
  };
}

export function isCnFundCompareInstrument(symbol, quote = null, { isMainOtc = false } = {}) {
  if (isCnExchangeFundRow({ symbol, code: symbol })) return true;
  if (isMainOtc) return true;
  return isCnOtcFundQuote(quote);
}

function quoteForCode(quoteMap = {}, symbol = '') {
  const raw = String(symbol || '').trim().toUpperCase();
  const code = normalizeCnFundCode(raw);
  return quoteMap[raw]
    || quoteMap[code]
    || quoteMap[`SH${code}`]
    || quoteMap[`SZ${code}`]
    || quoteMap[`BJ${code}`]
    || null;
}

export function shouldEnableComparePk({
  market = '',
  mainSymbol = '',
  mainQuote = null,
  compareSymbols = [],
  compareQuoteMap = {},
  isMainOtc = false,
  premiumMode = false,
} = {}) {
  if (String(market || '').toLowerCase() !== 'cn' || premiumMode) return false;
  if (!Array.isArray(compareSymbols) || compareSymbols.length < 1) return false;
  if (!isCnFundCompareInstrument(mainSymbol, mainQuote, { isMainOtc })) return false;
  return compareSymbols.every((symbol) => isCnFundCompareInstrument(symbol, quoteForCode(compareQuoteMap, symbol)));
}
