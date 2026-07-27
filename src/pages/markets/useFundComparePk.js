import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchFundFees, fetchQuotes } from '../../app/marketsApi.js';
import { apiUrl } from '../../app/apiBase.js';
import { isCnOtcFundQuote } from './marketFundMetrics.js';
import { normalizeCnFundCode } from './marketDisplayUtils.js';
import { isCnFundCompareInstrument, shouldFetchComparePkExtras } from './marketDetailDataPolicy.js';
import {
  normalizeFundLimitEntries,
  readCachedFundFees,
  readCachedFundLimits,
  writeCachedFundFees,
  writeCachedFundLimits,
} from './marketsWatchData.js';

function uniqueSixDigitCodes(symbols = [], mainSymbol = '') {
  const list = [
    mainSymbol,
    ...(Array.isArray(symbols) ? symbols : []),
  ]
    .map((sym) => normalizeCnFundCode(sym) || String(sym || '').replace(/\D/g, '').slice(-6))
    .filter((code) => /^\d{6}$/.test(code));
  return Array.from(new Set(list));
}

function hasReturnMetrics(quote) {
  if (!quote || typeof quote !== 'object') return false;
  return [
    'return1w', 'return1m', 'return3m', 'return6m', 'return1y',
    'ytdReturn', 'maxDrawdown', 'fundSize', 'latestNav',
  ].some((key) => quote[key] != null && quote[key] !== '');
}

function findQuoteForCode(quoteMap = {}, code = '') {
  const raw = String(code || '').trim().toUpperCase();
  const normalized = normalizeCnFundCode(raw);
  return quoteMap[raw]
    || quoteMap[normalized]
    || quoteMap[`SH${normalized}`]
    || quoteMap[`SZ${normalized}`]
    || quoteMap[`BJ${normalized}`]
    || null;
}

function mergedQuoteForCode(compareQuoteMap = {}, pkQuoteMap = {}, code = '') {
  return {
    ...(findQuoteForCode(compareQuoteMap, code) || {}),
    ...(findQuoteForCode(pkQuoteMap, code) || {}),
  };
}

/**
 * Loads PK extras only when compare is open (fees / limits / richer quotes).
 * Does not run on list pages.
 */
