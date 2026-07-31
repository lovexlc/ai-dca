import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchListRows } from '../../app/marketsApi.js';
import { normalizeOrderBy, sortingToOrderBy } from '../../app/listQuery.js';

export const OTC_D1_SERVER_SORT_FIELDS = Object.freeze([
  'heldRank',
  'changePercent',
  'price',
  'currentYearPercent',
  'ytdReturn',
  'return1w',
  'return1m',
  'return3m',
  'return6m',
  'return1y',
  'returnBase',
  'maxDrawdown',
  'fundSize',
  'feeRate',
  'managementFeeRate',
  'redeemFeeRate',
  'limit',
  'name',
  'symbol',
]);

const OTC_D1_SERVER_SORT_SET = new Set(OTC_D1_SERVER_SORT_FIELDS);

function uniqueSymbols(symbols = []) {
  return Array.from(new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map((symbol) => String(symbol || '').trim())
      .filter(Boolean)
  ));
}

function hasOrderByValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === 'object' && (value.field || value.id));
}

function normalizeSort(value, { canonical = false } = {}) {
  // `sortingToOrderBy` consumes TanStack `{ id, desc }` state. Once the
  // request has already been normalized to `{ field, dir }`, running it
  // through that mapper again silently turns every direction into `asc`.
  const requested = canonical ? normalizeOrderBy(value) : sortingToOrderBy(value);
  const supported = requested.filter((item) => OTC_D1_SERVER_SORT_SET.has(item.field));
  return normalizeOrderBy(supported.length ? supported : [
    { field: 'heldRank', dir: 'desc' },
    { field: 'changePercent', dir: 'desc' },
  ]);
}

function normalizeSortInput(sorting, orderBy) {
  const hasExplicitOrderBy = hasOrderByValue(orderBy);
  return normalizeSort(
    hasExplicitOrderBy ? orderBy : sorting,
    { canonical: hasExplicitOrderBy }
  );
}

function appendContainsFilters(filters, field, value) {
  const values = Array.isArray(value) ? value : [value];
  values.forEach((item) => {
    const text = String(item || '').trim();
    if (text) filters.push({ field, op: 'contains', value: text });
  });
}

export function columnFiltersToOtcListFilters(columnFilters = []) {
  const filters = [];
  for (const item of Array.isArray(columnFilters) ? columnFilters : []) {
    const field = String(item?.id || '').trim();
    const value = item?.value;
    if (!field || value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
    if (field === 'symbol' || field === 'name') {
      appendContainsFilters(filters, 'q', value);
      continue;
    }
    if (field === 'limit' && Array.isArray(value)) {
      filters.push({ field: 'limit', op: 'in', value });
      continue;
    }
    if (field === 'redeem7d' || field === 'redeem7dStatus' || field === 'quotaStatus' || field === 'quota') {
      filters.push({ field: field === 'quota' ? 'quotaStatus' : field, op: Array.isArray(value) ? 'in' : 'eq', value });
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.min !== '' && value.min != null && Number.isFinite(Number(value.min))) {
        filters.push({ field, op: 'gte', value: Number(value.min) });
      }
      if (value.max !== '' && value.max != null && Number.isFinite(Number(value.max))) {
        filters.push({ field, op: 'lte', value: Number(value.max) });
      }
      continue;
    }
    if (Array.isArray(value)) {
      filters.push({ field, op: 'in', value });
      continue;
    }
    filters.push({ field, op: 'contains', value: String(value) });
  }
  return filters;
}

