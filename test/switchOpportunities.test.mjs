import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateSwitchOpportunityProgress,
  generateSwitchOpportunities,
  sortSwitchOpportunities
} from '../workers/notify/src/switchOpportunities.js';

const catalog = [
  { code: '513100', name: '高侧 A', indexKey: 'nasdaq100' },
  { code: '159501', name: '高侧 B', indexKey: 'nasdaq100' },
  { code: '159513', name: '低侧 A', indexKey: 'nasdaq100' },
  { code: '513110', name: '低侧 B', indexKey: 'nasdaq100' },
  { code: '513500', name: '标普高', indexKey: 'sp500' },
  { code: '513650', name: '标普低', indexKey: 'sp500' }
];

const metrics = {
  513100: { name: '高侧 A', premiumPercent: 3.2, turnover: 500 },
  159501: { name: '高侧 B', premiumPercent: 3.1, turnover: 400 },
  159513: { name: '低侧 A', premiumPercent: 0.3, turnover: 700 },
  513110: { name: '低侧 B', premiumPercent: 0.5, turnover: 600 },
  513500: { name: '标普高', premiumPercent: 2.5 },
  513650: { name: '标普低', premiumPercent: 0.2 }
};

test('high-side progress uses threshold minus current advantage', () => {
  assert.deepEqual(calculateSwitchOpportunityProgress({
    direction: 'high_to_low', currentAdvantagePct: 2.82, thresholdPct: 3
  }), { distancePct: 0.18, progressPct: 94, status: 'very_near' });
});

test('low-side progress moves toward a narrowing threshold', () => {
  const result = calculateSwitchOpportunityProgress({
    direction: 'low_to_high', currentAdvantagePct: 1.5, thresholdPct: 1, referenceSpreadPct: 3
  });
  assert.equal(result.distancePct, 0.5);
  assert.equal(result.progressPct, 75);
  assert.equal(result.status, 'near');
});

test('holding mode keeps one best opposite-side target per holding', () => {
  const result = generateSwitchOpportunities({
    mode: 'auto', holdings: [{ fundCode: '513100', fundName: '持仓 A', quantity: 1000 }],
    metrics, catalog, config: { enabled: false, rules: [] }, evaluatedAt: '2026-07-21T06:00:00.000Z'
  });
  assert.equal(result.mode, 'holding');
  assert.equal(result.opportunities.length, 1);
  assert.equal(result.opportunities[0].sourceFund.code, '513100');
  assert.equal(result.opportunities[0].targetFund.code, '159513');
  assert.deepEqual(result.opportunities[0].sameIndexCandidateCodes, ['159513', '513110']);
  assert.equal(result.opportunities[0].alternatives.length, 1);
});

test('low-side holding chooses the smallest spread and fixed threshold', () => {
  const result = generateSwitchOpportunities({
    mode: 'holding', holdings: [{ fundCode: '159513', quantity: 200 }], metrics, catalog,
    config: { enabled: false, rules: [] }
  });
  assert.equal(result.opportunities[0].internalDirection, 'low_to_high');
  assert.equal(result.opportunities[0].targetFund.code, '159501');
  assert.equal(result.opportunities[0].thresholdPct, 1);
});

test('market mode never combines different indexes and deduplicates pair direction', () => {
  const result = generateSwitchOpportunities({ mode: 'market', metrics, catalog, limit: 10 });
  assert.equal(result.mode, 'market');
  // sp500 has no configured high-side member in the current catalog, so it
  // cannot produce a valid opposite-side pair.
  assert.equal(result.opportunities.length, 4);
  for (const item of result.opportunities) {
    const source = catalog.find((fund) => fund.code === item.sourceFund.code);
    const target = catalog.find((fund) => fund.code === item.targetFund.code);
    assert.equal(source.indexKey, target.indexKey);
  }
  const pairs = result.opportunities.map((item) => [item.sourceFund.code, item.targetFund.code].sort().join(':'));
  assert.equal(new Set(pairs).size, pairs.length);
});

test('existing rule threshold wins and exposes a newly preferred target', () => {
  const result = generateSwitchOpportunities({
    mode: 'holding', holdings: [{ fundCode: '513100', quantity: 100 }], metrics, catalog,
    config: { enabled: true, rules: [{
      id: 'rule-existing', enabled: true, holdingFundCode: '513100', candidateFundCodes: ['159513'],
      thresholdValue: 2.65, runtimeConfig: { triggerOperatorAtRecommendation: 'gte' }
    }] }
  });
  assert.equal(result.opportunities[0].thresholdPct, 2.65);
  assert.equal(result.opportunities[0].thresholdSource, 'existing_rule');
  assert.equal(result.opportunities[0].existingRule.ruleId, 'rule-existing');
  assert.equal(result.opportunities[0].existingRule.containsTarget, false);
  assert.equal(result.opportunities[0].canCreateRule, true);
});

test('existing rule marks an already monitored best target as created', () => {
  const duplicateMetrics = { ...metrics, 159513: { ...metrics[159513], premiumPercent: 0.8 } };
  const result = generateSwitchOpportunities({
    mode: 'holding', holdings: [{ fundCode: '513100', quantity: 100 }], metrics: duplicateMetrics, catalog,
    config: { enabled: true, rules: [{
      id: 'rule-existing', enabled: true, holdingFundCode: '513100', candidateFundCodes: ['513110'],
      thresholdValue: 2.65, runtimeConfig: { triggerOperatorAtRecommendation: 'gte' }
    }] }
  });
  assert.equal(result.opportunities[0].targetFund.code, '513110');
  assert.equal(result.opportunities[0].existingRule.containsTarget, true);
  assert.equal(result.opportunities[0].canCreateRule, false);
});

test('missing market data sorts after valid opportunities', () => {
  const ordered = sortSwitchOpportunities([
    { id: 'missing', status: 'no_data', distancePct: null },
    { id: 'near', status: 'near', distancePct: 0.5 }
  ]);
  assert.equal(ordered[0].id, 'near');
});
