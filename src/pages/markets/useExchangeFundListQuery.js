import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchExchangeFundList, getExchangeFundWebSocketUrl } from '../../app/marketsApi.js';
import { queryListRows, sortingToOrderBy } from '../../app/listQuery.js';
import { normalizeCnFundCode } from './marketDisplayUtils.js';
import { applyMarketDetailFilters } from './marketListFilters.js';

export const EXCHANGE_FUND_SERVER_SORT_FIELDS = Object.freeze([
  'heldRank',
  'symbol',
  'name',
  'price',
  'changePercent',
  'change',
  'open',
  'high',
  'low',
  'previousClose',
  'volume',
  'turnover',
  'marketCapital',
  'iopv',
  'premiumPercent',
  'premium',
  'currentYearPercent',
  'ytdReturn',
  'return1w',
  'return1m',
  'return3m',
  'return6m',
  'return1y',
  'returnBase',
  'totalShares',
  'historicalPercentile',
  'highDrawdown',
  'closeHighDrawdown',
  'drawdownPercentile',
  'marketState',
  'asOf',
]);

function uniqueSymbols(symbols = []) {
  return Array.from(new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map((symbol) => String(symbol || '').trim())
      .filter(Boolean)
  ));
}

function codeFor(value) {
  return normalizeCnFundCode(value) || String(value || '').trim();
}

function normalizeSnapshotItems(items = []) {
  const byCode = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const code = codeFor(item?.code || item?.symbol);
    if (!code) continue;
    byCode.set(code, { ...item, code, symbol: code });
  }
  return Array.from(byCode.values());
}

function mergeRowsWithLocalMetadata(remoteItems, localRows, heldSymbols) {
  const localList = Array.isArray(localRows) ? localRows : [];
  const localByCode = new Map(localList
    .map((row) => [codeFor(row?.code || row?.symbol), row])
    .filter(([code]) => Boolean(code)));
  const remoteCodes = new Set(remoteItems.map((item) => codeFor(item?.code || item?.symbol)));
  const heldCodes = new Set(uniqueSymbols(heldSymbols).map(codeFor));
  const rows = [
    ...remoteItems,
    // A custom watchlist may contain a valid LOF/ETF that is not in the
    // Worker warmup universe yet. Keep that row visible with the existing
    // lightweight quote until the next snapshot covers it.
    ...localList.filter((row) => {
      const code = codeFor(row?.code || row?.symbol);
      return code && !remoteCodes.has(code);
    }),
  ];
  return rows.map((item) => {
    const local = localByCode.get(codeFor(item.code || item.symbol));
    const merged = local ? { ...local, ...item } : item;
    // The DO is authoritative for live quote fields, while local metadata can
    // still provide labels and cached list-only fields during rollout.
    if (local) {
      Object.entries(local).forEach(([key, value]) => {
        if ((merged[key] == null || merged[key] === '') && value != null && value !== '') merged[key] = value;
      });
    }
    return {
      ...merged,
      code: codeFor(merged.code || merged.symbol),
      symbol: codeFor(merged.symbol || merged.code),
      isHeld: heldCodes.has(codeFor(merged.code || merged.symbol)),
    };
  });
}

function applyPatch(previousItems, changedItems, removedCodes, allowedSymbols = []) {
  const next = new Map(normalizeSnapshotItems(previousItems).map((item) => [codeFor(item.code || item.symbol), item]));
  const allowedCodes = new Set(uniqueSymbols(allowedSymbols).map(codeFor));
  for (const code of Array.isArray(removedCodes) ? removedCodes : []) next.delete(codeFor(code));
  for (const item of normalizeSnapshotItems(changedItems)) {
    const code = codeFor(item.code || item.symbol);
    if (!allowedCodes.size || allowedCodes.has(code)) next.set(code, item);
  }
  return Array.from(next.values());
}

