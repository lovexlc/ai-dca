// node --test test/sellStrategy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSellPlan,
  evaluateSellSignals,
  DEFAULT_GAIN_TRIGGERS,
  DEFAULT_SELL_RATIOS
} from '../src/app/sellStrategy.js';

test('buildSellPlan 个股默认 3 档：15/25/35% × 33/33/34%', () => {
  const plan = buildSellPlan({ symbol: 'NVDA', holdingCost: 100, holdingShares: 300 });
  assert.equal(plan.sellable, true);
  assert.equal(plan.assetType, 'stock');
  assert.equal(plan.layers.length, 3);
  assert.equal(plan.layers[0].triggerPrice, 115);
  assert.equal(plan.layers[1].triggerPrice, 125);
  assert.equal(plan.layers[2].triggerPrice, 135);
  const totalRatio = plan.layers.reduce((s, l) => s + l.ratio, 0);
  assert.ok(Math.abs(totalRatio - 1) < 1e-6, `totalRatio should normalize to 1, got ${totalRatio}`);
});

test('buildSellPlan 宽基指数（QQQ）不可卖，layers 为空', () => {
  const plan = buildSellPlan({ symbol: 'QQQ', holdingCost: 400, holdingShares: 100 });
  assert.equal(plan.sellable, false);
  assert.equal(plan.assetType, 'index');
  assert.deepEqual(plan.layers, []);
  assert.equal(plan.totalProceeds, 0);
});

test('buildSellPlan 卖出比超 100% 会被归一化', () => {
  const plan = buildSellPlan({
    symbol: 'NVDA',
    holdingCost: 100,
    holdingShares: 100,
    gainTriggers: [10, 20],
    sellRatios: [0.8, 0.8]
  });
  const totalRatio = plan.layers.reduce((s, l) => s + l.ratio, 0);
  assert.ok(Math.abs(totalRatio - 1) < 1e-6);
  assert.equal(plan.layers.length, 2);
});

test('buildSellPlan 支持 4 个档（UI 可 3–5）', () => {
  const plan = buildSellPlan({
    symbol: 'TSLA',
    holdingCost: 200,
    holdingShares: 200,
    gainTriggers: [10, 20, 30, 40],
    sellRatios: [0.25, 0.25, 0.25, 0.25]
  });
  assert.equal(plan.layers.length, 4);
  assert.equal(plan.layers[3].triggerPrice, 280);
  assert.equal(plan.layers[3].shares, 50);
});

test('evaluateSellSignals 当前价在二三档之间时返回首笔触发 + 下一档', () => {
  const plan = buildSellPlan({ symbol: 'NVDA', holdingCost: 100, holdingShares: 300 });
  const result = evaluateSellSignals(plan, 120);
  assert.equal(result.triggered.length, 1);
  assert.equal(result.triggered[0].gainPct, 15);
  assert.equal(result.next.gainPct, 25);
  // 下一档 距离 125，当前 120，还差 (125-120)/125 = 4%
  assert.equal(result.nearestPct, 4);
});

test('evaluateSellSignals 宽基项 返回空结果', () => {
  const plan = buildSellPlan({ symbol: 'QQQ', holdingCost: 400, holdingShares: 100 });
  const result = evaluateSellSignals(plan, 999);
  assert.deepEqual(result, { triggered: [], next: null, nearestPct: 0 });
});

test('DEFAULT_GAIN_TRIGGERS / DEFAULT_SELL_RATIOS 锁定值', () => {
  assert.deepEqual(DEFAULT_GAIN_TRIGGERS, [15, 25, 35]);
  assert.deepEqual(DEFAULT_SELL_RATIOS, [0.33, 0.33, 0.34]);
});
