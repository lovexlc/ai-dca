import { useCallback, useRef, useState } from 'react';

export function useMarketKlineSnapshots(fetchKline) {
  const [klineMap, setKlineMap] = useState({});
  const klineInflightRef = useRef(new Set());

  const ensureKlines = useCallback(async (symbols) => {
    const uniq = Array.from(new Set(Array.isArray(symbols) ? symbols.filter(Boolean) : []));
    const pending = uniq.filter((symbol) => !klineInflightRef.current.has(symbol));
    pending.forEach((symbol) => klineInflightRef.current.add(symbol));
    if (!pending.length) return;
    await Promise.all(
      pending.map(async (symbol) => {
        try {
          const response = await fetchKline(symbol, { timeframe: '1d' });
          const candles = Array.isArray(response?.candles) ? response.candles : [];
          const points = candles.slice(-30).map((candle) => Number(candle?.c)).filter((value) => Number.isFinite(value));
          if (points.length >= 2) setKlineMap((prev) => ({ ...prev, [symbol]: points }));
        } catch {
          // K-line snapshots are best-effort; the quote row should remain usable.
        } finally {
          klineInflightRef.current.delete(symbol);
        }
      })
    );
  }, [fetchKline]);

  return { klineMap, ensureKlines };
}
