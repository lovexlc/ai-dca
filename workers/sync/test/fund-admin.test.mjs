import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMissingFeeClause,
  feeRowToAdminItem,
  normalizeFundAdminPatch,
  normalizeFundCode,
  normalizeFundRate,
  normalizeFundRules
} from '../src/fundAdmin.js';

test('normalizes fund codes and percentage values', () => {
  assert.equal(normalizeFundCode(' 513100 '), '513100');
  assert.equal(normalizeFundCode('51310'), '');
  assert.equal(normalizeFundRate('0.5', 'annualFeeRate'), 0.5);
  assert.equal(normalizeFundRate(null), null);
  assert.throws(() => normalizeFundRate('100.1'), /0 到 100/);
});

test('accepts rule arrays and JSON text, rejecting malformed rules', () => {
  assert.deepEqual(normalizeFundRules('[{"name":"持有不足7天","value":"1.5%"}]'), [{ name: '持有不足7天', value: '1.5%' }]);
  assert.deepEqual(normalizeFundRules([{ value: '0.5%' }]), [{ value: '0.5%' }]);
  assert.throws(() => normalizeFundRules('{"value":"0.5%"}'), /JSON 数组/);
});

test('normalizes an admin patch without changing omitted fields', () => {
  assert.deepEqual(normalizeFundAdminPatch({ annualFeeRate: '0.6', redeemFeeRate: null, notice: '手工核对' }), {
    annualFeeRate: 0.6,
    redeemFeeRate: null,
    notice: '手工核对'
  });
});

test('builds allowlisted missing-field predicates', () => {
  assert.match(buildMissingFeeClause('any'), /annual_fee_rate IS NULL/);
  assert.equal(buildMissingFeeClause('not-allowed'), '');
});

test('maps D1 fee columns and JSON rules to the admin shape', () => {
  const item = feeRowToAdminItem({
    code: '513100',
    name: '纳指 ETF',
    fee_fund_type: 'exchange',
    annual_fee_rate: 0.6,
    redeem_fee_rate: null,
    fee_source: 'admin',
    fee_json: JSON.stringify({ operationFees: [['管理费', '0.5%']] }),
    fee_synced_at: '2026-07-27T00:00:00.000Z'
  });
  assert.equal(item.annualFeeRate, 0.6);
  assert.equal(item.fundType, 'exchange');
  assert.deepEqual(item.operationFees, [['管理费', '0.5%']]);
  assert.equal(item.source, 'admin');
});
