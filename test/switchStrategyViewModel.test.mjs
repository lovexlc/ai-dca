import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSwitchPlanDisplayModel,
  candidateStatus,
  calculateSwitchProgress,
  getAdvantageCopy,
  getBestAdvantage,
  getDistanceToThreshold,
  getRuleCandidates,
  getSwitchPlanDisplayStatus
} from '../src/pages/switchStrategy/switchStrategyViewModel.js';

test('view model sorts high-side candidates by highest advantage', () => {
  const rule = {
    holdingFundCode: '513100',
    candidateFundCodes: ['159501', '159632'],
    thresholdMode: 'fixed',
    thresholdValue: 2.65,
    runtimeConfig: {
      premiumClass: { 513100: 'H', 159501: 'L', 159632: 'L' },
      holdingSideAtRecommendation: 'high',
      triggerOperatorAtRecommendation: 'gte',
      intraSellLowerPct: 1,
      intraBuyOtherPct: 3
    }
  };
  const candidates = getRuleCandidates(rule, {
    byBenchmark: [
      {
        benchmarkCode: '513100',
        candidates: [
          { code: '159501', spreadVsBenchmarkPct: 2.31 },
          { code: '159632', spreadVsBenchmarkPct: 1.92 }
        ]
      }
    ]
  });
  assert.deepEqual(
    candidates.map((item) => item.code),
    ['159501', '159632']
  );
  assert.equal(getBestAdvantage(rule, candidates), 2.31);
  assert.equal(candidateStatus(candidates[0], rule), 'near');
  assert.equal(getDistanceToThreshold(2.31, 2.65), 0.34);
  assert.deepEqual(getAdvantageCopy({
    operator: 'gte',
    bestAdvantagePct: 2.31,
    thresholdValue: 2.65,
    distancePct: 0.34,
    reached: false
  }), {
    label: '当前最佳切换优势',
    hint: '当前持仓比候选基金贵',
    progress: '还差 0.34%'
  });
});

test('view model converts legacy low-side spread and sorts lowest advantage first', () => {
  const rule = {
    holdingFundCode: '159501',
    candidateFundCodes: ['513100', '513110'],
    thresholdMode: 'fixed',
    thresholdValue: 0.5,
    runtimeConfig: {
      premiumClass: { 159501: 'L', 513100: 'H', 513110: 'H' },
      holdingSideAtRecommendation: 'low',
      triggerOperatorAtRecommendation: 'lte',
      intraSellLowerPct: 1,
      intraBuyOtherPct: 3
    }
  };
  const candidates = getRuleCandidates(rule, {
    byBenchmark: [
      {
        benchmarkCode: '159501',
        candidates: [
          { code: '513100', spreadVsBenchmarkPct: -0.4 },
          { code: '513110', spreadVsBenchmarkPct: -0.2 }
        ]
      }
    ]
  });
  assert.deepEqual(
    candidates.map((item) => item.code),
    ['513110', '513100']
  );
  assert.equal(candidates[0].advantagePct, 0.2);
  assert.equal(getBestAdvantage(rule, candidates), 0.2);
  assert.equal(candidateStatus(candidates[0], rule), 'reached');
  assert.deepEqual(getAdvantageCopy({
    operator: 'lte',
    bestAdvantagePct: 2.42,
    thresholdValue: 1,
    distancePct: 1.42,
    reached: false
  }), {
    label: '当前切换价差',
    hint: '目标：收窄到 1.00% 以内',
    progress: '还需收窄 1.42%'
  });
});

test('plan display model maps progress and explicit zero holdings to a safe card state', () => {
  assert.equal(calculateSwitchProgress(2.46, 3, 'gte'), 82);
  assert.equal(calculateSwitchProgress(2.34, 1, 'lte'), 43);
  assert.equal(calculateSwitchProgress(1, 1, 'lte'), 100);
  assert.equal(calculateSwitchProgress(0.5, 1, 'lte'), 100);
  assert.equal(calculateSwitchProgress(null, 3), 0);
  assert.equal(getSwitchPlanDisplayStatus({ holdingQuantity: 0, enabled: true, progressPercent: 100 }), 'noHolding');
  assert.equal(getSwitchPlanDisplayStatus({ holdingQuantity: 100, enabled: true, progressPercent: 82 }), 'nearReminder');

  const lowSideDisplay = buildSwitchPlanDisplayModel(
    {
      id: 'rule-low',
      name: '低侧方案',
      enabled: true,
      holdingFundCode: '159632',
      holdingFundName: '纳斯达克ETF',
      holdingQuantity: 1000,
      thresholdMode: 'fixed',
      thresholdValue: 1,
      candidateFundCodes: ['159501']
    },
    null,
    {
      ruleId: 'rule-low',
      status: 'ready',
      triggerOperator: 'lte',
      bestAdvantagePct: 2.34,
      thresholdValue: 1,
      distancePct: 1.34,
      candidates: []
    },
    0,
    1000
  );

  assert.equal(lowSideDisplay.progressPercent, 43);
  assert.equal(lowSideDisplay.displayStatus, 'watching');

  const display = buildSwitchPlanDisplayModel(
    {
      id: 'rule-zero',
      name: '零持仓方案',
      enabled: true,
      holdingFundCode: '159659',
      holdingFundName: '纳指ETF',
      holdingQuantity: 0,
      thresholdMode: 'fixed',
      thresholdValue: 3,
      candidateFundCodes: ['159501']
    },
    {
      byBenchmark: [{ benchmarkCode: '159659', candidates: [{ code: '159501', spreadVsBenchmarkPct: 2.4 }] }]
    },
    null,
    0
  );

  assert.equal(display.displayStatus, 'noHolding');
  assert.equal(display.currentAdvantage, null);
  assert.equal(display.progressPercent, 0);
  assert.equal(display.candidateCount, 1);
});
