import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildFundSwitchOpportunityModel,
  getSwitchOpportunityAdvantage,
  numberValue
} from '../src/pages/mobile/fundSwitchOpportunityModel.js';

const BASE_PREFS = {
  benchmarkCodes: ['513100'],
  enabledCodes: ['159501'],
  premiumClass: { '513100': 'H', '159501': 'L' },
  intraSellLowerPct: 1,
  intraBuyOtherPct: 3
};

function buildSnapshot({ benchmarkClass = 'H', candidateClass = 'L', benchmarkPremium = 9.39, candidatePremium = 9.77 } = {}) {
  return {
    computedAt: '2026-07-14T02:30:00.000Z',
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3,
    byBenchmark: [{
      benchmarkCode: '513100',
      benchmarkName: '持仓基金',
      benchmarkClass,
      benchmarkPrice: 1.2,
      benchmarkPremiumPct: benchmarkPremium,
      candidates: [{
        code: '159501',
        name: '候选基金',
        candClass: candidateClass,
        price: 1.1,
        premiumPct: candidatePremium,
        spreadVsBenchmarkPct: benchmarkPremium - candidatePremium,
        highPoint: null,
        historicalPercentile: null,
        turnover: null
      }]
    }]
  };
}

test('missing numeric metrics stay missing instead of becoming zero', () => {
  assert.equal(numberValue(null), null);
  assert.equal(numberValue(undefined), null);
  assert.equal(numberValue(''), null);
  assert.equal(numberValue('   '), null);
  assert.equal(numberValue(0), 0);

  const model = buildFundSwitchOpportunityModel({ snapshot: buildSnapshot(), prefs: BASE_PREFS });
  assert.equal(model.candidatePairs[0].fromFund.highPoint, null);
  assert.equal(model.candidatePairs[0].toFund.turnover, null);
});

test('a configured pair below rule B threshold is a candidate but not an opportunity', () => {
  const model = buildFundSwitchOpportunityModel({ snapshot: buildSnapshot(), prefs: BASE_PREFS });

  assert.equal(model.candidateCount, 1);
  assert.equal(model.opportunityCount, 0);
  assert.equal(model.opportunityPairs.length, 0);
  assert.equal(model.candidatePairs[0].spread, -0.379999999999999);
});

test('rule B keeps the real high-to-low sell and buy direction', () => {
  const model = buildFundSwitchOpportunityModel({
    snapshot: buildSnapshot({ benchmarkPremium: 5, candidatePremium: 1 }),
    prefs: BASE_PREFS
  });
  const pair = model.opportunityPairs[0];

  assert.equal(model.opportunityCount, 1);
  assert.equal(pair.rule, 'B');
  assert.equal(pair.from, '513100');
  assert.equal(pair.fromClass, 'H');
  assert.equal(pair.to, '159501');
  assert.equal(pair.toClass, 'L');
  assert.equal(pair.threshold, 3);
  assert.equal(getSwitchOpportunityAdvantage(pair), 1);
});

test('rule A keeps the real low-to-high sell and buy direction', () => {
  const prefs = {
    ...BASE_PREFS,
    premiumClass: { '513100': 'L', '159501': 'H' }
  };
  const model = buildFundSwitchOpportunityModel({
    snapshot: buildSnapshot({ benchmarkClass: 'L', candidateClass: 'H', benchmarkPremium: 1, candidatePremium: 1.5 }),
    prefs
  });
  const pair = model.opportunityPairs[0];

  assert.equal(pair.rule, 'A');
  assert.equal(pair.from, '513100');
  assert.equal(pair.fromClass, 'L');
  assert.equal(pair.to, '159501');
  assert.equal(pair.toClass, 'H');
  assert.equal(pair.spread, 0.5);
  assert.equal(pair.threshold, 1);
  assert.equal(getSwitchOpportunityAdvantage(pair), 0.5);
});

test('stale worker signals cannot sell a fund that is no longer held', () => {
  const prefs = {
    benchmarkCodes: ['513100'],
    enabledCodes: ['159632'],
    premiumClass: { '513100': 'H', '159632': 'L' },
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3
  };
  const model = buildFundSwitchOpportunityModel({
    snapshot: {
      computedAt: '2026-07-14T02:30:00.000Z',
      intraSellLowerPct: 1,
      intraBuyOtherPct: 3,
      byBenchmark: [{
        benchmarkCode: '513100',
        benchmarkClass: 'H',
        benchmarkPremiumPct: 5,
        candidates: [{
          code: '159632',
          candClass: 'L',
          premiumPct: 1,
          spreadVsBenchmarkPct: 4
        }]
      }]
    },
    signals: [{
      kind: 'B',
      from: '513100',
      to: '159632',
      gapPct: 4,
      threshold: 3
    }],
    funds: [
      { code: '513100', name: '对手方', premiumPct: 1.5 },
      { code: '159632', name: '当前持仓', premiumPct: 1 }
    ],
    prefs,
    heldCodes: ['159632']
  });

  assert.equal(model.opportunityPairs.length, 1);
  assert.equal(model.opportunityPairs[0].from, '159632');
  assert.equal(model.opportunityPairs[0].to, '513100');
  assert.equal(model.opportunityPairs[0].rule, 'A');
  assert.equal(model.opportunityPairs.some((pair) => pair.from === '513100'), false);
});

test('opportunity count separates matched rules from all candidate pairs', () => {
  const model = buildFundSwitchOpportunityModel({
    snapshot: buildSnapshot({ benchmarkPremium: 5, candidatePremium: 1 }),
    prefs: BASE_PREFS,
    otcSignal: { ready: true, triggered: true }
  });

  assert.equal(model.candidateCount, 1);
  assert.equal(model.opportunityPairs.length, 1);
  assert.equal(model.opportunityCount, 2);
  assert.equal(model.hasOtcOpportunity, true);
});
