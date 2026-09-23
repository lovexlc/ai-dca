import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchQuotes } from './marketsApiLoader.js';

export const BREADTH_ITEMS = [
  ['159509', 2.89], ['513100', 2.21], ['159501', 1.62], ['159941', 2.32],
  ['159696', 1.79], ['159659', 1.72], ['159632', 1.97], ['513300', 1.80],
  ['513870', 2.06], ['513110', 2.03], ['159660', 1.92], ['513390', 1.62],
  ['159513', 2.13], ['161130', 1.70],
];

export const DEFAULT_RULES = {
  blazingSunTemp: 25,
  fgGreed: 75,
  partlyCloudyTemp: 10,
  overcastTemp: 0,
  rainyTemp: -10,
  vixStorm: 30,
  fgStorm: 20,
};

export const WEATHER_STATES = {
  blazingSun: {
    name: '艳阳高照',
    icon: '☀️',
    glow: 'text-amber-500',
    surfaceClass: 'border-amber-200 bg-gradient-to-r from-amber-50 via-white to-yellow-50 dark:border-amber-900/50 dark:from-amber-950/40 dark:via-slate-900 dark:to-yellow-950/30',
    pageSurfaceClass: 'bg-gradient-to-r from-amber-50 via-white to-yellow-50 dark:from-amber-950/30 dark:via-slate-900 dark:to-yellow-950/20',
    decorClass: 'text-amber-300/70',
    orbClass: 'bg-amber-200/50',
  },
  partlyCloudy: {
    name: '多云见晴',
    icon: '🌤️',
    glow: 'text-amber-500',
    surfaceClass: 'border-sky-200 bg-gradient-to-r from-sky-50 via-white to-amber-50 dark:border-sky-900/50 dark:from-sky-950/40 dark:via-slate-900 dark:to-amber-950/30',
    pageSurfaceClass: 'bg-gradient-to-r from-sky-50 via-white to-amber-50 dark:from-sky-950/30 dark:via-slate-900 dark:to-amber-950/20',
    decorClass: 'text-sky-300/70',
    orbClass: 'bg-sky-200/50',
  },
  overcast: {
    name: '阴云密布',
    icon: '☁️',
    glow: 'text-slate-400',
    surfaceClass: 'border-slate-200 bg-gradient-to-r from-slate-100 via-white to-slate-50 dark:border-slate-700 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800',
    pageSurfaceClass: 'bg-gradient-to-r from-slate-100 via-white to-slate-50 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800',
    decorClass: 'text-slate-300/70',
    orbClass: 'bg-slate-300/50',
  },
  rainy: {
    name: '细雨连绵',
    icon: '🌧️',
    glow: 'text-sky-500',
    surfaceClass: 'border-sky-200 bg-gradient-to-r from-sky-100 via-white to-blue-50 dark:border-sky-900/50 dark:from-sky-950/50 dark:via-slate-900 dark:to-blue-950/30',
    pageSurfaceClass: 'bg-gradient-to-r from-sky-100 via-white to-blue-50 dark:from-sky-950/40 dark:via-slate-900 dark:to-blue-950/20',
    decorClass: 'text-sky-300/70',
    orbClass: 'bg-blue-200/50',
  },
  storm: {
    name: '恐慌雷暴',
    icon: '⚡',
    glow: 'text-indigo-500',
    surfaceClass: 'border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-violet-50 dark:border-indigo-900/50 dark:from-indigo-950/50 dark:via-slate-900 dark:to-violet-950/30',
    pageSurfaceClass: 'bg-gradient-to-r from-indigo-50 via-white to-violet-50 dark:from-indigo-950/40 dark:via-slate-900 dark:to-violet-950/20',
    decorClass: 'text-indigo-300/70',
    orbClass: 'bg-indigo-200/50',
  },
};

