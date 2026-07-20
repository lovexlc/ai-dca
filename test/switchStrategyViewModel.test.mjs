import test from 'node:test';
import assert from 'node:assert/strict';

import {
  candidateStatus,
  getBestAdvantage,
  getDistanceToThreshold,
  getRuleCandidates
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
});
