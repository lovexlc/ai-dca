/**
 * SQL-style list query: ORDER BY + LIMIT (+ keyset cursor) + filters.
 * Shared semantics for markets mobile list, desktop table intent, and Worker /list-rows.
 *
 * Example:
 *   queryListRows(rows, {
 *     orderBy: [{ field: 'changePercent', dir: 'desc' }, { field: 'symbol', dir: 'asc' }],
 *     limit: 20,
 *     cursor: null,
 *     filters: [{ field: 'held', op: 'eq', value: true }],
 *   })
 */

export const LIST_QUERY_DEFAULT_LIMIT = 20;
export const LIST_QUERY_MAX_LIMIT = 100;
export const LIST_QUERY_TIE_BREAKER = 'symbol';

/** Fields the list query engine knows how to ORDER BY / filter. */
export const LIST_QUERY_SORT_FIELDS = Object.freeze([
  'heldRank',
  'changePercent',
  'price',
  'premium',
  'limit',
  'return1m',
  'return3m',
  'return1y',
  'name',
  'symbol',
]);

const FILTER_OPS = new Set(['eq', 'neq', 'in', 'contains', 'gt', 'gte', 'lt', 'lte']);

function asFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolvePremium(row) {
  const n = asFiniteNumber(row?.premiumPercent ?? row?.premium_rate ?? row?.premium);
  return n;
}

function resolveLimitAmount(row) {
  const limit = row?.fundLimit || row?.limit || null;
  if (!limit) return null;
  const status = String(limit.buyStatus || '').toLowerCase();
  if (status === 'suspended' || status === 'closed') return 0;
  const amount = asFiniteNumber(limit.maxPurchasePerDay);
  if (amount != null) return amount;
  if (status === 'open') return Number.POSITIVE_INFINITY;
  return null;
}

/**
 * Extract a comparable sort value for one field.
 * Numbers may be null (sort last). Strings are lowercased for locale-ish compare.
 */
export function rowSortValue(row, field) {
  const key = String(field || '').trim();
  switch (key) {
    case 'heldRank':
      return row?.isHeld || row?.held ? 1 : 0;
    case 'changePercent':
      return asFiniteNumber(row?.changePercent);
    case 'price':
      return asFiniteNumber(row?.price ?? row?.latestNav ?? row?.currentPrice);
    case 'premium':
      return resolvePremium(row);
    case 'limit':
      return resolveLimitAmount(row);
    case 'return1m':
      return asFiniteNumber(row?.return1m);
    case 'return3m':
      return asFiniteNumber(row?.return3m);
    case 'return1y':
      return asFiniteNumber(row?.return1y);
    case 'name':
      return String(row?.name || '').toLowerCase();
    case 'symbol':
      return String(row?.symbol || row?.code || '').toLowerCase();
    default:
      return asFiniteNumber(row?.[key]) ?? String(row?.[key] ?? '').toLowerCase();
  }
}

export function normalizeOrderBy(orderBy, { ensureTieBreaker = true } = {}) {
  const list = [];
  const seen = new Set();
  const raw = Array.isArray(orderBy) ? orderBy : orderBy && orderBy.field ? [orderBy] : [];
  for (const item of raw) {
    if (!item) continue;
    const field = String(item.field || item.id || '').trim();
    if (!field || seen.has(field)) continue;
    const dirRaw = String(item.dir || item.direction || (item.desc ? 'desc' : 'asc')).toLowerCase();
    const dir = dirRaw === 'desc' ? 'desc' : 'asc';
    list.push({ field, dir });
    seen.add(field);
  }
  if (!list.length) {
    list.push({ field: 'heldRank', dir: 'desc' }, { field: 'changePercent', dir: 'desc' });
  }
  if (ensureTieBreaker && !seen.has(LIST_QUERY_TIE_BREAKER)) {
    list.push({ field: LIST_QUERY_TIE_BREAKER, dir: 'asc' });
  }
  return list;
}

export function normalizeFilters(filters) {
  const out = [];
  for (const item of Array.isArray(filters) ? filters : []) {
    if (!item || item.field == null) continue;
    const field = String(item.field).trim();
    if (!field) continue;
    const op = String(item.op || 'eq').toLowerCase();
    if (!FILTER_OPS.has(op)) continue;
    out.push({ field, op, value: item.value });
  }
  return out;
}

export function normalizeListQuery(query = {}) {
  const limitRaw = Number(query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), LIST_QUERY_MAX_LIMIT)
    : LIST_QUERY_DEFAULT_LIMIT;
  return {
    orderBy: normalizeOrderBy(query.orderBy || query.sorting),
    limit,
    cursor: query.cursor == null || query.cursor === '' ? null : String(query.cursor),
    offset: Number.isFinite(Number(query.offset)) && Number(query.offset) > 0
      ? Math.floor(Number(query.offset))
      : 0,
    filters: normalizeFilters(query.filters),
  };
}

