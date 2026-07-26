import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIST_QUERY_DEFAULT_LIMIT,
  compareRowsByOrder,
  decodeListCursor,
  encodeListCursor,
  normalizeOrderBy,
  orderByToSorting,
  parseOrderByParam,
  queryListRows,
  serializeOrderBy,
  sortingToOrderBy,
} from '../src/app/listQuery.js';

import { queryMobileFundPage, sortMobileRows } from '../src/pages/markets/mobileFundMetrics.js';
import { buildListRowFromQuote } from '../workers/markets/src/listRowsRoute.js';

function sampleRows() {
  return [
    { symbol: 'A', name: 'alpha', changePercent: 0.01, price: 1, isHeld: false },
    { symbol: 'B', name: 'beta', changePercent: 0.05, price: 2, isHeld: true },
    { symbol: 'C', name: 'gamma', changePercent: 0.08, price: 3, isHeld: false },
    { symbol: 'D', name: 'delta', changePercent: 0.05, price: 4, isHeld: false },
  ];
}

test('normalizeOrderBy adds symbol tie-breaker like stable ORDER BY id', () => {
  const orderBy = normalizeOrderBy([{ field: 'changePercent', dir: 'desc' }]);
  assert.deepEqual(orderBy, [
    { field: 'changePercent', dir: 'desc' },
    { field: 'symbol', dir: 'asc' },
  ]);
});

test('sortingToOrderBy and orderByToSorting round-trip primary field', () => {
  const orderBy = sortingToOrderBy({ id: 'premium', desc: true });
  assert.equal(orderBy[0].field, 'premium');
  assert.equal(orderBy[0].dir, 'desc');
  assert.deepEqual(orderByToSorting(orderBy), { id: 'premium', desc: true });
});

test('queryListRows ORDER BY changePercent DESC LIMIT 2', () => {
  const page = queryListRows(sampleRows(), {
    orderBy: [{ field: 'changePercent', dir: 'desc' }],
    limit: 2,
  });
  assert.equal(page.total, 4);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].symbol, 'C');
  // B held soft? no soft held in listQuery unless heldRank field
  assert.equal(page.items[1].symbol, 'B'); // 0.05, symbol B before D
  assert.ok(page.nextCursor);
  assert.equal(page.hasMore, true);
});

test('queryListRows keyset cursor continues without overlap', () => {
  const orderBy = [{ field: 'changePercent', dir: 'desc' }];
  const first = queryListRows(sampleRows(), { orderBy, limit: 2 });
  const second = queryListRows(sampleRows(), {
    orderBy,
    limit: 2,
    cursor: first.nextCursor,
  });
  const symbols = [...first.items, ...second.items].map((r) => r.symbol);
  assert.deepEqual(symbols, ['C', 'B', 'D', 'A']);
  assert.equal(second.nextCursor, null);
  assert.equal(second.hasMore, false);
});

test('filters held + contains query like WHERE', () => {
  const page = queryListRows(sampleRows(), {
    orderBy: [{ field: 'symbol', dir: 'asc' }],
    limit: 10,
    filters: [
      { field: 'held', op: 'eq', value: true },
    ],
  });
  assert.deepEqual(page.items.map((r) => r.symbol), ['B']);

  const search = queryListRows(sampleRows(), {
    orderBy: [{ field: 'symbol', dir: 'asc' }],
    limit: 10,
    filters: [{ field: 'q', op: 'contains', value: 'gam' }],
  });
  assert.deepEqual(search.items.map((r) => r.symbol), ['C']);
});

test('serializeOrderBy parses like SQL order clause tokens', () => {
  const s = serializeOrderBy([{ field: 'price', dir: 'asc' }]);
  assert.match(s, /price:asc/);
  assert.match(s, /symbol:asc/);
  const parsed = parseOrderByParam(s);
  assert.equal(parsed[0].field, 'price');
});

test('cursor encode/decode preserves infinity for open purchase limits', () => {
  const rows = [
    { symbol: 'A', fundLimit: { buyStatus: 'open' } },
    { symbol: 'B', fundLimit: { buyStatus: 'open', maxPurchasePerDay: 1000 } },
    { symbol: 'C', fundLimit: { buyStatus: 'closed' } },
  ];
  const first = queryListRows(rows, {
    orderBy: [{ field: 'limit', dir: 'desc' }],
    limit: 1,
  });
  assert.equal(first.items[0].symbol, 'A');
  const second = queryListRows(rows, {
    orderBy: [{ field: 'limit', dir: 'desc' }],
    limit: 2,
    cursor: first.nextCursor,
  });
  assert.deepEqual(second.items.map((r) => r.symbol), ['B', 'C']);
});

test('mobile queryMobileFundPage uses same engine', () => {
  const page = queryMobileFundPage(sampleRows(), {
    sorting: { id: 'changePercent', desc: true },
    limit: 1,
    heldOnly: false,
  });
  assert.equal(page.items[0].symbol, 'C');
  assert.ok(page.nextCursor);
});

test('sortMobileRows still returns full ordered list', () => {
  const sorted = sortMobileRows(sampleRows(), { id: 'price', desc: true });
  assert.deepEqual(sorted.map((r) => r.symbol), ['D', 'C', 'B', 'A']);
});

test('buildListRowFromQuote maps quote cache into list sort fields', () => {
  const row = buildListRowFromQuote({
    symbol: '513100',
    quote: {
      name: '纳指ETF',
      price: 1.2,
      changePercent: -0.3,
      premiumPercent: 0.5,
    },
    market: 'cn',
    isOtcList: false,
    heldSet: new Set(['513100']),
  });
  assert.equal(row.isHeld, true);
  assert.equal(row.price, 1.2);
  assert.equal(row.premiumPercent, 0.5);
  assert.equal(row.fundKind, 'exchange');
});

test('default limit matches SQL-style page size', () => {
  assert.equal(LIST_QUERY_DEFAULT_LIMIT, 20);
});

test('compareRowsByOrder is deterministic for equal primary keys', () => {
  const a = { symbol: 'B', changePercent: 1 };
  const b = { symbol: 'A', changePercent: 1 };
  const orderBy = normalizeOrderBy([{ field: 'changePercent', dir: 'desc' }]);
  assert.ok(compareRowsByOrder(a, b, orderBy) > 0); // A before B when asc symbol
});
