import { useEffect } from 'react';
import { normalizeCnFundCode } from './marketDisplayUtils.js';

export function useCnFundDailyCandles({
  market,
  selectedSymbol,
  chartCandlesMap,
  chartInflightRef,
  fetchKline,
  hasNasdaqOtcFund,
  setChartCandlesMap,
}) {
  useEffect(() => {
    if (!selectedSymbol || market !== 'cn') return;
    const code = normalizeCnFundCode(selectedSymbol);
    if (!/^\d{6}$/.test(code) || hasNasdaqOtcFund(code)) return;
    const cacheKey = `${selectedSymbol}|1d`;
    if (chartCandlesMap[cacheKey] || chartInflightRef.current.has(cacheKey)) return;
    chartInflightRef.current.add(cacheKey);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchKline(selectedSymbol, { timeframe: '1d' });
        const candles = Array.isArray(r && r.candles) ? r.candles : [];
        if (!cancelled) setChartCandlesMap((prev) => ({ ...prev, [cacheKey]: candles }));
      } catch (_) {
        if (!cancelled) setChartCandlesMap((prev) => ({ ...prev, [cacheKey]: [] }));
      } finally {
        chartInflightRef.current.delete(cacheKey);
      }
    })();
    return () => { cancelled = true; };
  }, [market, selectedSymbol, chartCandlesMap, chartInflightRef, fetchKline, hasNasdaqOtcFund, setChartCandlesMap]);
}
