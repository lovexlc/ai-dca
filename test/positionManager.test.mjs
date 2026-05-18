// node --test test/positionManager.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STOCK_MAX_WEIGHT_PCT,
  calculatePositions,
  checkWeightLimit,
  generateRebalanceAdvice
} from '../src/app/positionManager.js';

test('calculatePositions 正常权重计算', () => {
  const r = calculatePositions({
    totalAssets: 10000,
    prices: { NVDA: 100, QQQ: 400 },
    shares: { NVDA: 30, QQQ: 10 }
  });
  // NVDA 市值 3000 = 30%，QQQ 市值 4000 = 40%，现金 30%
  assert.equal(r.rows.length, 2);
  assert.equal(r.totalMarketValue, 7000);
  assert.equal(r.cashValue, 3000);
  assert.equal(r.cashWeightPct, 30);
  const nvda = r.rows.find((row) => row.symbol === 'NVDA');
  const qqq = r.rows.find((row) => row.symbol === 'QQQ');
  assert.equal(nvda.weightPct, 30);
  assert.equal(qqq.weightPct, 40);
  assert.equal(nvda.exceedsCap, false);
  assert.equal(qqq.exceedsCap, false); // 宽基不限仓位
});

test('calculatePositions 个股超仓 50% 警告', () => {
  const r = calculatePositions({
    totalAssets: 10000,
    prices: { NVDA: 100 },
    shares: { NVDA: 60 } // 6000 = 60%
  });
  const row = r.rows[0];
  assert.equal(row.exceedsCap, true);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].kind, 'over_cap');
});

test('calculatePositions 宽基超 50% 不报警', () => {
  const r = calculatePositions({
    totalAssets: 10000,
    prices: { QQQ: 400 },
    shares: { QQQ: 20 } // 8000 = 80%
  });
  assert.equal(r.rows[0].weightPct, 80);
  assert.equal(r.rows[0].exceedsCap, false);
  assert.deepEqual(r.warnings, []);
});

test('calculatePositions totalAssets=0 时退化为市值合计', () => {
  const r = calculatePositions({
    totalAssets: 0,
    prices: { NVDA: 100 },
    shares: { NVDA: 10 }
  });
  assert.equal(r.totalAssets, 1000);
  assert.equal(r.rows[0].weightPct, 100);
});

test('checkWeightLimit 宽基免检', () => {
  const r = checkWeightLimit({ symbol: 'QQQ', buyAmount: 99999, positionsResult: { totalAssets: 1, rows: [] } });
  assert.equal(r.ok, true);
});

test('checkWeightLimit 个股买后超仓', () => {
  const pos = calculatePositions({
    totalAssets: 10000,
    prices: { NVDA: 100 },
    shares: { NVDA: 40 } // 4000 = 40%
  });
  const r = checkWeightLimit({ symbol: 'NVDA', buyAmount: 2000, positionsResult: pos });
  assert.equal(r.ok, false);
  assert.equal(r.projectedWeightPct, 60);
  assert.equal(r.capPct, STOCK_MAX_WEIGHT_PCT);
});

test('generateRebalanceAdvice 正常返回 OK', () => {
  const pos = calculatePositions({
    totalAssets: 8000,
    prices: { NVDA: 100, QQQ: 400 },
    shares: { NVDA: 30, QQQ: 8 } // NVDA 37.5%、QQQ 40%、现金 22.5%
  });
  const tips = generateRebalanceAdvice(pos);
  assert.equal(tips.length, 1);
  assert.equal(tips[0].kind, 'ok');
});

test('generateRebalanceAdvice 超仓 + 现金多 -> trim + deploy', () => {
  const pos = calculatePositions({
    totalAssets: 10000,
    prices: { NVDA: 100 },
    shares: { NVDA: 60 } // 60% 超仓，现金 -2000 限制为 0 · 但总资 10000 、现金占 -20%被刪到 0
  });
  const tips = generateRebalanceAdvice(pos);
  assert.ok(tips.some((t) => t.kind === 'trim'));
});
