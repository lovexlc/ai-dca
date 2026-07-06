function uniqueSymbols(symbols = []) {
  return Array.from(new Set((Array.isArray(symbols) ? symbols : [])
    .map((symbol) => String(symbol || '').trim())
    .filter(Boolean)));
}

export function selectMarketRealtimeSymbols({
  trackedWatchSymbols = [],
  requestedWatchSymbols = [],
  visibleWatchSymbols = [],
  selectedSymbol = '',
  fullTableMode = false,
} = {}) {
  const selected = String(selectedSymbol || '').trim();
  if (selected) return [selected];

  if (fullTableMode) {
    const trackedSet = new Set(uniqueSymbols(trackedWatchSymbols));
    return uniqueSymbols(visibleWatchSymbols).filter((symbol) => trackedSet.has(symbol));
  }

  return uniqueSymbols(requestedWatchSymbols);
}
