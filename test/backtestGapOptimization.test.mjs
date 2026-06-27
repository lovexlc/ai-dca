import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildGapDistributionThresholdGrids } from '../src/components/markets/backtestGapOptimization.js';

function rows(premiums = []) {
  return premiums.map((premiumPct, index) => ({
    date: `2026-06-${String(index + 1).padStart(2, '0')}`,
    close: 1 + Number(premiumPct) / 100,
  }));
}

const navRows = Array.from({ length: 12 }, (_, index) => ({
  date: `2026-06-${String(index + 1).padStart(2, '0')}`,
  nav: 1,
}));

test('gap distribution grid uses mean/std bounded 8x8 thresholds', () => {
  const result = buildGapDistributionThresholdGrids({
    highCodes: ['H1', 'H2'],
    lowCodes: ['L1'],
    historyByCode: {
      H1: rows([4, 4.2, 4.4, 4.6, 4.8, 5, 5.2, 5.4, 5.6, 5.8, 6, 6.2]),
      H2: rows([3, 3.1, 3.4, 3.6, 3.8, 4, 4.2, 4.4, 4.6, 4.8, 5, 5.2]),
      L1: rows(Array.from({ length: 12 }, () => 1)),
    },
    navHistoryByCode: { H1: navRows, H2: navRows, L1: navRows }
  });

  assert.ok(result.stats);
  assert.ok(result.stats.sampleCount >= 20);
  assert.ok(result.sellLowerGrid.length <= 8);
  assert.ok(result.buyOtherGrid.length <= 8);
  assert.ok(result.buyOtherGrid.some((buy) => result.sellLowerGrid.some((sell) => buy > sell)));
  assert.ok(Math.max(...result.sellLowerGrid) <= result.stats.mean);
  assert.ok(Math.min(...result.buyOtherGrid) >= result.stats.mean);
});

test('gap distribution grid falls back when samples are insufficient', () => {
  const fallbackSellLowerGrid = [0.4];
  const fallbackBuyOtherGrid = [2.5];
  const result = buildGapDistributionThresholdGrids({
    highCodes: ['H1'],
    lowCodes: ['L1'],
    historyByCode: {
      H1: rows([4, 4.2]),
      L1: rows([1, 1.1]),
    },
    navHistoryByCode: { H1: navRows, L1: navRows },
    fallbackSellLowerGrid,
    fallbackBuyOtherGrid,
  });

  assert.deepEqual(result.sellLowerGrid, fallbackSellLowerGrid);
  assert.deepEqual(result.buyOtherGrid, fallbackBuyOtherGrid);
  assert.equal(result.stats, null);
});
