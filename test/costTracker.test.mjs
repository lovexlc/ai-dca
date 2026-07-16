// node --test test/costTracker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCostBasis,
  groupCostBasisBySymbol,
  attachUnrealized
} from '../src/app/costTracker.js';

test('买 100@100 后加买 50@80 -> 加权均价 ~93.33', () => {
  const r = calculateCostBasis([
    { side: 'buy', shares: 100, price: 100, date: '2026-01-01' },
    { side: 'buy', shares: 50, price: 80, date: '2026-02-01' }
  ]);
  assert.equal(r.summary.remainingShares, 150);
  assert.ok(Math.abs(r.summary.textbookCost - 93.3333) < 0.01);
  // 净现金流 = -14000，买减卖 = 14000 / 150 = 93.33（这里还不会负）
  assert.ok(Math.abs(r.summary.effectiveCost - 93.3333) < 0.01);
  assert.equal(r.summary.realizedPnl, 0);
  assert.equal(r.summary.isNegativeCost, false);
});

test('买 100@100 、卖 50@120 -> 已实现盈亏 1000、加权均价 100', () => {
  const r = calculateCostBasis([
    { side: 'buy', shares: 100, price: 100, date: '2026-01-01' },
    { side: 'sell', shares: 50, price: 120, date: '2026-02-01' }
  ]);
  assert.equal(r.summary.remainingShares, 50);
  assert.equal(r.summary.realizedPnl, 1000);
  assert.ok(Math.abs(r.summary.textbookCost - 100) < 1e-6);
  // 净现金流 = 10000 - 6000 = 4000，买减卖 = 4000/50 = 80
  assert.ok(Math.abs(r.summary.effectiveCost - 80) < 1e-6);
});

test('多轮 买/卖 后负成本检测', () => {
  const r = calculateCostBasis([
    { side: 'buy', shares: 100, price: 100, date: '2026-01-01' },
    { side: 'sell', shares: 50, price: 200, date: '2026-02-01' }, // 收回 10000
    { side: 'sell', shares: 30, price: 250, date: '2026-03-01' } // 收回 7500
  ]);
  // 总买 = 10000、总卖 = 17500 → 净现金流 = -7500、剩 20 股、买减卖 = -375 负成本
  assert.equal(r.summary.remainingShares, 20);
  assert.equal(r.summary.netCash, -7500);
  assert.equal(r.summary.effectiveCost, -375);
  assert.equal(r.summary.isNegativeCost, true);
  assert.ok(r.summary.realizedPnl > 0);
});

test('费用顺势扯调现金流 + 已实现盈亏', () => {
  const r = calculateCostBasis([
    { side: 'buy', shares: 10, price: 100, fee: 1, date: '2026-01-01' }, // 成本 1001
    { side: 'sell', shares: 10, price: 110, fee: 1, date: '2026-02-01' } // 收回 1099
  ]);
  // 加权均价 = 100.1，已实现 = (110-100.1)*10 - 1 = 98
  assert.equal(r.summary.remainingShares, 0);
  assert.equal(r.summary.realizedPnl, 98);
});

test('乱序日期 会被重新按日期排序', () => {
  const r = calculateCostBasis([
    { side: 'sell', shares: 50, price: 120, date: '2026-02-01' }, // 是后发生的
    { side: 'buy', shares: 100, price: 100, date: '2026-01-01' }
  ]);
  assert.equal(r.summary.remainingShares, 50);
  assert.equal(r.summary.realizedPnl, 1000);
});

test('groupCostBasisBySymbol 按 symbol 拆分', () => {
  const out = groupCostBasisBySymbol([
    { symbol: 'NVDA', side: 'buy', shares: 10, price: 100, date: '2026-01-01' },
    { symbol: 'QQQ', side: 'buy', shares: 5, price: 400, date: '2026-01-01' }
  ]);
  assert.deepEqual(Object.keys(out).sort(), ['NVDA', 'QQQ']);
  assert.equal(out.NVDA.summary.remainingShares, 10);
  assert.equal(out.QQQ.summary.remainingShares, 5);
});

test('groupCostBasisBySymbol 直接接受 holdings ledger 的 code/type 交易结构', () => {
  const out = groupCostBasisBySymbol([
    { code: '513100', type: 'BUY', shares: 100, price: 2.5, date: '2026-07-12' },
    { code: '513100', type: 'SELL', shares: 40, price: 2.6, date: '2026-07-13' }
  ]);
  assert.equal(out['513100'].summary.remainingShares, 60);
  assert.equal(out['513100'].summary.realizedPnl, 4);
});

test('attachUnrealized 计算未实现盈亏', () => {
  const base = calculateCostBasis([
    { side: 'buy', shares: 10, price: 100, date: '2026-01-01' }
  ]);
  const withPrice = attachUnrealized(base.summary, 150);
  assert.equal(withPrice.marketValue, 1500);
  assert.equal(withPrice.unrealizedPnl, 500);
  assert.equal(withPrice.totalPnl, 500);
});
