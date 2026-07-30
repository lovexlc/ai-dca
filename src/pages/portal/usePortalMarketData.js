import { useEffect, useMemo, useState } from 'react';
import { fetchQuotes } from '../markets/marketsApiLoader.js';
import { useVisibleMarketSymbols } from '../markets/useVisibleMarketSymbols.js';
import { createPortalQuoteCache } from './portalQuoteCache.js';

const quoteCache = createPortalQuoteCache();
const inflightBySymbolSet = new Map();

function uniqueSymbols(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function cacheEntryFor(symbol) {
  return quoteCache.get(symbol);
}

function cacheQuotes(quotes = {}) {
  quoteCache.setMany(quotes);
}

function readCachedQuotes(symbols = []) {
  const cached = {};
  const missing = [];
  symbols.forEach((symbol) => {
    const quote = cacheEntryFor(symbol);
    if (quote) cached[symbol] = quote;
    else missing.push(symbol);
  });
  return { cached, missing };
}

export function usePortalMarketData({ symbols = [], market = 'cn' } = {}) {
  const trackedSymbols = useMemo(() => uniqueSymbols(symbols), [symbols]);
  const { requestedSymbols } = useVisibleMarketSymbols({
    fullTableMode: false,
    selectedSymbol: '',
    trackedSymbols,
    resetKey: `${market}|${trackedSymbols.join(',')}`,
  });
  const symbolKey = requestedSymbols.join(',');
  const [state, setState] = useState({ quotes: {}, loading: false, error: '' });

  useEffect(() => {
    let cancelled = false;
    const currentSymbols = symbolKey ? symbolKey.split(',') : [];
    if (!currentSymbols.length) {
      setState({ quotes: {}, loading: false, error: '' });
      return undefined;
    }

    const { cached, missing } = readCachedQuotes(currentSymbols);
    setState({ quotes: cached, loading: missing.length > 0, error: '' });
    if (!missing.length) return undefined;

    const requestKey = missing.slice().sort().join(',');
    let request = inflightBySymbolSet.get(requestKey);
    if (!request) {
      request = fetchQuotes(missing).then((payload) => {
        const quotes = payload?.quotes && typeof payload.quotes === 'object' ? payload.quotes : {};
        cacheQuotes(quotes);
        return quotes;
      }).finally(() => {
        inflightBySymbolSet.delete(requestKey);
      });
      inflightBySymbolSet.set(requestKey, request);
    }

    request.then((quotes) => {
      if (cancelled) return;
      const merged = { ...cached };
      currentSymbols.forEach((symbol) => {
        const quote = quotes?.[symbol] || cacheEntryFor(symbol);
        if (quote) merged[symbol] = quote;
      });
      setState({ quotes: merged, loading: false, error: '' });
    }).catch(() => {
      if (!cancelled) setState({ quotes: cached, loading: false, error: '行情暂不可用' });
    });

    return () => { cancelled = true; };
  }, [market, symbolKey]);

  return state;
}
