import test from 'node:test';
import assert from 'node:assert/strict';

import { compileNotifyRules, normalizeNotifyPayload } from '../workers/notify/src/rules.js';

test('compileNotifyRules: dcaList compiles one schedule rule per DCA plan', () => {
  const compiled = compileNotifyRules({
    syncedAt: '2026-05-18T00:00:00.000Z',
    plans: [{
      id: 'plan-qqq',
      name: 'QQQ 加仓',
      symbol: 'QQQ',
      totalBudget: 10000,
      cashReservePct: 20,
      layerWeights: [40, 35, 25],
      triggerDrops: [0, 8, 16],
      isConfigured: true
    }],
    dcaList: [
      {
        id: 'dca-qqq-weekly',
        name: 'QQQ 每周定投',
        symbol: 'QQQ',
        frequency: '每周',
        executionDay: 2,
        recurringInvestment: 300,
        linkedPlanId: 'plan-qqq',
        isConfigured: true
      },
      {
        id: 'dca-spy-monthly',
        name: 'SPY 每月定投',
        symbol: 'SPY',
        frequency: '每月',
        executionDay: 8,
        recurringInvestment: 500,
        isConfigured: true
      }
    ]
  });

  assert.equal(compiled.summary.dcaRuleCount, 2);
  assert.equal(compiled.summary.totalRuleCount, 3);
  assert.deepEqual(compiled.dcaRules.map((rule) => rule.ruleId), ['dca:dca-qqq-weekly', 'dca:dca-spy-monthly']);
  assert.equal(compiled.dcaRules[0].linkedPlanId, 'plan-qqq');
  assert.equal(compiled.dcaRules[0].linkedPlanName, 'QQQ 加仓');
  assert.equal(compiled.dcaRules[0].firstExecutionAmount, 3200);
  assert.equal(compiled.dcaRules[1].dcaName, 'SPY 每月定投');
});

test('normalizeNotifyPayload: legacy dca remains compatible when dcaList is absent', () => {
  const normalized = normalizeNotifyPayload({
    dca: {
      symbol: 'NVDA',
      frequency: '每月',
      executionDay: 1,
      recurringInvestment: 600
    }
  });

  assert.equal(normalized.dcaList.length, 1);
  assert.equal(normalized.dca.symbol, 'NVDA');

  const compiled = compileNotifyRules(normalized);
  assert.equal(compiled.summary.dcaRuleCount, 1);
  assert.equal(compiled.dcaRules[0].ruleId, 'dca:NVDA:每月:1:standard');
});

test('normalizeNotifyPayload: explicit empty dcaList does not revive legacy active dca mirror', () => {
  const normalized = normalizeNotifyPayload({
    dca: {
      symbol: 'NVDA',
      frequency: '每月',
      executionDay: 1,
      recurringInvestment: 600
    },
    dcaList: []
  });

  assert.equal(normalized.dca, null);
  assert.deepEqual(normalized.dcaList, []);
});