/** Map TanStack / legacy `{ id, desc }` sorting to orderBy. */
export function sortingToOrderBy(sorting) {
  if (Array.isArray(sorting)) {
    return normalizeOrderBy(
      sorting.map((item) => ({
        field: item?.id || item?.field,
        dir: item?.desc ? 'desc' : 'asc',
      }))
    );
  }
  if (sorting && (sorting.id || sorting.field)) {
    return normalizeOrderBy([{
      field: sorting.id || sorting.field,
      dir: sorting.desc ? 'desc' : 'asc',
    }]);
  }
  return normalizeOrderBy([]);
}

/** Map orderBy back to a primary TanStack-style sort (first non-tie field). */
export function orderByToSorting(orderBy) {
  const list = normalizeOrderBy(orderBy, { ensureTieBreaker: false });
  const primary = list.find((item) => item.field !== LIST_QUERY_TIE_BREAKER) || list[0];
  if (!primary) return { id: 'heldRank', desc: true };
  return { id: primary.field, desc: primary.dir === 'desc' };
}

function toBase64(text) {
  const input = String(text || '');
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(unescape(encodeURIComponent(input)));
  }
  if (typeof globalThis.Buffer === 'function' || typeof globalThis.Buffer?.from === 'function') {
    return globalThis.Buffer.from(input, 'utf8').toString('base64');
  }
  // Minimal utf8 -> base64 for Workers/Node without relying on bare globals in lint.
  const bytes = new globalThis.TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(binary);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? alphabet[triple & 63] : '=';
  }
  return out;
}

function fromBase64(raw) {
  const input = String(raw || '');
  if (typeof globalThis.atob === 'function') {
    return decodeURIComponent(escape(globalThis.atob(input)));
  }
  if (typeof globalThis.Buffer?.from === 'function') {
    return globalThis.Buffer.from(input, 'base64').toString('utf8');
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = input.replace(/=+$/, '');
  const bytes = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => {
      const ch = clean[i + k];
      return ch ? alphabet.indexOf(ch) : 0;
    });
    const triple = (n[0] << 18) | (n[1] << 12) | (n[2] << 6) | n[3];
    bytes.push((triple >> 16) & 255);
    if (i + 2 < clean.length || clean.length % 4 === 0) {
      if (n[2] != null && clean[i + 2]) bytes.push((triple >> 8) & 255);
      if (n[3] != null && clean[i + 3]) bytes.push(triple & 255);
    }
  }
  return new globalThis.TextDecoder().decode(Uint8Array.from(bytes));
}

function sanitizeCursorPayload(value) {
  if (value === Number.POSITIVE_INFINITY) return { __num: 'inf' };
  if (value === Number.NEGATIVE_INFINITY) return { __num: '-inf' };
  if (typeof value === 'number' && Number.isNaN(value)) return null;
  if (Array.isArray(value)) return value.map(sanitizeCursorPayload);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeCursorPayload(v);
    return out;
  }
  return value;
}

export function encodeListCursor(payload) {
  try {
    return toBase64(JSON.stringify(sanitizeCursorPayload(payload || {})));
  } catch {
    return '';
  }
}