function cleanCode(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function findQuote(quoteMap, rawCode) {
  if (!quoteMap || typeof quoteMap !== 'object') return null;
  const code = String(rawCode || '');
  const digits = cleanCode(code);
  const candidates = [code, digits, 'sh' + digits, 'sz' + digits, 'SH' + digits, 'SZ' + digits];
  for (const candidate of candidates) {
    if (quoteMap[candidate] && typeof quoteMap[candidate] === 'object') return quoteMap[candidate];
  }
  return null;
}

function quoteNumber(quote, keys) {
  for (const key of keys) {
    const value = Number(quote?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function useMarketSentimentWeather(rules = DEFAULT_RULES) {
  const [liveQuotes, setLiveQuotes] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError('');
    try {
      const [etfPayload, usPayload] = await Promise.all([
        fetchQuotes(BREADTH_ITEMS.map(([code]) => code)).catch(() => null),
        fetchQuotes(['^VIX', 'CNN_FNG', 'QQQ', 'VOO']).catch(() => null),
      ]);
      const etfQuotes = etfPayload?.quotes || etfPayload || {};
      const usQuotes = usPayload?.quotes || usPayload || {};
      const merged = {
        ...(typeof etfQuotes === 'object' ? etfQuotes : {}),
        ...(typeof usQuotes === 'object' ? usQuotes : {}),
      };
      if (Object.keys(merged).length) setLiveQuotes((previous) => ({ ...previous, ...merged }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '行情指标暂不可用');
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(), 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  const qqqChangePercent = useMemo(() => {
    const value = quoteNumber(findQuote(liveQuotes, 'QQQ'), ['changePercent', 'change_percent', 'pctChange']);
    return value == null ? null : Number(value.toFixed(2));
  }, [liveQuotes]);

  const vooChangePercent = useMemo(() => {
    const value = quoteNumber(findQuote(liveQuotes, 'VOO'), ['changePercent', 'change_percent', 'pctChange']);
    return value == null ? null : Number(value.toFixed(2));
  }, [liveQuotes]);

  const ndxChange = useMemo(() => {
    const value = quoteNumber(findQuote(liveQuotes, 'QQQ'), ['changePercent', 'change', 'pctChange']);
    return value == null ? 0.63 : Number(value.toFixed(2));
  }, [liveQuotes]);

  const fearGreed = useMemo(() => {
    const value = quoteNumber(findQuote(liveQuotes, 'CNN_FNG'), ['price', 'value', 'close']);
    return value == null || value <= 0 ? 29 : Math.round(value);
  }, [liveQuotes]);

  const vix = useMemo(() => {
    const value = quoteNumber(findQuote(liveQuotes, '^VIX'), ['price', 'value', 'close']);
    return value == null || value <= 0 ? 14.81 : Number(value.toFixed(2));
  }, [liveQuotes]);

  const breadth = useMemo(() => {
    let up = 0;
    let down = 0;
    for (const [code, fallback] of BREADTH_ITEMS) {
      const change = quoteNumber(findQuote(liveQuotes, code), ['changePercent', 'change', 'pctChange']);
      if ((change == null ? fallback : change) >= 0) up += 1;
      else down += 1;
    }
    return { up, down };
  }, [liveQuotes]);

  const compositeTemp = useMemo(() => {
    const ndxDelta = ndxChange * 5.2;
    const fgDelta = (fearGreed - 50) * 0.32;
    const vixDelta = vix >= 25 ? -4 - (vix - 25) * 1.2 : vix >= 18 ? -(vix - 18) * 0.5 : (18 - vix) * 0.65;
    const breadthDelta = ((breadth.up - breadth.down) / BREADTH_ITEMS.length) * 4;
    return Math.round((16 + ndxDelta + fgDelta + vixDelta + breadthDelta) * 10) / 10;
  }, [breadth.down, breadth.up, fearGreed, ndxChange, vix]);

  const tempLabel = (compositeTemp >= 0 ? '+' : '') + compositeTemp.toFixed(1) + '°C';
  const effectiveRules = useMemo(() => ({ ...DEFAULT_RULES, ...(rules || {}) }), [rules]);
  const weather = useMemo(() => {
    if (vix >= effectiveRules.vixStorm || fearGreed <= effectiveRules.fgStorm) return WEATHER_STATES.storm;
    if (compositeTemp >= effectiveRules.blazingSunTemp || fearGreed >= effectiveRules.fgGreed) return WEATHER_STATES.blazingSun;
    if (compositeTemp >= effectiveRules.partlyCloudyTemp) return WEATHER_STATES.partlyCloudy;
    if (compositeTemp >= effectiveRules.overcastTemp) return WEATHER_STATES.overcast;
    return WEATHER_STATES.rainy;
  }, [compositeTemp, effectiveRules, fearGreed, vix]);

  return {
    breadth,
    compositeTemp,
    error,
    fearGreed,
    ndxChange,
    qqqChangePercent,
    vooChangePercent,
    refresh,
    refreshing,
    tempLabel,
    vix,
    weather,
  };
}
