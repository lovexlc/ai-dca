import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesMarketFilters } from '../src/pages/markets/marketListFilters.js';
import { compareMarketRows, DEFAULT_MARKET_SORTING } from '../src/pages/markets/marketListSorting.js';

const exchange = { kind: 'exchange', name: '纳指100 ETF', changePercent: 3.2, historicalPercentile: 72, premiumPercent: 2.1, isHeld: true, isFavorite: false };

test('market filters match reference ETF conditions', () => {
  assert.equal(matchesMarketFilters(exchange, [{ id: 'index', value: 'nasdaq100' }, { id: 'changeRange', value: '2to5' }, { id: 'premiumRisk', value: '1to3' }]), true);
  assert.equal(matchesMarketFilters(exchange, [{ id: 'status', value: 'favorite' }]), false);
  assert.equal(matchesMarketFilters({ ...exchange, premiumPercent: 4 }, [{ id: 'premiumRisk', value: '1to3' }]), false);
});

test('market sorting supports primary and secondary fields', () => {
  const rows = [{ symbol: 'B', price: 10, turnover: 200 }, { symbol: 'A', price: 10, turnover: 100 }, { symbol: 'C', price: 12, turnover: 10 }];
  const sorted = [...rows].sort((a, b) => compareMarketRows(a, b, DEFAULT_MARKET_SORTING));
  assert.deepEqual(sorted.map((row) => row.symbol), ['C', 'B', 'A']);
  const ascending = [...rows].sort((a, b) => compareMarketRows(a, b, [{ id: 'price', desc: false }, { id: 'symbol', desc: false }]));
  assert.deepEqual(ascending.map((row) => row.symbol), ['A', 'B', 'C']);
});
