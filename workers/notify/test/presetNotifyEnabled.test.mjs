import test from 'node:test';
import assert from 'node:assert/strict';

import { compileNotifyRules } from '../src/rules.js';

function basePayload() {
  return {
    plans: [
      {
        id: 'plan-1',
        symbol: '159655',
        name: '电池ETF计划',
        totalBudget: 10000,
        isConfigured: true,
      },
    ],
    dcaList: [
      {
        id: 'dca-1',
        symbol: '159655',
        name: '电池ETF定投',
        frequency: '每月',
        executionDay: 10,
        isConfigured: true,
      },
    ],
  };
}

test('plan/dca 默认编译（无 notify 字段）: 保持开启，兼容现有行为', () => {
  const compiled = compileNotifyRules(basePayload());
  assert.equal(compiled.planRules.length, 1);
  assert.equal(compiled.dcaRules.length, 1);
});

test('notify.enabled=false 的 plan 不编译', () => {
  const payload = basePayload();
  payload.plans[0].notify = { enabled: false };
  const compiled = compileNotifyRules(payload);
  assert.equal(compiled.planRules.length, 0);
  assert.equal(compiled.dcaRules.length, 1);
});

test('notify.enabled=false 的 dca 不编译', () => {
  const payload = basePayload();
  payload.dcaList[0].notify = { enabled: false };
  const compiled = compileNotifyRules(payload);
  assert.equal(compiled.planRules.length, 1);
  assert.equal(compiled.dcaRules.length, 0);
});

test('notify.enabled=true 显式开启：正常编译', () => {
  const payload = basePayload();
  payload.plans[0].notify = { enabled: true };
  payload.dcaList[0].notify = { enabled: true };
  const compiled = compileNotifyRules(payload);
  assert.equal(compiled.planRules.length, 1);
  assert.equal(compiled.dcaRules.length, 1);
});

test('dca 关联到被关闭的 plan：linkedPlan 置空但规则保留', () => {
  const payload = basePayload();
  payload.plans[0].notify = { enabled: false };
  payload.dcaList[0].linkedPlanId = 'plan-1';
  const compiled = compileNotifyRules(payload);
  assert.equal(compiled.planRules.length, 0);
  assert.equal(compiled.dcaRules.length, 1);
  assert.equal(compiled.dcaRules[0].linkedPlanId, '');
});
