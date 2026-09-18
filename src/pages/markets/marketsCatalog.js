import { isKnownQdiiFundCode } from '../../app/qdiiFundCodes.js';
import {
  CN_ETF_WATCHLIST_PRESETS,
  CN_OTC_WATCHLIST_PRESETS,
  US_INDICATOR_WATCHLIST_PRESETS
} from '../../app/marketsWatchlistStorage.js';
import { NASDAQ_OTC_FUND_MAP } from '../../app/nasdaqCatalog.js';
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

export const US_INDICATOR_PRESET_MAP = Object.fromEntries(
  US_INDICATOR_WATCHLIST_PRESETS.map((item) => [item.symbol, item])
);

export { NASDAQ_OTC_FUND_MAP };

export function hasNasdaqOtcFund(codeOrSymbol) {
  const code = normalizeCnFundCode(codeOrSymbol);
  return Boolean(code && (NASDAQ_OTC_FUND_MAP[code] || isKnownQdiiFundCode(code)));
}

export function resolveCnFundName(codeOrSymbol, fallback = '') {
  return resolveCnFundNameBase(codeOrSymbol, fallback, NASDAQ_OTC_FUND_MAP);
}

export function buildOtcCandidate(code, fallback = {}) {
  return buildOtcCandidateBase(code, fallback, NASDAQ_OTC_FUND_MAP, resolveCnFundNameBase);
}

export function normalizeSearchResults(rawRows, marketKey, query = '') {
  const rows = Array.isArray(rawRows) ? [...rawRows] : [];
  const code = normalizeCnFundCode(query);
  const exchangePreset = code ? CN_ETF_PRESET_MAP[code] : null;
  const hasExchangeResult = rows.some((row) => (
    normalizeCnFundCode(row.symbol || row.code || row.ticker) === code
    && /exchange|场内|交易所|etf|lof/i.test(String(row.assetType || row.type || row.exchange || ''))
  ));
  if (marketKey === 'cn' && exchangePreset && !hasExchangeResult) {
    rows.unshift({
      ...exchangePreset,
      symbol: code,
      code,
      market: 'cn',
      assetType: 'exchange_fund'
    });
  }
  const isExplicitOtc = Boolean(code && (
    NASDAQ_OTC_FUND_MAP[code]
    || (isKnownQdiiFundCode(code) && !hasExchangeResult)
    || /^(01|02|04|05|07|08|09|11|12|20|21|24|26|27|32|37|45|46|47|48)/.test(code)
  ));
  const hasOtcCandidate = Boolean(code && (isExplicitOtc || (!exchangePreset && !hasExchangeResult && /^\d{6}$/.test(code))));
  return normalizeSearchResultsBase(rows, marketKey, hasOtcCandidate ? query : '', buildOtcCandidate, NASDAQ_OTC_FUND_MAP);
}

export function buildOtcFundQuoteFromSnapshot(symbol, snapshot, fallback = {}) {
  return buildOtcFundQuoteFromSnapshotBase(symbol, snapshot, fallback, resolveCnFundNameBase, NASDAQ_OTC_FUND_MAP);
}

export function formatBrowserTitleForQuote(quote) {
  return formatBrowserTitleForQuoteBase(quote, formatNumber, formatSymbolDisplay);
}
