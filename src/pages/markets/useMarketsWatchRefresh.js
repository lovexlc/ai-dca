import { useCallback, useRef } from 'react';
import { trackActionResult } from '../../app/analytics.js';
import { loadWatchQuotesWithEnhancements } from './marketsWatchData.js';

function uniqueSymbols(symbols = []) {
  return Array.from(new Set(symbols.map((sym) => String(sym || '').trim()).filter(Boolean)));
}

export function buildLazyWatchRefreshBatches({
  requestedWatchSymbols = [],
  trackedWatchSymbols = [],
  skipRemainingSymbols = false,
} = {}) {
  const primarySymbols = uniqueSymbols(requestedWatchSymbols);
  if (!primarySymbols.length) {
    return { primarySymbols, remainingSymbols: [] };
  }
  const primarySet = new Set(primarySymbols);
  const remainingSymbols = skipRemainingSymbols
    ? []
    : uniqueSymbols(trackedWatchSymbols).filter((symbol) => !primarySet.has(symbol));
  return { primarySymbols, remainingSymbols };
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
  includePremiumSnapshots,
  includeHighPointSnapshots,
  fetchQuotes,
  getNavSnapshots,
  buildOtcFundQuoteFromSnapshot,
  isOtcList = false,
  fetchPremiumQuotes,
  setWatchQuotes,
  setWatchNavSnapshots,
  setWatchLoading,
  skipRemainingSymbols = false,
  serverListMode = false,
}) {
  const refreshSeqRef = useRef(0);
  const inflightKeyRef = useRef('');

  return useCallback(async () => {
    if (serverListMode) {
      setWatchLoading(false);
      return;
    }
    const trackedList = uniqueSymbols(trackedWatchSymbols);
    const { primarySymbols: list, remainingSymbols } = buildLazyWatchRefreshBatches({
      requestedWatchSymbols,
      trackedWatchSymbols,
      skipRemainingSymbols,
    });
    if (!list.length) {
      if (inflightKeyRef.current) {
        trackActionResult('markets', 'watch_refresh', 'deduped', {
          market,
          symbolCount: 0,
          symbolSample: [],
          activeKey: inflightKeyRef.current,
        });
        return;
      }
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
      includePremiumSnapshots ? 'premium' : 'no-premium',
      includeHighPointSnapshots ? 'high-points' : 'no-high-points',
      list.join(','),
      `tracked:${trackedList.join(',')}`
    ].join('|');
    if (inflightKeyRef.current) {
      trackActionResult('markets', 'watch_refresh', 'deduped', {
        market,
        symbolCount: list.length,
        symbolSample: list.slice(0, 30),
        activeKey: inflightKeyRef.current,
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
          buildOtcFundQuoteFromSnapshot,
          isOtcList,
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
        const { quotes = {}, navSnapshots = {} } = result || {};
        if (Object.keys(navSnapshots).length) {
          setWatchNavSnapshots((prev) => ({ ...prev, ...navSnapshots }));
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
        includeHighPointSnapshots,
        errorSymbols: (primaryResult?.quotesWithErrors || []).slice(0, 30).map(([symbol]) => symbol),
        missingQuoteSymbols: (primaryResult?.missingQuoteSymbols || []).slice(0, 30),
        remainingSymbolCount: remainingSymbols.length,
        durationMs: Date.now() - startedAt
      });
      if (remainingSymbols.length) {
        try {
          const remainingResult = await loadBatch(remainingSymbols);
          if (remainingResult && isCurrent()) {
            trackActionResult('markets', 'watch_refresh_remaining', 'success', {
              market,
              symbolCount: remainingSymbols.length,
              symbolSample: remainingSymbols.slice(0, 30),
              quoteCount: Object.keys(remainingResult.quotes || {}).length,
              navSnapshotCount: Object.keys(remainingResult.navSnapshots || {}).length,
              includeHighPointSnapshots,
              errorSymbols: (remainingResult.quotesWithErrors || []).slice(0, 30).map(([symbol]) => symbol),
              missingQuoteSymbols: (remainingResult.missingQuoteSymbols || []).slice(0, 30),
              durationMs: remainingResult.durationMs,
            });
          }
        } catch (err) {
          if (isCurrent()) {
            trackActionResult('markets', 'watch_refresh_remaining', 'error', {
              market,
              symbolCount: remainingSymbols.length,
              symbolSample: remainingSymbols.slice(0, 30),
              errorMessage: err?.message || ''
            });
          }
        }
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
    includePremiumSnapshots,
    includeHighPointSnapshots,
    fetchQuotes,
    getNavSnapshots,
    buildOtcFundQuoteFromSnapshot,
    isOtcList,
    fetchPremiumQuotes,
    setWatchQuotes,
    setWatchNavSnapshots,
    setWatchLoading,
    skipRemainingSymbols,
    serverListMode,
  ]);
}
