import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SWITCH_FEE_CONFIG,
  estimateSwitchCost,
  formatCommissionRateAsWan,
  getSwitchConditionText,
  isRuntimeConfigComplete,
  normalizeSwitchRuleModel,
  toSwitchBacktestCosts,
  validateFeeConfig,
  validateThresholdValue
} from '../src/app/switchRuleModel.js';
import {
  switchRecommendationCacheKey,
  switchRunKey,
  switchRunResultKey
} from '../workers/notify/src/switchStrategy.js';

test('new rule model maps one user threshold to the correct internal side', () => {
  const high = normalizeSwitchRuleModel({
    holdingFundCode: '513100',
    candidateFundCodes: ['159632'],
    thresholdMode: 'fixed',
    thresholdValue: 2.65,
    runtimeConfig: {
      premiumClass: { 513100: 'H', 159632: 'L' },
      intraSellLowerPct: 1,
      intraBuyOtherPct: 3
    }
  });
  assert.equal(high.internalHoldingSide, 'high');
  assert.equal(high.triggerOperator, 'gte');
  assert.equal(high.thresholdValue, 2.65);
  assert.match(getSwitchConditionText(high), /贵 2\.65%/);

  const low = normalizeSwitchRuleModel({
    holdingFundCode: '159632',
    candidateFundCodes: ['513100'],
    thresholdMode: 'fixed',
    thresholdValue: 0.5,
    runtimeConfig: {
      premiumClass: { 513100: 'H', 159632: 'L' },
      intraSellLowerPct: 1,
      intraBuyOtherPct: 3
    }
  });
  assert.equal(low.internalHoldingSide, 'low');
  assert.equal(low.triggerOperator, 'lte');
  assert.match(getSwitchConditionText(low), /价差收窄到 1\.00% 以内/);
});

test('switch rule defaults to 159501 and 513100 as H and allows a user H override', () => {
  const defaultRule = normalizeSwitchRuleModel({
    holdingFundCode: '159501',
    candidateFundCodes: ['513100', '159632'],
    thresholdMode: 'fixed',
    thresholdValue: 2.65
  });
  assert.deepEqual(defaultRule.runtimeConfig.premiumClass, {
    159501: 'H',
    513100: 'H',
    159632: 'L'
  });
  assert.equal(defaultRule.triggerOperator, 'gte');

  const overriddenRule = normalizeSwitchRuleModel({
    holdingFundCode: '159632',
    candidateFundCodes: ['159501', '513100'],
    highPremiumCodes: ['159632'],
    thresholdMode: 'fixed',
    thresholdValue: 2
  });
  assert.deepEqual(overriddenRule.runtimeConfig.premiumClass, {
    159632: 'H',
    159501: 'L',
    513100: 'L'
  });
  assert.equal(overriddenRule.triggerOperator, 'gte');
  assert.deepEqual(overriddenRule.highPremiumCodes, ['159632']);
});

test('fee values use percentage points in the app and decimal rates in backtest adapter', () => {
  const validation = validateFeeConfig({
    mode: 'detailed',
    sellCommissionRate: '0.03',
    buyCommissionRate: '0.03',
    minimumCommission: '5',
    otherFee: '0'
  });
  assert.equal(validation.valid, true);
  const costs = toSwitchBacktestCosts(validation.value, 10000);
  assert.equal(costs.sellFeeRate, 0.0003);
  assert.equal(costs.buyFeeRate, 0.0003);
  assert.equal(estimateSwitchCost(validation.value, 10000), 10);
  assert.equal(normalizeSwitchRuleModel({}).feeConfig.minimumCommission, 0);
  assert.equal(DEFAULT_SWITCH_FEE_CONFIG.sellCommissionRate, 0.005);
  assert.equal(DEFAULT_SWITCH_FEE_CONFIG.buyCommissionRate, 0.005);
  assert.equal(normalizeSwitchRuleModel({}).feeConfig.sellCommissionRate, 0.005);
  assert.equal(normalizeSwitchRuleModel({}).feeConfig.buyCommissionRate, 0.005);
  assert.equal(formatCommissionRateAsWan(0.005), '万0.5');
  assert.equal(formatCommissionRateAsWan(0.03), '万3');
  assert.equal(formatCommissionRateAsWan(0.01), '万1');
  assert.equal(formatCommissionRateAsWan(''), '万—');
  assert.equal(
    estimateSwitchCost({
      mode: 'detailed',
      sellCommissionRate: 0.03,
      buyCommissionRate: 0.03,
      minimumCommission: 0,
      otherFee: 0
    }, 50000),
    30
  );
  assert.equal(
    estimateSwitchCost({
      mode: 'detailed',
      sellCommissionRate: 0.005,
      buyCommissionRate: 0.005,
      minimumCommission: 0,
      otherFee: 0
    }, 50000),
    5
  );
  assert.equal(validateFeeConfig({ mode: 'detailed', sellCommissionRate: '-1' }).valid, false);
  assert.equal(validateFeeConfig({ mode: 'detailed', sellCommissionRate: '0.00001' }).valid, false);
});

test('threshold validation follows the trigger direction and rejects negative values', () => {
  assert.equal(validateThresholdValue(2.65, 'gte').valid, true);
  assert.equal(validateThresholdValue(0.4, 'gte').valid, false);
  assert.equal(validateThresholdValue(5.01, 'gte').valid, false);
  assert.equal(validateThresholdValue(1, 'lte').valid, true);
  assert.equal(validateThresholdValue(0.5, 'lte').valid, false);
  assert.equal(validateThresholdValue(2.01, 'lte').valid, false);
  assert.equal(validateThresholdValue(-0.1, 'lte').valid, false);
});

test('fee changes can explicitly clear the previous backtest recommendation', () => {
  const model = normalizeSwitchRuleModel({
    holdingFundCode: '513100',
    candidateFundCodes: ['159632'],
    thresholdMode: 'fixed',
    thresholdValue: 2.65,
    backtestRecommendedValue: null,
    recommendationStatus: 'fee_changed'
  });
  assert.equal(model.backtestRecommendedValue, null);
  assert.equal(model.recommendationStatus, 'fee_changed');
});

test('runtime classification completeness uses the fixed H list and does not require ordered legacy thresholds', () => {
  assert.equal(
    isRuntimeConfigComplete(
      { premiumClass: { 513100: 'H', 159632: 'L' }, intraSellLowerPct: 1, intraBuyOtherPct: 3 },
      ['513100', '159632']
    ),
    true
  );
  assert.equal(
    isRuntimeConfigComplete({ premiumClass: { 513100: 'H' }, intraSellLowerPct: 1, intraBuyOtherPct: 0.5 }, [
      '513100',
      '159632'
    ]),
    true
  );
  assert.equal(
    isRuntimeConfigComplete(
      { premiumClass: { 513100: 'H', 159632: 'L' }, intraSellLowerPct: 1, intraBuyOtherPct: 1 },
      ['513100', '159632']
    ),
    true
  );
});

test('switch run and recommendation keys are stable and separated', () => {
  assert.equal(switchRunKey('client-1', 'run-1'), 'switch:run:client-1:run-1');
  assert.equal(switchRunResultKey('client-1'), 'switch:run-result:client-1');
  assert.equal(switchRecommendationCacheKey('abc'), 'switch:recommend-cache:abc');
});
