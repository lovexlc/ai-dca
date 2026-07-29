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

test('derives missing scalar fee rates from D1 fee JSON rules', () => {
  const fee = d1RowToFundFee({
    code: '000834',
    annual_fee_rate: 1,
    management_fee_rate: null,
    custody_fee_rate: null,
    sales_service_fee_rate: null,
    redeem_fee_rate: null,
    fee_json: JSON.stringify({
      operationFees: [
        { name: '基金管理费', value: '0.8', unit: '2' },
        { name: '基金托管费', value: '0.2', unit: '2' },
      ],
      redeemRules: [
        { name: '持有不足7天', value: '1.5', unit: '2' },
        { name: '持有7天以上', value: '0', unit: '2' },
      ]
    })
  });
  assert.equal(fee.managementFeeRate, 0.8);
  assert.equal(fee.custodyFeeRate, 0.2);
  assert.equal(fee.redeemFeeRate, 1.5);
});

test('includes D1 fee data in the list row without requesting extra detail data', () => {
  const row = d1RowToOtcListRow({
    code: '000834',
    name: '大成纳斯达克100ETF联接',
    latest_nav: 1.2,
    latest_nav_date: '2026-07-27',
    annual_fee_rate: 0.85,
    redeem_fee_rate: 0.5,
    management_fee_rate: 0.7,
    custody_fee_rate: 0.15,
    sales_service_fee_rate: null,
    fee_fund_type: 'otc',
    fee_source: 'admin',
    fee_notice: '',
    fee_json: JSON.stringify({ code: '000834', source: 'admin' })
  });
  assert.equal(row.feeRate, 0.85);
  assert.equal(row.annualFeeRate, 0.85);
  assert.equal(row.managementFeeRate, 0.7);
  assert.equal(row.custodyFeeRate, 0.15);
  assert.equal(row.redeemFeeRate, 0.5);
  assert.equal(row.fundFee.source, 'admin');
});