export function useFundComparePk({
  market = '',
  mainRow = null,
  compareSymbols = [],
  compareQuoteMap = {},
  isMainOtc = false,
  enabled = false,
}) {
  const [feeMap, setFeeMap] = useState({});
  const [limitMap, setLimitMap] = useState({});
  const [pkQuoteMap, setPkQuoteMap] = useState({});
  const [loadingFees, setLoadingFees] = useState(false);
  const [loadingLimits, setLoadingLimits] = useState(false);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const feeInflightRef = useRef(new Map());
  const limitInflightRef = useRef(new Map());
  const quoteInflightRef = useRef(new Map());

  const compareOpen = Boolean(enabled && Array.isArray(compareSymbols) && compareSymbols.length > 0);
  const mainSymbol = String(mainRow?.symbol || '').trim().toUpperCase();
  const codes = useMemo(
    () => uniqueSixDigitCodes(compareSymbols, mainSymbol),
    [compareSymbols, mainSymbol],
  );
  const fundCodes = useMemo(() => codes.filter((code) => {
    const quote = mergedQuoteForCode(compareQuoteMap, pkQuoteMap, code);
    const isMain = normalizeCnFundCode(mainSymbol) === code;
    return isCnFundCompareInstrument(code, quote, { isMainOtc: isMain && isMainOtc });
  }), [codes, compareQuoteMap, pkQuoteMap, mainSymbol, isMainOtc]);
  const fundCodeKey = fundCodes.join('|');

  const anyOtc = useMemo(() => {
    return fundCodes.some((code) => {
      const isMain = normalizeCnFundCode(mainSymbol) === code;
      const q = mergedQuoteForCode(compareQuoteMap, pkQuoteMap, code);
      return (isMain && isMainOtc) || isCnOtcFundQuote(q);
    });
  }, [fundCodes, mainSymbol, isMainOtc, compareQuoteMap, pkQuoteMap]);
  const otcCodes = useMemo(() => fundCodes.filter((code) => {
    const isMain = normalizeCnFundCode(mainSymbol) === code;
    const q = mergedQuoteForCode(compareQuoteMap, pkQuoteMap, code);
    return (isMain && isMainOtc) || isCnOtcFundQuote(q);
  }), [fundCodes, mainSymbol, isMainOtc, compareQuoteMap, pkQuoteMap]);

  const policy = useMemo(
    () => shouldFetchComparePkExtras({
      market,
      compareCount: enabled ? Math.max(0, fundCodes.length - 1) : 0,
      includeFees: enabled,
      includeLimits: enabled && anyOtc,
    }),
    [market, enabled, fundCodes.length, anyOtc],
  );

  const mergedQuoteMap = useMemo(() => ({
    ...compareQuoteMap,
    ...pkQuoteMap,
  }), [pkQuoteMap, compareQuoteMap]);

  // Richer quotes for multi-period returns / size / drawdown.
  useEffect(() => {
    if (!compareOpen || market !== 'cn' || !fundCodes.length) {
      setLoadingQuotes(false);
      return undefined;
    }
    const need = fundCodes.filter((code) => {
      const existing = mergedQuoteForCode(compareQuoteMap, pkQuoteMap, code);
      const mainFallback = normalizeCnFundCode(mainSymbol) === code ? mainRow : null;
      return !hasReturnMetrics(existing) && !hasReturnMetrics(mainFallback);
    });
    if (!need.length) {
      setLoadingQuotes(false);
      return undefined;
    }
    let cancelled = false;
    setLoadingQuotes(true);
    const loadQuote = (code) => {
      const existing = quoteInflightRef.current.get(code);
      if (existing) return existing;
      let request;
      request = fetchQuotes([code])
        .then((payload) => {
          const quotes = payload?.quotes && typeof payload.quotes === 'object' ? payload.quotes : {};
          return {
            code,
            quote: quotes[code]
              || quotes[code.toUpperCase()]
              || quotes[`SH${code}`]
              || quotes[`SZ${code}`]
              || null,
          };
        })
        .catch(() => ({ code, quote: null }))
        .finally(() => {
          if (quoteInflightRef.current.get(code) === request) quoteInflightRef.current.delete(code);
        });
      quoteInflightRef.current.set(code, request);
      return request;
    };
    Promise.all(need.map(loadQuote))
      .then((results) => {
        if (cancelled) return;
        setPkQuoteMap((prev) => {
          const next = { ...prev };
          let changed = false;
          results.forEach(({ code, quote }) => {
            if (quote) {
              next[code] = { ...(next[code] || {}), ...quote };
              next[code.toUpperCase()] = next[code];
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingQuotes(false);
      });
    return () => {
      cancelled = true;
      setLoadingQuotes(false);
    };
  // fundCodeKey gates re-entry while quote maps provide miss detection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareOpen, market, fundCodeKey, mainSymbol, mainRow]);

  // Fees: cache-first, only when compare open.
  useEffect(() => {
    if (!policy.includeFundFees || !fundCodes.length) {
      setLoadingFees(false);
      return undefined;
    }
    const cached = readCachedFundFees(fundCodes);
    if (Object.keys(cached.dataByCode).length) {
      setFeeMap((prev) => ({ ...prev, ...cached.dataByCode }));
    }
    const missing = cached.missing;
    if (!missing.length) {
      setLoadingFees(false);
      return undefined;
    }
    let cancelled = false;
    setLoadingFees(true);
    const loadFee = (code) => {
      const existing = feeInflightRef.current.get(code);
      if (existing) return existing;
      let request;
      request = fetchFundFees([code])
        .then((payload) => {
          const fresh = {};
          (payload?.items || []).forEach((item) => {
            const itemCode = normalizeCnFundCode(item?.data?.code || item?.code);
            if (item?.ok && itemCode && item.data) fresh[itemCode] = item.data;
          });
          return fresh;
        })
        .catch(() => ({}))
        .finally(() => {
          if (feeInflightRef.current.get(code) === request) feeInflightRef.current.delete(code);
        });
      feeInflightRef.current.set(code, request);
      return request;
    };
    Promise.all(missing.map(loadFee))
      .then((parts) => {
        if (cancelled) return;
        const fresh = Object.assign({}, ...parts);
        if (Object.keys(fresh).length) {
          writeCachedFundFees(fresh);
          setFeeMap((prev) => ({ ...prev, ...fresh }));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFees(false);
      });
    return () => {
      cancelled = true;
      setLoadingFees(false);
    };
  }, [policy.includeFundFees, fundCodeKey, fundCodes]);

  // Limits: OTC only, cache-first.
  useEffect(() => {
    if (!policy.includeFundLimits || !otcCodes.length) {
      setLoadingLimits(false);
      return undefined;
    }
    const cached = readCachedFundLimits(otcCodes);
    if (Object.keys(cached.dataByCode).length) {
      setLimitMap((prev) => ({ ...prev, ...cached.dataByCode }));
    }
    const missing = cached.missing;
    if (!missing.length) {
      setLoadingLimits(false);
      return undefined;
    }
    let cancelled = false;
    setLoadingLimits(true);
    const loadLimit = (code) => {
      const existing = limitInflightRef.current.get(code);
      if (existing) return existing;
      let request;
      request = fetch(apiUrl('/api/fund-limit', { code }), { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) return {};
          return normalizeFundLimitEntries([{ ok: true, code, data: await response.json() }]);
        })
        .catch(() => ({}))
        .finally(() => {
          if (limitInflightRef.current.get(code) === request) limitInflightRef.current.delete(code);
        });
      limitInflightRef.current.set(code, request);
      return request;
    };
    Promise.all(missing.map(loadLimit))
      .then((parts) => {
        if (cancelled) return;
        const next = Object.assign({}, ...parts);
        if (!Object.keys(next).length) return;
        writeCachedFundLimits(next);
        setLimitMap((prev) => ({ ...prev, ...next }));
      })
      .finally(() => {
        if (!cancelled) setLoadingLimits(false);
      });
    return () => {
      cancelled = true;
      setLoadingLimits(false);
    };
  }, [policy.includeFundLimits, fundCodeKey, otcCodes]);

  return {
    feeMap,
    limitMap,
    pkQuoteMap: mergedQuoteMap,
    loadingFees,
    loadingLimits,
    loadingQuotes,
    showLimits: Boolean(policy.includeFundLimits),
    compareOpen,
  };
}
