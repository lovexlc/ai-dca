import test from 'node:test';
import assert from 'node:assert/strict';
import { d1RowToFundFee, d1RowToOtcListRow } from '../src/otcFundD1.js';

test('maps normalized D1 fee columns and keeps tiered rules', () => {
  const fee = d1RowToFundFee({
    code: '513100',
    annual_fee_rate: 0.6,
    management_fee_rate: 0.5,
    custody_fee_rate: 0.1,
    sales_service_fee_rate: null,
    redeem_fee_rate: null,
    fee_fund_type: 'exchange',
    fee_source: 'eastmoney_f10',
    fee_json: JSON.stringify({ redeemRules: [['持有不足7天', '1.5%']] })
  });
  assert.equal(fee.code, '513100');
  assert.equal(fee.annualFeeRate, 0.6);
  assert.deepEqual(fee.redeemRules, [['持有不足7天', '1.5%']]);
});

test('includes D1 fee data in the list row without requesting extra detail data', () => {
  const row = d1RowToOtcListRow({
    code: '000834',
    name: '大成纳斯达克100ETF联接',
    latest_nav: 1.2,
    latest_nav_date: '2026-07-27',
    annual_fee_rate: 0.85,
    redeem_fee_rate: 0.5,
    fee_fund_type: 'otc',
    fee_source: 'admin',
    fee_notice: '',
    fee_json: JSON.stringify({ code: '000834', source: 'admin' })
  });
  assert.equal(row.feeRate, 0.85);
  assert.equal(row.redeemFeeRate, 0.5);
  assert.equal(row.fundFee.source, 'admin');
});
