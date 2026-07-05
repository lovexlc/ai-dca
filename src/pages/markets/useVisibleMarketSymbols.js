import { useCallback, useEffect, useMemo, useState } from 'react';

function uniqueSymbols(symbols = []) {
  return Array.from(new Set(symbols.map((sym) => String(sym || '').trim()).filter(Boolean)));
}

export function useVisibleMarketSymbols({
  fullTableMode,
  selectedSymbol,
  trackedSymbols,
  resetKey,
}) {
  const [visibleSymbols, setVisibleSymbols] = useState([]);
  const handleVisibleSymbolsChange = useCallback((symbols = []) => {
    setVisibleSymbols((prev) => {
      const next = uniqueSymbols(symbols);
      if (next.length === prev.length && next.every((sym, index) => sym === prev[index])) return prev;
      return next;
    });
  }, []);
  const requestedSymbols = useMemo(() => {
    const tracked = Array.isArray(trackedSymbols) ? trackedSymbols : [];
    if (!fullTableMode || selectedSymbol) return tracked;
    if (!visibleSymbols.length) return tracked;
    const trackedSet = new Set(tracked);
    return visibleSymbols.filter((sym) => trackedSet.has(sym));
  }, [fullTableMode, selectedSymbol, trackedSymbols, visibleSymbols]);
  useEffect(() => {
    setVisibleSymbols([]);
  }, [resetKey]);
  return { requestedSymbols, visibleSymbols, handleVisibleSymbolsChange };
}
