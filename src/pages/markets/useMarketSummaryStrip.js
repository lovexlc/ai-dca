import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMarketSummary } from './marketsApiLoader.js';

const MARKET_SUMMARY_TOPIC = 'market.summary';
const MARKET_SUMMARY_REGIONS = [
  { region: 'US', label: 'US Markets' },
  { region: 'ASIA', label: 'Asia Markets' }
];

function normalizeMarketSummaryRegion(value = 'US') {
  const normalized = String(value || 'US').trim().toUpperCase();
  return MARKET_SUMMARY_REGIONS.some((item) => item.region === normalized) ? normalized : 'US';
}

function marketSummaryRegionLabel(region = 'US') {
  return MARKET_SUMMARY_REGIONS.find((item) => item.region === normalizeMarketSummaryRegion(region))?.label || 'US Markets';
}

function normalizeSparklinePoints(value, { maxPoints = 80 } = {}) {
  const list = Array.isArray(value) ? value : [];
  const points = list
    .filter((item) => item != null)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  const limit = Math.max(2, Number(maxPoints) || 80);
  return points.length > limit ? points.slice(-limit) : points;
}

function sameNumberArray(left = [], right = []) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function normalizeSummaryItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const symbol = String(item?.symbol || item?.code || '').trim();
      if (!symbol) return null;
      return {
        symbol,
        name: String(item?.name || item?.shortName || symbol).trim(),
        price: Number.isFinite(Number(item?.price)) ? Number(item.price) : null,
        priceText: String(item?.priceText || '').trim(),
        change: Number.isFinite(Number(item?.change)) ? Number(item.change) : null,
        changeText: String(item?.changeText || '').trim(),
        changePercent: Number.isFinite(Number(item?.changePercent)) ? Number(item.changePercent) : null,
        changePercentText: String(item?.changePercentText || '').trim(),
        marketState: String(item?.marketState || '').trim(),
        asOf: String(item?.asOf || item?.quoteAt || '').trim(),
        timeText: String(item?.timeText || '').trim(),
        exchangeTimezone: String(item?.exchangeTimezone || '').trim(),
        delayMinutes: Number.isFinite(Number(item?.delayMinutes)) ? Number(item.delayMinutes) : null,
        source: String(item?.source || '').trim(),
        summaryRegion: String(item?.summaryRegion || item?.region || '').trim(),
        sparkline: normalizeSparklinePoints(item?.sparkline),
        sparklineRange: String(item?.sparklineRange || '').trim(),
        sparklineInterval: String(item?.sparklineInterval || '').trim()
      };
    })
    .filter(Boolean);
}

function summaryItemChanged(prev, next) {
  if (!prev) return true;
  return prev.price !== next.price
    || prev.priceText !== next.priceText
    || prev.change !== next.change
    || prev.changeText !== next.changeText
    || prev.changePercent !== next.changePercent
    || prev.changePercentText !== next.changePercentText
    || prev.marketState !== next.marketState
    || prev.asOf !== next.asOf
    || !sameNumberArray(prev.sparkline, next.sparkline);
}

