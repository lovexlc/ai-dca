import { useCallback, useRef } from 'react';
import { trackActionResult } from '../../app/analytics.js';
import { loadWatchQuotesWithEnhancements } from './marketsWatchData.js';

function uniqueSymbols(symbols = []) {
  return Array.from(new Set(symbols.map((sym) => String(sym || '').trim()).filter(Boolean)));
}

export function buildLazyWatchRefreshBatches({
  requestedWatchSymbols = [],
  trackedWatchSymbols = [],
} = {}) {
  const primarySymbols = uniqueSymbols(requestedWatchSymbols);
  if (!primarySymbols.length) {
    return { primarySymbols, remainingSymbols: [] };
  }
  const primarySet = new Set(primarySymbols);
  const remainingSymbols = uniqueSymbols(trackedWatchSymbols).filter((symbol) => !primarySet.has(symbol));
  return { primarySymbols, remainingSymbols };
}

const POSITIVE_QUOTE_FIELDS = new Set([
  'price', 'latestPrice', 'currentPrice', 'close', 'previousClose', 'latestNav', 'previousNav',
  'iopv', 'nav', 'navBase', 'estimateNav', 'high', 'low', 'open', 'high52w', 'low52w',
  'high52Week', 'fiftyTwoWeekHigh', 'turnover', 'amount', 'volume', 'totalVolume',
  'totalShares', 'marketCapital', 'marketCap', 'managementFeeRate', 'expenseRatio'
]);

function isMeaningfulRefreshValue(value, key = '') {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    if (!Object.keys(value).length) return false;
    if (key === 'highPoint' || key === 'closeHighPoint') {
      const high = Number(value.high);
      return Number.isFinite(high) && high > 0;
    }
    return true;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false;
    return !POSITIVE_QUOTE_FIELDS.has(key) || value > 0;
  }
  if (typeof value === 'boolean') return true;
  return Boolean(value);
}

export function mergeRefreshQuote(previous = {}, incoming = {}) {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) {
    return incoming;
  }
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return previous;
  }
  const merged = { ...previous };
  Object.entries(incoming).forEach(([key, value]) => {
    if (isMeaningfulRefreshValue(value, key) || !Object.prototype.hasOwnProperty.call(merged, key)) {
      merged[key] = value;
    }
  });
  return merged;
}

export function mergeRefreshQuoteMap(previous = {}, incoming = {}) {
  const next = { ...(previous || {}) };
  Object.entries(incoming || {}).forEach(([symbol, quote]) => {
    next[symbol] = mergeRefreshQuote(next[symbol], quote);
  });
  return next;
}

