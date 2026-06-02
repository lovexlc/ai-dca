import {
  CN_ETF_WATCHLIST_PRESETS,
  CN_OTC_WATCHLIST_PRESETS
} from '../../app/marketsApi.js';
import nasdaqOtcCatalog from '../../../data/all_nasdq_otc.json' with { type: 'json' };
import { formatNumber, formatSymbolDisplay, normalizeCnFundCode } from './marketDisplayUtils.js';
import {
  buildOtcCandidate as buildOtcCandidateBase,
  buildOtcFundQuoteFromSnapshot as buildOtcFundQuoteFromSnapshotBase,
  formatBrowserTitleForQuote as formatBrowserTitleForQuoteBase,
  normalizeSearchResults as normalizeSearchResultsBase,
  resolveCnFundName as resolveCnFundNameBase,
} from './marketOtcHelpers.js';

export const CN_ETF_PRESET_MAP = Object.fromEntries(
  CN_ETF_WATCHLIST_PRESETS.map((item) => [item.symbol, item])
);

export const CN_OTC_PRESET_MAP = Object.fromEntries(
  CN_OTC_WATCHLIST_PRESETS.map((item) => [item.symbol, item])
);

export const NASDAQ_OTC_FUND_MAP = Object.fromEntries(
  ((nasdaqOtcCatalog && nasdaqOtcCatalog.funds) || []).map((item) => [String(item.code || '').trim(), item])
);

export function hasNasdaqOtcFund(codeOrSymbol) {
  const code = normalizeCnFundCode(codeOrSymbol);
  return Boolean(code && NASDAQ_OTC_FUND_MAP[code]);
}

export function resolveCnFundName(codeOrSymbol, fallback = '') {
  return resolveCnFundNameBase(codeOrSymbol, fallback, NASDAQ_OTC_FUND_MAP);
}

export function buildOtcCandidate(code, fallback = {}) {
  return buildOtcCandidateBase(code, fallback, NASDAQ_OTC_FUND_MAP, resolveCnFundNameBase);
}

export function normalizeSearchResults(rawRows, marketKey, query = '') {
  return normalizeSearchResultsBase(rawRows, marketKey, query, buildOtcCandidate, NASDAQ_OTC_FUND_MAP);
}

export function buildOtcFundQuoteFromSnapshot(symbol, snapshot, fallback = {}) {
  return buildOtcFundQuoteFromSnapshotBase(symbol, snapshot, fallback, resolveCnFundNameBase, NASDAQ_OTC_FUND_MAP);
}

export function formatBrowserTitleForQuote(quote) {
  return formatBrowserTitleForQuoteBase(quote, formatNumber, formatSymbolDisplay);
}
