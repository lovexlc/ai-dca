// node --test test/tradePlans.test.mjs
// PR 1.5 覆盖：buildSellPlanRows / sortRows / summary.nextSellTrigger.
// 需 window.localStorage shim，所以在 import 之前先安装。
import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.window = {
  localStorage: {
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) { memory.set(key, String(value)); },
    removeItem(key) { memory.delete(key); }
  }
};

function resetStore() {
  memory.clear();
}

function seedSellPlanStore(plans) {
  memory.set('aiDcaSellPlanStore', JSON.stringify(plans));
}

function seedBuyPlanStore(plans) {
  // plan.js 定义 PLAN_KEY = 'aiDcaPlanStore'
  memory.set('aiDcaPlanStore', JSON.stringify(plans));
}

const { buildTradePlanCenter } = await import('../src/app/tradePlans.js');

test('buildSellPlanRows: NVDA 涵盖默认 3 档 + actionKey=sell + sourceType=sell', () => {
  resetStore();
  seedSellPlanStore([{
    id: 'sell-test-1',
    name: 'NVDA 减仓',
    symbol: 'NVDA',
    holdingCost: 100,
    holdingShares: 300,
    gainTriggers: [15, 25, 35],
    sellRatios: [0.33, 0.33, 0.34],
    isConfigured: true,
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z'
  }]);
  const center = buildTradePlanCenter(new Date('2026-05-18T00:00:00Z'));
  const sellRows = center.rows.filter((r) => r.sourceType === 'sell');
  assert.equal(sellRows.length, 3, 'should expand into 3 layers');
  assert.equal(sellRows[0].actionKey, 'sell');
  assert.equal(sellRows[0].symbol, 'NVDA');
  assert.equal(sellRows[0].statusTone, 'rose');
  assert.equal(sellRows[1].statusTone, 'slate');
  assert.ok(sellRows[0].triggerLabel.includes('盈利'));
  assert.ok(sellRows[0].triggerLabel.includes('$115.00'));
  assert.equal(center.summary.nextSellTrigger, sellRows[0].triggerLabel);
});

test('buildSellPlanRows: 宽基指数 QQQ 不起行', () => {
  resetStore();
  seedSellPlanStore([{
    id: 'sell-qqq',
    name: 'QQQ 试',
    symbol: 'QQQ',
    holdingCost: 400,
    holdingShares: 50,
    gainTriggers: [15, 25, 35],
    sellRatios: [0.33, 0.33, 0.34],
    isConfigured: true
  }]);
  const center = buildTradePlanCenter(new Date('2026-05-18T00:00:00Z'));
  const sellRows = center.rows.filter((r) => r.sourceType === 'sell');
  assert.equal(sellRows.length, 0, 'broad-index should not produce sell rows');
  assert.equal(center.summary.nextSellTrigger, '未配置');
});

test('sortRows: sell 在 dca 之前', () => {
  resetStore();
  seedSellPlanStore([{
    id: 'sell-amzn',
    name: 'AMZN 减仓',
    symbol: 'AMZN',
    holdingCost: 100,
    holdingShares: 100,
    gainTriggers: [15, 25, 35],
    sellRatios: [0.33, 0.33, 0.34],
    isConfigured: true,
    createdAt: '2026-05-12T00:00:00Z'
  }]);
  // 最小 DCA state：aiDcaDcaState。hasSavedDcaState 读 有 raw 即为 true。
  memory.set('aiDcaDcaState', JSON.stringify({
    symbol: 'NVDA',
    frequency: '每月',
    executionDay: 1,
    recurringInvestment: 500
  }));
  const center = buildTradePlanCenter(new Date('2026-05-18T00:00:00Z'));
  const order = center.rows.map((r) => r.sourceType);
  const firstSell = order.indexOf('sell');
  const firstDca = order.indexOf('dca');
  assert.notEqual(firstSell, -1, 'has sell rows');
  if (firstDca !== -1) {
    assert.ok(firstSell < firstDca, `sell(${firstSell}) should come before dca(${firstDca})`);
  }
});