export function useMarketsWatchRefresh({
  requestedWatchSymbols = [],
  trackedWatchSymbols = [],
  market,
  includeFundFees,
  includePremiumSnapshots,
  includeHighPointSnapshots,
  fetchQuotes,
  getNavSnapshots,
  fetchFundFees,
  buildOtcFundQuoteFromSnapshot,
  isOtcList = false,
  fetchPremiumQuotes,
  setWatchQuotes,
  setWatchNavSnapshots,
  setFundFeesByCode,
  setWatchLoading,
}) {
  const refreshSeqRef = useRef(0);
  const inflightKeyRef = useRef('');

  return useCallback(async () => {
    const trackedList = uniqueSymbols(trackedWatchSymbols);
    const { primarySymbols: list, remainingSymbols } = buildLazyWatchRefreshBatches({
      requestedWatchSymbols,
      trackedWatchSymbols,
    });
    if (!list.length) {
      refreshSeqRef.current += 1;
      inflightKeyRef.current = '';
      if (!trackedList.length) {
        setWatchQuotes({});
        setWatchNavSnapshots({});
      }
      setWatchLoading(false);
      trackActionResult('markets', 'watch_refresh', trackedList.length ? 'waiting_visible' : 'empty', {
        market,
        trackedSymbolCount: trackedList.length,
        trackedSymbolSample: trackedList.slice(0, 30),
      });
      return;
    }

    const refreshKey = [
      market,
      includeFundFees ? 'fees' : 'no-fees',
      includePremiumSnapshots ? 'premium' : 'no-premium',
      includeHighPointSnapshots ? 'high-points' : 'no-high-points',
      list.join(','),
      `tracked:${trackedList.join(',')}`
    ].join('|');
    if (inflightKeyRef.current === refreshKey) {
      trackActionResult('markets', 'watch_refresh', 'deduped', {
        market,
        symbolCount: list.length,
        symbolSample: list.slice(0, 30)
      });
      return;
    }

    const seq = refreshSeqRef.current + 1;
    refreshSeqRef.current = seq;
    inflightKeyRef.current = refreshKey;
    const isCurrent = () => refreshSeqRef.current === seq;
    setWatchLoading(true);
    const startedAt = Date.now();

    try {
      const loadBatch = async (symbols) => {
        const batchStartedAt = Date.now();
        const result = await loadWatchQuotesWithEnhancements({
          symbols,
          market,
          fetchQuotes,
          getNavSnapshots,
          fetchFundFees,
          buildOtcFundQuoteFromSnapshot,
          isOtcList,
          includeFundFees,
          includePremiumSnapshots,
          includeHighPointSnapshots,
          fetchPremiumQuotes,
          onBaseResult: ({ quotes: baseQuotes = {}, navSnapshots: baseNavSnapshots = {} }) => {
            if (!isCurrent()) return;
            if (Object.keys(baseNavSnapshots).length) {
              setWatchNavSnapshots((prev) => ({ ...prev, ...baseNavSnapshots }));
            }
            setWatchQuotes((prev) => mergeRefreshQuoteMap(prev, baseQuotes));
          },
        });
        if (!isCurrent()) return null;
        const { quotes = {}, navSnapshots = {}, fundFees = {} } = result || {};
        if (Object.keys(navSnapshots).length) {
          setWatchNavSnapshots((prev) => ({ ...prev, ...navSnapshots }));
        }
        if (Object.keys(fundFees).length) {
          setFundFeesByCode((prev) => ({ ...prev, ...fundFees }));
        }
        const quotesWithErrors = Object.entries(quotes).filter(([, q]) => q?.error);
        if (quotesWithErrors.length > 0) {
          console.warn('[Markets] 以下标的获取行情失败:', quotesWithErrors.map(([sym, q]) => ({ symbol: sym, error: q.error })));
        }
        const missingQuoteSymbols = symbols.filter((symbol) => !quotes?.[symbol]);
        setWatchQuotes((prev) => mergeRefreshQuoteMap(prev, quotes));
        return {
          quotes,
          navSnapshots,
          fundFees,
          quotesWithErrors,
          missingQuoteSymbols,
          durationMs: Date.now() - batchStartedAt,
        };
      };

      const primaryResult = await loadBatch(list);
      if (!isCurrent()) return;
      trackActionResult('markets', 'watch_refresh', 'success', {
        market,
        symbolCount: list.length,
        symbolSample: list.slice(0, 30),
        quoteCount: Object.keys(primaryResult?.quotes || {}).length,
        navSnapshotCount: Object.keys(primaryResult?.navSnapshots || {}).length,
        fundFeeCount: Object.keys(primaryResult?.fundFees || {}).length,
        includeFundFees,
        includeHighPointSnapshots,
        errorSymbols: (primaryResult?.quotesWithErrors || []).slice(0, 30).map(([symbol]) => symbol),
        missingQuoteSymbols: (primaryResult?.missingQuoteSymbols || []).slice(0, 30),
        remainingSymbolCount: remainingSymbols.length,
        durationMs: Date.now() - startedAt
      });
      if (remainingSymbols.length) {
        loadBatch(remainingSymbols)
          .then((remainingResult) => {
            if (!remainingResult || !isCurrent()) return;
            trackActionResult('markets', 'watch_refresh_remaining', 'success', {
              market,
              symbolCount: remainingSymbols.length,
              symbolSample: remainingSymbols.slice(0, 30),
              quoteCount: Object.keys(remainingResult.quotes || {}).length,
              navSnapshotCount: Object.keys(remainingResult.navSnapshots || {}).length,
              fundFeeCount: Object.keys(remainingResult.fundFees || {}).length,
              includeFundFees,
              includeHighPointSnapshots,
              errorSymbols: (remainingResult.quotesWithErrors || []).slice(0, 30).map(([symbol]) => symbol),
              missingQuoteSymbols: (remainingResult.missingQuoteSymbols || []).slice(0, 30),
              durationMs: remainingResult.durationMs,
            });
          })
          .catch((err) => {
            if (!isCurrent()) return;
            trackActionResult('markets', 'watch_refresh_remaining', 'error', {
              market,
              symbolCount: remainingSymbols.length,
              symbolSample: remainingSymbols.slice(0, 30),
              errorMessage: err?.message || ''
            });
          });
      }
    } catch (err) {
      if (isCurrent()) {
        trackActionResult('markets', 'watch_refresh', 'error', {
          market,
          symbolCount: list.length,
          symbolSample: list.slice(0, 30),
          durationMs: Date.now() - startedAt,
          errorMessage: err?.message || ''
        });
      }
    } finally {
      if (inflightKeyRef.current === refreshKey) inflightKeyRef.current = '';
      if (isCurrent()) setWatchLoading(false);
    }
  }, [
    requestedWatchSymbols,
    trackedWatchSymbols,
    market,
    includeFundFees,
    includePremiumSnapshots,
    includeHighPointSnapshots,
    fetchQuotes,
    getNavSnapshots,
    fetchFundFees,
    buildOtcFundQuoteFromSnapshot,
    isOtcList,
    fetchPremiumQuotes,
    setWatchQuotes,
    setWatchNavSnapshots,
    setFundFeesByCode,
    setWatchLoading,
  ]);
}