export function useMarketSummaryStrip(active) {
  const [selectedRegion, setSelectedRegionState] = useState('US');
  const [summary, setSummary] = useState({ title: 'US Markets', region: 'US', items: [], generatedAt: '' });
  const [loading, setLoading] = useState(false);
  const [flashSymbols, setFlashSymbols] = useState({});
  const loadedRegionsRef = useRef(new Set());
  const summaryCacheRef = useRef(new Map());
  const flashTimerRef = useRef(null);
  const summaryRef = useRef(summary);
  const selectedRegionRef = useRef(selectedRegion);

  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  useEffect(() => {
    selectedRegionRef.current = selectedRegion;
  }, [selectedRegion]);

  const setSelectedRegion = useCallback((region) => {
    setFlashSymbols({});
    setSelectedRegionState(normalizeMarketSummaryRegion(region));
  }, []);

  const refresh = useCallback(async (forceRefresh = false, { signal, region = selectedRegion } = {}) => {
    const targetRegion = normalizeMarketSummaryRegion(region);
    if (!forceRefresh && loadedRegionsRef.current.has(targetRegion)) {
      const cachedSummary = summaryCacheRef.current.get(targetRegion);
      if (cachedSummary) setSummary(cachedSummary);
      return;
    }
    setSummary((prev) => (
      prev.region === targetRegion
        ? prev
        : { title: marketSummaryRegionLabel(targetRegion), region: targetRegion, generatedAt: '', source: '', items: [] }
    ));
    setLoading(true);
    try {
      const r = await fetchMarketSummary(targetRegion, { refresh: forceRefresh, signal });
      if (signal?.aborted) return;
      const nextSummary = {
        title: r?.title || marketSummaryRegionLabel(targetRegion),
        region: normalizeMarketSummaryRegion(r?.region || targetRegion),
        generatedAt: r?.generatedAt || '',
        source: r?.source || '',
        items: normalizeSummaryItems(r?.items)
      };
      summaryCacheRef.current.set(targetRegion, nextSummary);
      loadedRegionsRef.current.add(targetRegion);
      setSummary(nextSummary);
    } catch {
      // 增强条带加载失败时保留旧数据，不影响详情主流程。
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [selectedRegion]);

  const summarySymbols = useMemo(() => (
    Array.from(new Set((summary.items || []).map((item) => String(item?.symbol || '').trim()).filter(Boolean)))
  ), [summary.items]);

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    refresh(false, { signal: controller.signal, region: selectedRegion });
    return () => controller.abort();
  }, [active, refresh, selectedRegion]);

  useEffect(() => {
    if (!active || !summarySymbols.length || typeof window === 'undefined') return undefined;
    let stopped = false;
    let timer = null;
    let subscribed = false;
    const subscribe = () => {
      if (stopped) return;
      if (typeof window.__aiDcaSubscribeMarketData === 'function') {
        window.__aiDcaSubscribeMarketData(summarySymbols, {
          scope: 'market-summary-strip',
          topics: [MARKET_SUMMARY_TOPIC]
        });
        subscribed = true;
        return;
      }
      timer = window.setTimeout(subscribe, 1000);
    };
    subscribe();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (!subscribed) return;
      try {
        window.__aiDcaSubscribeMarketData([], {
          scope: 'market-summary-strip',
          topics: [MARKET_SUMMARY_TOPIC]
        });
      } catch { /* ignore */ }
    };
  }, [active, summarySymbols]);

  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;
    function handleMarketSummarySnapshot(event) {
      const detail = event?.detail || {};
      if (detail.source !== 'markets/market-summary') return;
      const incomingItems = normalizeSummaryItems(detail.items);
      if (!incomingItems.length) return;
      const incomingRegion = normalizeMarketSummaryRegion(detail.region || incomingItems[0]?.summaryRegion || 'US');
      if (incomingRegion !== selectedRegionRef.current) return;
      const prev = summaryRef.current || {};
      const previousBySymbol = new Map((prev.items || []).map((item) => [item.symbol, item]));
      const incomingBySymbol = new Map(incomingItems.map((item) => [item.symbol, item]));
      const changed = [];
      for (const item of incomingItems) {
        if (summaryItemChanged(previousBySymbol.get(item.symbol), item)) changed.push(item.symbol);
      }
      if (changed.length) {
        setFlashSymbols(Object.fromEntries(changed.map((symbol) => [symbol, true])));
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = null;
          setFlashSymbols({});
        }, 900);
      }
      const nextItems = (prev.items || []).map((item) => incomingBySymbol.get(item.symbol) || item);
      const existing = new Set(nextItems.map((item) => item.symbol));
      for (const item of incomingItems) {
        if (!existing.has(item.symbol)) nextItems.push(item);
      }
      const nextSummary = {
        ...prev,
        title: prev.title || marketSummaryRegionLabel(incomingRegion),
        region: incomingRegion,
        generatedAt: detail.ts ? new Date(detail.ts).toISOString() : new Date().toISOString(),
        source: 'yahoo-market-summary',
        items: nextItems
      };
      loadedRegionsRef.current.add(incomingRegion);
      summaryCacheRef.current.set(incomingRegion, nextSummary);
      setSummary(nextSummary);
    }
    window.addEventListener('ai-dca-market-snapshot', handleMarketSummarySnapshot);
    return () => {
      window.removeEventListener('ai-dca-market-snapshot', handleMarketSummarySnapshot);
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
    };
  }, [active]);

  return {
    summary,
    loading,
    refresh,
    flashSymbols,
    selectedRegion,
    setSelectedRegion,
    marketOptions: MARKET_SUMMARY_REGIONS
  };
}
