import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyMarketDetailFilters,
  getAvailableExchangeIndexFilterOptions,
  matchesMarketDetailFilter,
  OTC_QUOTA_FILTER_OPTIONS,
  resolveExchangeIndexKey,
  resolveOtcQuotaStatus,
  resolveRedeemFee7dStatus,
} from '../src/pages/markets/marketListFilters.js';

test('OTC quota filter exposes only the broad buyable option', () => {
  assert.deepEqual(OTC_QUOTA_FILTER_OPTIONS, [
    { value: 'buyable', label: '有额度' },
  ]);
});

test('normalizes OTC purchase quota into filterable states', () => {
  assert.equal(resolveOtcQuotaStatus({ fundLimit: { buyStatus: 'open', maxPurchasePerDay: 1000 } }), 'restricted');
  assert.equal(resolveOtcQuotaStatus({ fundLimit: { buyStatus: 'open' } }), 'unlimited');
  assert.equal(resolveOtcQuotaStatus({ fundLimit: { buyStatus: 'suspended' } }), 'suspended');
  assert.equal(resolveOtcQuotaStatus({}), 'unknown');

  assert.equal(matchesMarketDetailFilter(
    { fundLimit: { buyStatus: 'open', maxPurchasePerDay: 1000 } },
    { field: 'quotaStatus', op: 'eq', value: 'buyable' }
  ), true);
  assert.equal(matchesMarketDetailFilter(
    { fundLimit: { buyStatus: 'suspended' } },
    { field: 'quotaStatus', op: 'eq', value: 'buyable' }
  ), false);
});

test('resolves the redemption tier that covers holding day seven', () => {
  const free = { fundFee: { redeemRules: [{ name: '7.0天<=持有期限<365.0天', value: '0.0', unit: '2' }] } };
  const paid = { fundFee: { redeemRules: [{ name: '7.0天<=持有期限', value: '0.5', unit: '2' }] } };
  const beforeSevenOnly = { fundFee: { redeemRules: [{ name: '0.0天<持有期限<7.0天', value: '1.5', unit: '2' }] } };
  const arrayRule = { fundFee: { redeemRules: [['持有7天以上', '0%']] } };

  assert.equal(resolveRedeemFee7dStatus(free), 'free');
  assert.equal(resolveRedeemFee7dStatus(paid), 'paid');
  assert.equal(resolveRedeemFee7dStatus(beforeSevenOnly), 'unknown');
  assert.equal(resolveRedeemFee7dStatus(arrayRule), 'free');
});

test('resolves exchange index metadata and name fallback', () => {
  assert.equal(resolveExchangeIndexKey({ fundMeta: { index_key: 'nasdaq100' } }), 'nasdaq100');
  assert.equal(resolveExchangeIndexKey({ name: '博时标普500ETF(QDII)' }), 'sp500');
  assert.equal(resolveExchangeIndexKey({ name: '沪深300ETF' }), 'other');
  assert.deepEqual(
    getAvailableExchangeIndexFilterOptions([
      { name: '纳斯达克100ETF' },
      { name: '标普500ETF' },
    ]).map((item) => item.value),
    ['nasdaq100', 'sp500']
  );
});

test('applies venue-specific detail filters without fetching detail APIs', () => {
  const rows = [
    { symbol: '000001', fundLimit: { buyStatus: 'open', maxPurchasePerDay: 1000 }, fundFee: { redeemRules: [{ name: '7天以上', value: '0', unit: '2' }] } },
    { symbol: '000002', fundLimit: { buyStatus: 'suspended' }, fundFee: { redeemRules: [{ name: '7天以上', value: '0.5', unit: '2' }] } },
  ];
  assert.deepEqual(
    applyMarketDetailFilters(rows, [
      { field: 'quotaStatus', op: 'eq', value: 'buyable' },
      { field: 'redeem7d', op: 'eq', value: 'free' },
    ]).map((row) => row.symbol),
    ['000001']
  );
});