export function decodeListCursor(cursor) {
  if (cursor == null || cursor === '') return null;
  try {
    const parsed = JSON.parse(fromBase64(String(cursor)));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function compareSortValues(av, bv, dir) {
  const desc = dir === 'desc';
  // Treat only NaN as missing numeric; keep ±Infinity for open/unlimited limits.
  const aNull = av == null || av === '' || (typeof av === 'number' && Number.isNaN(av));
  const bNull = bv == null || bv === '' || (typeof bv === 'number' && Number.isNaN(bv));
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  if (typeof av === 'number' && typeof bv === 'number') {
    if (av === bv) return 0;
    return desc ? (bv - av) : (av - bv);
  }

  const as = String(av);
  const bs = String(bv);
  const cmp = as < bs ? -1 : as > bs ? 1 : 0;
  return desc ? -cmp : cmp;
}

export function compareRowsByOrder(a, b, orderBy) {
  const specs = normalizeOrderBy(orderBy);
  for (const spec of specs) {
    const cmp = compareSortValues(rowSortValue(a, spec.field), rowSortValue(b, spec.field), spec.dir);
    if (cmp) return cmp;
  }
  return 0;
}

function filterValue(row, field) {
  if (field === 'held' || field === 'isHeld' || field === 'heldRank') {
    return Boolean(row?.isHeld || row?.held);
  }
  if (field === 'q' || field === 'query' || field === 'search') {
    return [row?.symbol, row?.code, row?.name, row?.meta].filter(Boolean).join(' ').toLowerCase();
  }
  if (field === 'premium') return resolvePremium(row);
  if (field === 'limit') return resolveLimitAmount(row);
  if (field === 'price') return asFiniteNumber(row?.price ?? row?.latestNav);
  if (field === 'changePercent') return asFiniteNumber(row?.changePercent);
  return row?.[field];
}

export function rowMatchesFilter(row, filter) {
  if (!filter) return true;
  const { field, op, value } = filter;
  const actual = filterValue(row, field);

  switch (op) {
    case 'eq':
      if (typeof value === 'boolean') return Boolean(actual) === value;
      return actual === value || String(actual) === String(value);
    case 'neq':
      if (typeof value === 'boolean') return Boolean(actual) !== value;
      return actual !== value && String(actual) !== String(value);
    case 'in': {
      const set = Array.isArray(value) ? value.map(String) : [String(value)];
      return set.includes(String(actual));
    }
    case 'contains': {
      const q = String(value || '').trim().toLowerCase();
      if (!q) return true;
      return String(actual || '').toLowerCase().includes(q);
    }
    case 'gt':
      return asFiniteNumber(actual) != null && asFiniteNumber(actual) > Number(value);
    case 'gte':
      return asFiniteNumber(actual) != null && asFiniteNumber(actual) >= Number(value);
    case 'lt':
      return asFiniteNumber(actual) != null && asFiniteNumber(actual) < Number(value);
    case 'lte':
      return asFiniteNumber(actual) != null && asFiniteNumber(actual) <= Number(value);
    default:
      return true;
  }
}

export function applyListFilters(rows, filters) {
  const list = Array.isArray(rows) ? rows : [];
  const specs = normalizeFilters(filters);
  if (!specs.length) return list;
  return list.filter((row) => specs.every((filter) => rowMatchesFilter(row, filter)));
}

function sanitizeCursorValue(value) {
  if (value === Number.POSITIVE_INFINITY) return { __num: 'inf' };
  if (value === Number.NEGATIVE_INFINITY) return { __num: '-inf' };
  if (typeof value === 'number' && Number.isNaN(value)) return null;
  return value;
}

function reviveCursorValue(value) {
  if (value && typeof value === 'object' && value.__num === 'inf') return Number.POSITIVE_INFINITY;
  if (value && typeof value === 'object' && value.__num === '-inf') return Number.NEGATIVE_INFINITY;
  return value;
}

function cursorTuple(row, orderBy) {
  return normalizeOrderBy(orderBy).map((spec) => ({
    field: spec.field,
    dir: spec.dir,
    value: sanitizeCursorValue(rowSortValue(row, spec.field)),
  }));
}

function rowAfterCursor(row, cursor, orderBy) {
  if (!cursor || !Array.isArray(cursor.tuple) || !cursor.tuple.length) return true;
  // Keyset: keep rows strictly "after" the last page in ORDER BY order.
  // Equivalent to WHERE (c1, c2, ...)  monotoically after last tuple.
  const specs = normalizeOrderBy(orderBy);
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    const cursorItem = cursor.tuple[i];
    const av = rowSortValue(row, spec.field);
    const bv = cursorItem ? reviveCursorValue(cursorItem.value) : null;
    const cmp = compareSortValues(av, bv, spec.dir);
    if (cmp < 0) return false; // before cursor in sort order
    if (cmp > 0) return true; // after cursor
    // equal on this key → continue
  }
  return false; // exact match of last row → skip
}

/**
 * Apply filters, ORDER BY, and LIMIT with optional keyset cursor or offset.
 *
 * @returns {{ items: any[], total: number, nextCursor: string|null, applied: object }}
 */
export function queryListRows(rows, query = {}) {
  const applied = normalizeListQuery(query);
  const filtered = applyListFilters(rows, applied.filters);
  const sorted = filtered.slice().sort((a, b) => compareRowsByOrder(a, b, applied.orderBy));

  let startIndex = 0;
  const decoded = decodeListCursor(applied.cursor);
  if (decoded && Array.isArray(decoded.tuple) && decoded.tuple.length) {
    let i = 0;
    for (; i < sorted.length; i += 1) {
      if (rowAfterCursor(sorted[i], decoded, applied.orderBy)) break;
    }
    startIndex = i;
  } else if (applied.offset > 0) {
    startIndex = Math.min(applied.offset, sorted.length);
  }

  const slice = sorted.slice(startIndex, startIndex + applied.limit);
  const hasMore = startIndex + slice.length < sorted.length;
  let nextCursor = null;
  if (hasMore && slice.length) {
    const last = slice[slice.length - 1];
    nextCursor = encodeListCursor({
      tuple: cursorTuple(last, applied.orderBy),
      symbol: String(last?.symbol || last?.code || ''),
    });
  }

  return {
    items: slice,
    total: sorted.length,
    nextCursor,
    hasMore,
    applied: {
      orderBy: applied.orderBy,
      limit: applied.limit,
      cursor: applied.cursor,
      offset: applied.offset,
      filters: applied.filters,
    },
  };
}

/** Serialize orderBy for query strings: changePercent:desc,symbol:asc */
export function serializeOrderBy(orderBy) {
  return normalizeOrderBy(orderBy)
    .map((item) => `${item.field}:${item.dir}`)
    .join(',');
}

export function parseOrderByParam(raw) {
  const text = String(raw || '').trim();
  if (!text) return normalizeOrderBy([]);
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  return normalizeOrderBy(parts.map((part) => {
    const [field, dir] = part.split(':');
    return { field, dir: dir || 'asc' };
  }));
}