function responseItems(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

export function buildOtcD1ListRequest({
  symbols = [],
  heldSymbols = [],
  sorting,
  orderBy,
  filters = [],
  limit = 20,
  cursor = null,
} = {}) {
  return {
    market: 'cn',
    isOtcList: true,
    symbols: uniqueSymbols(symbols),
    heldSymbols: uniqueSymbols(heldSymbols),
    orderBy: normalizeSortInput(sorting, orderBy),
    filters,
    limit,
    cursor,
  };
}

export function useOtcD1ListQuery({
  enabled = false,
  symbols = [],
  heldSymbols = [],
  sorting,
  orderBy,
  filters = [],
  limit = 20,
} = {}) {
  const symbolsKey = uniqueSymbols(symbols).join(',');
  const heldSymbolsKey = uniqueSymbols(heldSymbols).join(',');
  const normalizedOrderBy = useMemo(
    () => normalizeSortInput(sorting, orderBy),
    [orderBy, sorting]
  );
  const orderKey = JSON.stringify(normalizedOrderBy);
  const filtersKey = JSON.stringify(filters || []);
  const normalizedFilters = useMemo(() => (Array.isArray(filters) ? filters : []), [filters]);
  const requestKey = useMemo(
    () => `${enabled ? 'on' : 'off'}|${symbolsKey}|${heldSymbolsKey}|${orderKey}|${filtersKey}|${limit}`,
    [enabled, symbolsKey, heldSymbolsKey, orderKey, filtersKey, limit]
  );
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);
  const activeKeyRef = useRef(requestKey);

  useEffect(() => {
    activeKeyRef.current = requestKey;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!enabled || !symbolsKey) {
      setItems([]);
      setNextCursor(null);
      setTotal(0);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      return undefined;
    }
    const controller = new AbortController();
    setItems([]);
    setNextCursor(null);
    setTotal(0);
    setLoading(true);
    setError(null);
    const body = buildOtcD1ListRequest({
      symbols: symbolsKey.split(','),
      heldSymbols: heldSymbolsKey ? heldSymbolsKey.split(',') : [],
      orderBy: normalizedOrderBy,
      filters: normalizedFilters,
      limit,
      cursor: null,
    });
    fetchListRows(body, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted || requestIdRef.current !== requestId || activeKeyRef.current !== requestKey) return;
        setItems(responseItems(payload));
        setNextCursor(payload?.nextCursor || null);
        setTotal(Number(payload?.total) || 0);
      })
      .catch((requestError) => {
        if (controller.signal.aborted || requestIdRef.current !== requestId) return;
        setError(requestError);
      })
      .finally(() => {
        if (!controller.signal.aborted && requestIdRef.current === requestId) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, symbolsKey, heldSymbolsKey, normalizedOrderBy, normalizedFilters, limit, requestKey]);

  const loadMore = useCallback(async () => {
    if (!enabled || !nextCursor || loading || loadingMore) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const body = buildOtcD1ListRequest({
        symbols: symbolsKey.split(','),
        heldSymbols: heldSymbolsKey ? heldSymbolsKey.split(',') : [],
        orderBy: normalizedOrderBy,
        filters: normalizedFilters,
        limit,
        cursor: nextCursor,
      });
      const payload = await fetchListRows(body);
      if (requestIdRef.current !== requestId || activeKeyRef.current !== requestKey) return;
      const seen = new Set(items.map((item) => String(item?.symbol || item?.code || '')));
      const appended = responseItems(payload).filter((item) => {
        const code = String(item?.symbol || item?.code || '');
        if (!code || seen.has(code)) return false;
        seen.add(code);
        return true;
      });
      setItems((previous) => [...previous, ...appended]);
      setNextCursor(payload?.nextCursor || null);
      setTotal(Number(payload?.total) || 0);
    } catch (requestError) {
      if (requestIdRef.current === requestId) setError(requestError);
    } finally {
      if (requestIdRef.current === requestId) setLoadingMore(false);
    }
  }, [enabled, nextCursor, loading, loadingMore, symbolsKey, heldSymbolsKey, normalizedOrderBy, normalizedFilters, limit, items, requestKey]);

  return {
    items,
    nextCursor,
    total,
    hasMore: Boolean(nextCursor),
    loading,
    loadingMore,
    error,
    loadMore,
  };
}
