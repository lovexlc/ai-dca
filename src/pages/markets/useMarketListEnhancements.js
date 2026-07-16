import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadCachedListHistoryMetrics } from './listHistoryCacheLoader.js';
import { loadFundLimitsForVisibleCodes, refreshFundLimitsForVisibleCodes } from './fundLimitListService.js';

export function useMarketListEnhancements({
  market,
  isActiveOtcList = false,
  includeListHistoryMetrics = false,
  includeFundLimits = false,
  symbols = [],
} = {}) {
  const [listHistoryMap, setListHistoryMap] = useState({});
  const [fundLimitsByCode, setFundLimitsByCode] = useState({});
  const listHistoryInflightRef = useRef(new Set());
  const fundLimitInflightRef = useRef(new Map());

  const klineMap = useMemo(() => {
    const next = {};
    for (const [symbol, item] of Object.entries(listHistoryMap || {})) {
      if (Array.isArray(item?.candles) && item.candles.length) next[symbol] = item.candles;
    }
    return next;
  }, [listHistoryMap]);

  useEffect(() => {
    if (!includeListHistoryMetrics) return undefined;
    const candidates = Array.from(new Set((symbols || [])
      .map((symbol) => String(symbol || '').trim())
      .filter(Boolean)))
      .filter((symbol) => !listHistoryMap[symbol]?.candles?.length && !listHistoryInflightRef.current.has(symbol));
    if (!candidates.length) return undefined;
    candidates.forEach((symbol) => listHistoryInflightRef.current.add(symbol));

    loadCachedListHistoryMetrics(candidates, { existingMap: listHistoryMap })
      .then((metricsBySymbol) => {
        if (Object.keys(metricsBySymbol).length) {
          setListHistoryMap((previous) => ({ ...previous, ...metricsBySymbol }));
        }
      })
      .catch(() => {})
      .finally(() => {
        candidates.forEach((symbol) => listHistoryInflightRef.current.delete(symbol));
      });
    return undefined;
  }, [includeListHistoryMetrics, listHistoryMap, symbols]);

  useEffect(() => {
    if (market !== 'cn' || !isActiveOtcList || !includeFundLimits) {
      setFundLimitsByCode({});
      return undefined;
    }
    loadFundLimitsForVisibleCodes({
      symbols,
      inflightRef: fundLimitInflightRef,
      onData: (dataByCode, missing = []) => {
        setFundLimitsByCode((previous) => {
          const next = { ...previous, ...dataByCode };
          missing.forEach((code) => delete next[code]);
          return next;
        });
      },
    });
    return undefined;
  }, [includeFundLimits, isActiveOtcList, market, symbols]);

  const refreshFundLimits = useCallback(async () => {
    if (market !== 'cn' || !isActiveOtcList || !includeFundLimits) return;
    await refreshFundLimitsForVisibleCodes({
      symbols,
      onData: (dataByCode) => setFundLimitsByCode((previous) => ({ ...previous, ...dataByCode })),
    });
  }, [includeFundLimits, isActiveOtcList, market, symbols]);

  return { fundLimitsByCode, klineMap, listHistoryMap, refreshFundLimits };
}
