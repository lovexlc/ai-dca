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


test('offsite limit filters distinguish unlimited, suspended, and missing data', () => {
  assert.equal(matchesMarketFilters({ fundLimit: { buyStatus: 'open', maxPurchasePerDay: 0 } }, [{ id: 'limitRange', value: 'unlimited' }]), true);
  assert.equal(matchesMarketFilters({ fundLimit: { buyStatus: 'open', maxPurchasePerDay: 0 } }, [{ id: 'limitRange', value: 'lte1000' }]), true);
  assert.equal(matchesMarketFilters({ fundLimit: null }, [{ id: 'limitRange', value: 'unlimited' }]), false);
  assert.equal(matchesMarketFilters({ fundLimit: { buyStatus: 'suspended', maxPurchasePerDay: 1000 } }, [{ id: 'limitRange', value: 'suspended' }]), true);
  assert.equal(matchesMarketFilters({ fundLimit: { buyStatus: 'suspended', maxPurchasePerDay: 1000 } }, [{ id: 'subscriptionStatus', value: 'open' }]), false);
});

test('classified index metadata takes precedence over name matching', () => {
  assert.equal(matchesMarketFilters({ name: '普通基金', indexCategory: 'sp500' }, [{ id: 'index', value: 'sp500' }]), true);
  assert.equal(matchesMarketFilters({ name: '标普500 ETF', indexCategory: 'nasdaq100' }, [{ id: 'index', value: 'nasdaq100' }]), true);
});

test('LOF rows do not match specific premium filters', () => {
  assert.equal(matchesMarketFilters({ name: '标普信息科技LOF', premiumPercent: 8 }, [{ id: 'premiumRisk', value: 'all' }]), true);
  assert.equal(matchesMarketFilters({ name: '标普信息科技LOF', premiumPercent: 8 }, [{ id: 'premiumRisk', value: 'gt3' }]), false);
});

test('same filter group uses OR while different groups use AND', () => {
  assert.equal(matchesMarketFilters({ name: '纳指100 ETF', changePercent: 3 }, [
    { id: 'index', value: 'nasdaq100' },
    { id: 'index', value: 'sp500' },
    { id: 'changeRange', value: '2to5' },
  ]), true);
  assert.equal(matchesMarketFilters({ name: '标普500 ETF', changePercent: -1 }, [
    { id: 'index', value: 'nasdaq100' },
    { id: 'index', value: 'sp500' },
    { id: 'changeRange', value: '2to5' },
  ]), false);
});
