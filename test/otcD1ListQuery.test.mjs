import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOtcD1ListRequest,
  columnFiltersToOtcListFilters,
} from '../src/pages/markets/useOtcD1ListQuery.js';

test('buildOtcD1ListRequest sends OTC D1 query state and stable order', () => {
  const body = buildOtcD1ListRequest({
    symbols: ['000001', '000001'],
    heldSymbols: ['000002'],
    sorting: { id: 'changePercent', desc: true },
    limit: 20,
  });
  assert.equal(body.market, 'cn');
  assert.equal(body.isOtcList, true);
  assert.deepEqual(body.symbols, ['000001']);
  assert.deepEqual(body.heldSymbols, ['000002']);
  assert.deepEqual(body.orderBy, [
    { field: 'changePercent', dir: 'desc' },
    { field: 'symbol', dir: 'asc' },
  ]);
});

test('column filters map to server WHERE filters without detail requests', () => {
  assert.deepEqual(columnFiltersToOtcListFilters([
    { id: 'name', value: ['纳指', 'QDII'] },
    { id: 'changePercent', value: { min: -5, max: 5 } },
    { id: 'limit', value: ['open', 'app'] },
  ]), [
    { field: 'q', op: 'contains', value: '纳指' },
    { field: 'q', op: 'contains', value: 'QDII' },
    { field: 'changePercent', op: 'gte', value: -5 },
    { field: 'changePercent', op: 'lte', value: 5 },
    { field: 'limit', op: 'in', value: ['open', 'app'] },
  ]);
});
