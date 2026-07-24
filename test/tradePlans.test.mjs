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

function seedDcaStore(plans, activeDcaId = '') {
  memory.set('aiDcaDcaStore', JSON.stringify({
    source: 'react-dca-store',
    version: 1,
    activeDcaId: activeDcaId || plans[0]?.id || '',
    plans
  }));
}

const {
  buildTradePlanCenter,
  buildPlanFooterLabel,
  computeBuyPointGapPct,
  enrichTradePlanRowsWithQuotes,
  formatBuyPointGapLabel
} = await import('../src/app/tradePlans.js');

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

test('buildDcaRows: aiDcaDcaStore 中多个定投计划分别生成列表卡片', () => {
  resetStore();
  seedDcaStore([
    {
      id: 'dca-weekly-qqq',
      name: 'QQQ 每周定投',
      symbol: 'QQQ',
      frequency: '每周',
      executionDay: 2,
      recurringInvestment: 300,
      termMonths: 12,
      isConfigured: true,
      createdAt: '2026-05-10T00:00:00Z',
      updatedAt: '2026-05-10T00:00:00Z'
    },
    {
      id: 'dca-monthly-spy',
      name: 'SPY 每月定投',
      symbol: 'SPY',
      frequency: '每月',
      executionDay: 8,
      recurringInvestment: 500,
      termMonths: 24,
      isConfigured: true,
      createdAt: '2026-05-11T00:00:00Z',
      updatedAt: '2026-05-11T00:00:00Z'
    }
  ], 'dca-weekly-qqq');

  const center = buildTradePlanCenter(new Date('2026-05-18T00:00:00Z'));
  const dcaRows = center.previewRows.filter((row) => row.sourceType === 'dca');
  assert.equal(dcaRows.length, 2);
  assert.deepEqual(new Set(dcaRows.map((row) => row.ruleId)), new Set(['dca:dca-weekly-qqq', 'dca:dca-monthly-spy']));
  assert.deepEqual(new Set(dcaRows.map((row) => row.planName)), new Set(['QQQ 每周定投', 'SPY 每月定投']));
  assert.ok(dcaRows.every((row) => row.editPayload?.id === row.sourceId));
  assert.ok(dcaRows.every((row) => Array.isArray(row.detailItems) && row.detailItems.length > 0));
});

test('computeBuyPointGapPct: 相对当前价计算距买入点差距比例', () => {
  assert.equal(computeBuyPointGapPct(10, 9), 10);
  assert.equal(computeBuyPointGapPct(10, 10), 0);
  assert.ok(Math.abs(computeBuyPointGapPct(9, 10) - (-100 / 9)) < 1e-9);
  assert.equal(computeBuyPointGapPct(0, 9), null);
  assert.equal(formatBuyPointGapLabel(10), '距买入点还差 10%');
  assert.equal(formatBuyPointGapLabel(0), '已达买入点');
  assert.equal(formatBuyPointGapLabel(-2), '已达买入点');
  assert.match(buildPlanFooterLabel({ order: 1, amount: 1400, gapPct: 8.5 }), /距买入点还差 8\.5%/);
});

test('enrichTradePlanRowsWithQuotes: 在 footer 追加距买入点差距比例', () => {
  const rows = [{
    sourceType: 'plan',
    symbol: '513100',
    order: 1,
    targetPrice: 1.0,
    layerAmount: 1400,
    footerLabel: buildPlanFooterLabel({ order: 1, amount: 1400 })
  }];
  const enriched = enrichTradePlanRowsWithQuotes(rows, {
    '513100': { price: 1.1 }
  });
  assert.ok(Math.abs(enriched[0].buyPointGapPct - (100 / 11)) < 1e-9);
  assert.match(enriched[0].footerLabel, /预计买入 ¥ 1,400\.00/);
  assert.match(enriched[0].footerLabel, /距买入点还差 9\.1%/);
});