export function useExchangeFundListQuery({
  enabled = false,
  symbols = [],
  heldSymbols = [],
  sorting,
  rows = [],
  query = '',
  heldOnly = false,
  detailFilters = [],
  limit = 100,
} = {}) {
  const symbolsKey = useMemo(() => uniqueSymbols(symbols).join(','), [symbols]);
  const heldSymbolsKey = useMemo(() => uniqueSymbols(heldSymbols).join(','), [heldSymbols]);
  const sortingKey = JSON.stringify(sorting || []);
  const orderBy = useMemo(() => sortingToOrderBy(sorting), [sorting]);
  const orderKey = JSON.stringify(orderBy);
  const detailFiltersKey = JSON.stringify(detailFilters || []);
  const [snapshotItems, setSnapshotItems] = useState([]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!enabled || !symbolsKey) {
      setSnapshotItems([]);
      setReady(false);
      setLoading(false);
      setError(null);
      setGeneratedAt('');
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchExchangeFundList({
      symbols: symbolsKey.split(','),
      heldSymbols: heldSymbolsKey ? heldSymbolsKey.split(',') : [],
      orderBy,
      // The universe is intentionally small. Keep the complete snapshot in
      // the browser so sorting/filtering never needs another heavy request.
      limit: Math.max(100, limit),
      offset: 0,
    }, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted || requestIdRef.current !== requestId) return;
        const items = normalizeSnapshotItems(payload?.items).filter((item) => (
          !symbolsKey || symbolsKey.split(',').map(codeFor).includes(codeFor(item.code || item.symbol))
        ));
        setSnapshotItems(items);
        setReady(Boolean(payload?.ready && items.length));
        setGeneratedAt(String(payload?.generatedAt || ''));
      })
      .catch((requestError) => {
        if (controller.signal.aborted || requestIdRef.current !== requestId) return;
        setError(requestError);
        setReady(false);
      })
      .finally(() => {
        if (!controller.signal.aborted && requestIdRef.current === requestId) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, symbolsKey, heldSymbolsKey, orderBy, orderKey, limit]);

  useEffect(() => {
    if (!enabled || !symbolsKey || typeof globalThis.WebSocket !== 'function') {
      setRealtimeConnected(false);
      return undefined;
    }
    let stopped = false;
    let socket = null;
    let reconnectTimer = null;
    let retryCount = 0;

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer || retryCount >= 8) return;
      const delay = Math.min(15000, 1000 * (2 ** retryCount));
      retryCount += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (stopped) return;
      try {
        socket = new globalThis.WebSocket(getExchangeFundWebSocketUrl({
          symbols: symbolsKey.split(','),
          heldSymbols: heldSymbolsKey ? heldSymbolsKey.split(',') : [],
        }));
      } catch {
        setRealtimeConnected(false);
        scheduleReconnect();
        return;
      }
      socket.onopen = () => {
        retryCount = 0;
        setRealtimeConnected(true);
        socket?.send(JSON.stringify({
          type: 'subscribe',
          symbols: symbolsKey.split(','),
          heldSymbols: heldSymbolsKey ? heldSymbolsKey.split(',') : [],
        }));
      };
      socket.onmessage = (event) => {
        let payload;
        try {
          payload = JSON.parse(String(event.data || ''));
        } catch {
          return;
        }
        if (payload?.type === 'exchange_fund_snapshot') {
          const requestedCodes = new Set(symbolsKey.split(',').map(codeFor));
          const items = normalizeSnapshotItems(payload.items).filter((item) => requestedCodes.has(codeFor(item.code || item.symbol)));
          setSnapshotItems(items);
          if (items.length) setReady(true);
          setGeneratedAt(String(payload.generatedAt || ''));
        } else if (payload?.type === 'exchange_fund_patch') {
          setSnapshotItems((previous) => applyPatch(previous, payload.items, payload.removed, symbolsKey.split(',')));
          if (Array.isArray(payload.items) && payload.items.length) setReady(true);
          setGeneratedAt(String(payload.generatedAt || ''));
        }
      };
      socket.onerror = () => setRealtimeConnected(false);
      socket.onclose = () => {
        setRealtimeConnected(false);
        scheduleReconnect();
      };
    };

    connect();
    const heartbeat = setInterval(() => {
      if (socket?.readyState === globalThis.WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, 30000);
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(heartbeat);
      setRealtimeConnected(false);
      try { socket?.close(); } catch { /* already closed */ }
    };
  }, [enabled, symbolsKey, heldSymbolsKey]);

  const visibleRows = useMemo(() => {
    const merged = applyMarketDetailFilters(
      mergeRowsWithLocalMetadata(snapshotItems, rows, heldSymbols),
      Array.isArray(detailFilters) ? detailFilters : []
    );
    const filters = [];
    if (heldOnly) filters.push({ field: 'held', op: 'eq', value: true });
    if (String(query || '').trim()) filters.push({ field: 'q', op: 'contains', value: String(query).trim() });
    return queryListRows(merged, {
      orderBy,
      limit: Math.max(1, limit),
      filters,
    });
  }, [detailFilters, detailFiltersKey, heldOnly, heldSymbols, limit, orderBy, query, rows, snapshotItems]);

  return {
    items: visibleRows.items,
    total: visibleRows.total,
    hasMore: false,
    loading,
    loadingMore: false,
    error,
    ready,
    generatedAt,
    realtimeConnected,
    loadMore: () => {},
  };
}
