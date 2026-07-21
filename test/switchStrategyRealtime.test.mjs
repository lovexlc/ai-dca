import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSwitchRealtimeSymbols,
  mergeSwitchRealtimeViews
} from '../src/pages/switchStrategy/switchStrategyRealtime.js';

function rule({ id = 'rule-1', holdingFundCode = '159501', holdingSide = 'high' } = {}) {
  const high = holdingSide === 'high' ? ['159501'] : ['159501'];
  return {
    id,
    enabled: true,
    holdingFundCode,
    holdingFundName: holdingFundCode,
    holdingNotional: 10000,
    holdingQuantity: 1000,
    thresholdValue: holdingSide === 'low' ? 1 : 2.65,
    thresholdMode: 'fixed',
    feeConfig: {
      mode: 'detailed',
      sellCommissionRate: 0.03,
      buyCommissionRate: 0.03,
      minimumCommission: 0,
      otherFee: 0
    },
    candidateFundCodes: ['513100'],
    highPremiumCodes: high,
    runtimeConfig: {
      highPremiumCodes: high,
      premiumClass: {
        '159501': 'H',
        '513100': 'H',
        '159632': 'L'
      },
      holdingSideAtRecommendation: holdingSide,
      triggerOperatorAtRecommendation: holdingSide === 'low' ? 'lte' : 'gte'
    }
  };
}

function view(ruleId = 'rule-1', operator = 'gte', bestAdvantagePct = 0) {
  return {
    ruleId,
    status: 'ready',
    triggerOperator: operator,
    thresholdValue: operator === 'lte' ? 1 : 2.65,
    bestAdvantagePct,
    distancePct: 2,
    holdingNotional: 10000,
    candidates: [
      {
        code: operator === 'lte' ? '159501' : '513100',
        name: '候选基金',
        currentAdvantagePct: bestAdvantagePct,
        advantagePct: bestAdvantagePct,
        status: 'not_reached'
      }
    ]
  };
}

test('rules subscribe only enabled holding and candidate codes', () => {
  assert.deepEqual(
    getSwitchRealtimeSymbols([
      rule(),
      { ...rule({ id: 'disabled' }), enabled: false, holdingFundCode: '159632' }
    ]),
    ['159501', '513100']
  );
});

test('high-side WS premiums compute H-L advantage after fee impact', () => {
  const currentRule = rule();
  const result = mergeSwitchRealtimeViews({
    rules: [currentRule],
    runtimeViews: { 'rule-1': view() },
    premiumMap: {},
    items: [
      { code: '159501', premiumPercent: 8 },
      { code: '513100', premiumPercent: 5 }
    ]
  });
  const next = result.runtimeViews['rule-1'];
  assert.equal(result.changed, true);
  assert.equal(next.bestAdvantagePct, 2.94);
  assert.equal(next.status, 'triggered');
  assert.equal(next.candidates[0].currentAdvantagePct, 2.94);
});

test('low-side WS premiums use H-L as a lower-is-better value', () => {
  const currentRule = rule({ holdingFundCode: '159632', holdingSide: 'low' });
  currentRule.candidateFundCodes = ['159501'];
  const currentView = view('rule-1', 'lte', 3);
  currentView.candidates[0].code = '159501';
  const result = mergeSwitchRealtimeViews({
    rules: [currentRule],
    runtimeViews: { 'rule-1': currentView },
    items: [
      { code: '159632', premiumPercent: 7 },
      { code: '159501', premiumPercent: 7.5 }
    ]
  });
  assert.equal(result.runtimeViews['rule-1'].bestAdvantagePct, 0.44);
  assert.equal(result.runtimeViews['rule-1'].status, 'triggered');
});

test('unchanged WS premium does not create a new runtime view', () => {
  const currentRule = rule();
  const initial = mergeSwitchRealtimeViews({
    rules: [currentRule],
    runtimeViews: { 'rule-1': view() },
    items: [
      { code: '159501', premiumPercent: 8 },
      { code: '513100', premiumPercent: 5 }
    ]
  });
  const next = mergeSwitchRealtimeViews({
    rules: [currentRule],
    runtimeViews: initial.runtimeViews,
    premiumMap: initial.premiumMap,
    items: [
      { code: '159501', premiumPercent: 8 },
      { code: '513100', premiumPercent: 5 }
    ]
  });
  assert.equal(next.changed, false);
  assert.equal(next.runtimeViews, initial.runtimeViews);
});
