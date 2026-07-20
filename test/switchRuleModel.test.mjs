import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateSwitchCost,
  getSwitchConditionText,
  isRuntimeConfigComplete,
  normalizeSwitchRuleModel,
  toSwitchBacktestCosts,
  validateFeeConfig
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
      premiumClass: { '513100': 'H', '159632': 'L' },
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
      premiumClass: { '513100': 'H', '159632': 'L' },
      intraSellLowerPct: 1,
      intraBuyOtherPct: 3
    }
  });
  assert.equal(low.internalHoldingSide, 'low');
  assert.equal(low.triggerOperator, 'lte');
  assert.match(getSwitchConditionText(low), /收窄到 0\.50% 以内/);
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
  assert.equal(validateFeeConfig({ mode: 'detailed', sellCommissionRate: '-1' }).valid, false);
  assert.equal(validateFeeConfig({ mode: 'detailed', sellCommissionRate: '0.00001' }).valid, false);
});

test('runtime classification completeness requires both sides and ordered legacy thresholds', () => {
  assert.equal(isRuntimeConfigComplete({ premiumClass: { '513100': 'H', '159632': 'L' }, intraSellLowerPct: 1, intraBuyOtherPct: 3 }, ['513100', '159632']), true);
  assert.equal(isRuntimeConfigComplete({ premiumClass: { '513100': 'H' }, intraSellLowerPct: 1, intraBuyOtherPct: 3 }, ['513100', '159632']), false);
  assert.equal(isRuntimeConfigComplete({ premiumClass: { '513100': 'H', '159632': 'L' }, intraSellLowerPct: 3, intraBuyOtherPct: 3 }, ['513100', '159632']), false);
});

test('switch run and recommendation keys are stable and separated', () => {
  assert.equal(switchRunKey('client-1', 'run-1'), 'switch:run:client-1:run-1');
  assert.equal(switchRunResultKey('client-1'), 'switch:run-result:client-1');
  assert.equal(switchRecommendationCacheKey('abc'), 'switch:recommend-cache:abc');
});
