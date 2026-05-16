// rangeUrlSync.js
//
// 「镜头 ↔ URL 查询串」双向同步。
//   ?range=ytd                  → { range: 'ytd' }
//   ?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD → { range: 'custom', customFrom, customTo }
//
// 设计工艺：
//   - 纯函数 parseRangeFromSearch / buildRangeSearch 可独立测试。
//   - useRangeUrlSync 是薄包装：初创从 URL 读，后续 setRange 会 history.replaceState。
//   - 不依赖 react-router；直接操作 window.location + history。
//   - SSR / Node 环境下同样安静 (仅返回 defaults)。

import { useCallback, useEffect, useState } from 'react';

export const VALID_RANGES = Object.freeze([
  'today',
  'week',
  'lastWeek',
  'month',
  'lastMonth',
  'ytd',
  'year',
  'lastYear',
  'last365d',
  'sinceInception',
  'custom'
]);

export const DEFAULT_RANGE = 'ytd';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidRange(value) {
  return typeof value === 'string' && VALID_RANGES.includes(value);
}

function isValidIsoDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value);
}

/** Parse a query string ('?range=...&from=...&to=...') into a state object. */
export function parseRangeFromSearch(search, { defaultRange = DEFAULT_RANGE } = {}) {
  let params;
  try {
    params = new URLSearchParams(search || '');
  } catch (_) {
    return { range: defaultRange, customFrom: null, customTo: null };
  }
  const rawRange = params.get('range');
  const range = isValidRange(rawRange) ? rawRange : defaultRange;
  const from = params.get('from');
  const to = params.get('to');
  const customFrom = isValidIsoDate(from) ? from : null;
  const customTo = isValidIsoDate(to) ? to : null;
  if (range === 'custom' && (!customFrom || !customTo || customFrom > customTo)) {
    // 不完整的 custom 参数 → 退回默认镜头。
    return { range: defaultRange, customFrom: null, customTo: null };
  }
  return { range, customFrom, customTo };
}

/** Serialize a state object back to a query string (without leading '?'). */
export function buildRangeSearch(state, { defaultRange = DEFAULT_RANGE } = {}) {
  const params = new URLSearchParams();
  const range = isValidRange(state?.range) ? state.range : defaultRange;
  if (range !== defaultRange) params.set('range', range);
  if (range === 'custom') {
    if (isValidIsoDate(state?.customFrom)) params.set('from', state.customFrom);
    if (isValidIsoDate(state?.customTo)) params.set('to', state.customTo);
  }
  const out = params.toString();
  return out ? `?${out}` : '';
}

function readCurrentLocationSearch() {
  if (typeof window === 'undefined' || !window.location) return '';
  return window.location.search || '';
}

function mergeOtherParams(currentSearch, nextRangeSearch) {
  // 保留 URL 上非镜头相关的查询参数。
  let current;
  try {
    current = new URLSearchParams(currentSearch || '');
  } catch (_) {
    return nextRangeSearch || '';
  }
  for (const key of ['range', 'from', 'to']) current.delete(key);
  let nextRangeParams;
  try {
    nextRangeParams = new URLSearchParams((nextRangeSearch || '').replace(/^\?/, ''));
  } catch (_) {
    nextRangeParams = new URLSearchParams();
  }
  for (const [k, v] of nextRangeParams.entries()) current.set(k, v);
  const s = current.toString();
  return s ? `?${s}` : '';
}

function writeLocationSearch(nextSearch) {
  if (typeof window === 'undefined' || !window.history || !window.location) return;
  const currentSearch = window.location.search || '';
  if (currentSearch === nextSearch) return;
  const newUrl = window.location.pathname + nextSearch + window.location.hash;
  try {
    window.history.replaceState(window.history.state, '', newUrl);
  } catch (_) {
    // ignore (e.g. file://)
  }
}

/**
 * React hook: 同步「镜头 + custom 区间」与 URL 查询串。
 * 返回 [state, setRange, setCustom]：
 *   - state.range / state.customFrom / state.customTo
 *   - setRange('week' 等)
 *   - setCustom({ from, to }) → 自动带上 range='custom'
 */
export function useRangeUrlSync({ defaultRange = DEFAULT_RANGE } = {}) {
  const [state, setState] = useState(() => parseRangeFromSearch(readCurrentLocationSearch(), { defaultRange }));

  // 听 popstate (用户进退)，重新同步。
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function onPop() {
      setState(parseRangeFromSearch(readCurrentLocationSearch(), { defaultRange }));
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [defaultRange]);

  // state 变化 → 写回 URL。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const next = buildRangeSearch(state, { defaultRange });
    const merged = mergeOtherParams(readCurrentLocationSearch(), next);
    writeLocationSearch(merged);
  }, [state, defaultRange]);

  const setRange = useCallback((nextRange) => {
    if (!isValidRange(nextRange)) return;
    setState((prev) => {
      if (prev.range === nextRange) return prev;
      if (nextRange !== 'custom') {
        return { range: nextRange, customFrom: null, customTo: null };
      }
      return { ...prev, range: 'custom' };
    });
  }, []);

  const setCustom = useCallback(({ from, to }) => {
    if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) return;
    setState({ range: 'custom', customFrom: from, customTo: to });
  }, []);

  return [state, setRange, setCustom];
}

export const __internals = {
  isValidRange,
  isValidIsoDate,
  mergeOtherParams
};
