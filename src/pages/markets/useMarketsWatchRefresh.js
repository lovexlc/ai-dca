import { useCallback, useRef } from 'react';
import { trackActionResult } from '../../app/analytics.js';
import { loadWatchQuotesWithEnhancements } from './marketsWatchData.js';

function uniqueSymbols(symbols = []) {
  return Array.from(new Set(symbols.map((sym) => String(sym || '').trim()).filter(Boolean)));
}

function isMeaningfulRefreshValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
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
    if (isMeaningfulRefreshValue(value) || !Object.prototype.hasOwnProperty.call(merged, key)) {
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
  fetchQuotes,
  getNavSnapshots,
  fetchFundFees,
  buildOtcFundQuoteFromSnapshot,
  hasNasdaqOtcFund,
  fetchPremiumQuotes,
  setWatchQuotes,
  setWatchNavSnapshots,
  setFundFeesByCode,
  setWatchLoading,
}) {
  const refreshSeqRef = useRef(0);
  const inflightKeyRef = useRef('');

  return useCallback(async () => {
    const list = uniqueSymbols(requestedWatchSymbols);
    if (!list.length) {
      refreshSeqRef.current += 1;
      inflightKeyRef.current = '';
      if (!trackedWatchSymbols.length) {
        setWatchQuotes({});
        setWatchNavSnapshots({});
      }
      setWatchLoading(false);
      trackActionResult('markets', 'watch_refresh', 'empty', { market });
      return;
    }

    const refreshKey = [
      market,
      includeFundFees ? 'fees' : 'no-fees',
      includePremiumSnapshots ? 'premium' : 'no-premium',
      list.join(',')
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
      const { quotes, navSnapshots, fundFees } = await loadWatchQuotesWithEnhancements({
        symbols: list,
        market,
        fetchQuotes,
        getNavSnapshots,
        fetchFundFees,
        buildOtcFundQuoteFromSnapshot,
        hasNasdaqOtcFund,
        includeFundFees,
        includePremiumSnapshots,
        fetchPremiumQuotes,
        onBaseResult: ({ quotes: baseQuotes = {}, navSnapshots: baseNavSnapshots = {} }) => {
          if (!isCurrent()) return;
          if (Object.keys(baseNavSnapshots).length) {
            setWatchNavSnapshots((prev) => ({ ...prev, ...baseNavSnapshots }));
          }
          setWatchQuotes((prev) => mergeRefreshQuoteMap(prev, baseQuotes));
        },
      });
      if (!isCurrent()) return;
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
      const missingQuoteSymbols = list.filter((symbol) => !quotes?.[symbol]);
      setWatchQuotes((prev) => mergeRefreshQuoteMap(prev, quotes));
      trackActionResult('markets', 'watch_refresh', 'success', {
        market,
        symbolCount: list.length,
        symbolSample: list.slice(0, 30),
        quoteCount: Object.keys(quotes || {}).length,
        navSnapshotCount: Object.keys(navSnapshots || {}).length,
        fundFeeCount: Object.keys(fundFees || {}).length,
        includeFundFees,
        errorSymbols: quotesWithErrors.slice(0, 30).map(([symbol]) => symbol),
        missingQuoteSymbols: missingQuoteSymbols.slice(0, 30),
        durationMs: Date.now() - startedAt
      });
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
    fetchQuotes,
    getNavSnapshots,
    fetchFundFees,
    buildOtcFundQuoteFromSnapshot,
    hasNasdaqOtcFund,
    fetchPremiumQuotes,
    setWatchQuotes,
    setWatchNavSnapshots,
    setFundFeesByCode,
    setWatchLoading,
  ]);
}
