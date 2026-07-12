import { useEffect, useMemo } from 'react';

const DEFAULT_FALLBACK_COUNT = 6;
const DEFAULT_REQUEST_LIMIT = 12;

function uniqueSymbols(symbols = []) {
  const list = Array.isArray(symbols) ? symbols : Array.from(symbols || []);
  return Array.from(new Set(list.map((symbol) => String(symbol || '').trim()).filter(Boolean)));
}

export function selectMobileVisibleSymbols({
  orderedSymbols = [],
  intersectingSymbols = [],
  fallbackCount = DEFAULT_FALLBACK_COUNT,
  limit = DEFAULT_REQUEST_LIMIT,
} = {}) {
  const ordered = uniqueSymbols(orderedSymbols);
  const intersecting = new Set(uniqueSymbols(intersectingSymbols));
  const visible = ordered.filter((symbol) => intersecting.has(symbol));
  const selected = visible.length ? visible : ordered.slice(0, Math.max(1, fallbackCount));
  return selected.slice(0, Math.max(1, limit));
}

export function useMobileVisibleMarketSymbols({
  rootRef,
  symbols = [],
  viewKey = '',
  onVisibleSymbolsChange,
}) {
  const orderedSymbols = useMemo(() => uniqueSymbols(symbols), [symbols]);
  const orderedKey = orderedSymbols.join('|');

  useEffect(() => {
    if (typeof onVisibleSymbolsChange !== 'function') return undefined;
    const root = rootRef.current;
    if (!root) return undefined;

    const nodes = Array.from(root.querySelectorAll('[data-market-symbol]'));
    const nodeSymbols = nodes.map((node) => String(node.dataset.marketSymbol || '').trim()).filter(Boolean);
    if (!nodes.length || !nodeSymbols.length) {
      onVisibleSymbolsChange([]);
      return undefined;
    }

    const report = (intersectingSymbols = []) => {
      onVisibleSymbolsChange(selectMobileVisibleSymbols({
        orderedSymbols: nodeSymbols,
        intersectingSymbols,
      }));
    };

    if (typeof IntersectionObserver === 'undefined') {
      report();
      return undefined;
    }

    const intersecting = new Set();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const symbol = String(entry.target?.dataset?.marketSymbol || '').trim();
        if (!symbol) return;
        if (entry.isIntersecting) intersecting.add(symbol);
        else intersecting.delete(symbol);
      });
      report(intersecting);
    }, {
      root,
      rootMargin: '120px 0px 180px',
      threshold: 0.01,
    });

    nodes.forEach((node) => observer.observe(node));
    report();
    return () => observer.disconnect();
  }, [onVisibleSymbolsChange, orderedKey, rootRef, viewKey]);
}
