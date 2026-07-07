import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGapDistributionThresholdGrids,
  DEFAULT_BUY_OTHER_GRID,
  DEFAULT_SELL_LOWER_GRID,
  hasValidThresholdSpread,
  isValidThresholdPair,
  MIN_THRESHOLD_SPREAD,
} from '../src/components/markets/backtestGapOptimization.js';

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

function dateFromDayOffset(offset) {
  return new Date(Date.UTC(2025, 3, 9 + offset)).toISOString().slice(0, 10);
}

function previousDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

test('gap distribution grid uses mean/std bounded 8x8 thresholds', () => {
  const result = buildGapDistributionThresholdGrids({
    highCodes: ['H1', 'H2'],
    lowCodes: ['L1'],
    historyByCode: {
      H1: rows([-1.2, -1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1]),
      H2: rows([-1.4, -1.1, -0.9, -0.7, -0.5, -0.3, -0.1, 0.1, 0.3, 0.5, 0.7, 0.9]),
      L1: rows(Array.from({ length: 12 }, () => 0)),
    },
    navHistoryByCode: { H1: navRows, H2: navRows, L1: navRows }
  });

  assert.ok(result.stats);
  assert.ok(result.stats.sampleCount >= 20);
  assert.ok(result.sellLowerGrid.length <= 8);
  assert.ok(result.buyOtherGrid.length <= 8);
  assert.ok(hasValidThresholdSpread(result.sellLowerGrid, result.buyOtherGrid));
  assert.ok(result.sellLowerGrid.every((sell) => result.buyOtherGrid.some((buy) => isValidThresholdPair(sell, buy))));
  assert.ok(result.buyOtherGrid.every((buy) => result.sellLowerGrid.some((sell) => isValidThresholdPair(sell, buy))));
  assert.ok(Math.max(...result.sellLowerGrid) <= result.stats.mean);
  assert.ok(Math.min(...result.buyOtherGrid) >= result.stats.mean);
});

test('default optimization grid allows any threshold band at least one point wide', () => {
  assert.ok(DEFAULT_SELL_LOWER_GRID.includes(-0.5));
  assert.ok(DEFAULT_BUY_OTHER_GRID.includes(0.5));
  assert.ok(hasValidThresholdSpread(DEFAULT_SELL_LOWER_GRID, DEFAULT_BUY_OTHER_GRID));
  assert.ok(0.5 - (-0.5) >= MIN_THRESHOLD_SPREAD);
  assert.equal(isValidThresholdPair(-0.5, 0.5), true);
  assert.equal(isValidThresholdPair(-0.5, 0), false);
  assert.equal(isValidThresholdPair(0, 0.5), false);
  assert.equal(isValidThresholdPair(0.5, 1.5), true);
  assert.equal(isValidThresholdPair(-2, -1), true);
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

test('gap distribution uses previous available NAV for QDII premium samples', () => {
  const sampleDates = Array.from({ length: 12 }, (_, index) => dateFromDayOffset(index * 3));
  const qdiiNavRows = sampleDates.flatMap((date, index) => [
    { date: dateFromDayOffset(index * 3 - 1), nav: 1 },
    { date, nav: 10 },
  ]);
  const result = buildGapDistributionThresholdGrids({
    highCodes: ['513100'],
    lowCodes: ['L1'],
    historyByCode: {
      '513100': sampleDates.map((date) => ({ date, close: 1.05 })),
      L1: sampleDates.map((date) => ({ date, close: 1 })),
    },
    navHistoryByCode: {
      '513100': qdiiNavRows,
      L1: sampleDates.map((date) => ({ date, nav: 1 })),
    },
    crossBorderCodes: new Set(['513100']),
  });

  assert.ok(Math.abs(result.stats.mean - 5) < 1e-9);
  assert.equal(result.stats.sampleCount, 12);
});

test('gap distribution skips QDII samples that cross A-share holiday NAV gaps', () => {
  const regularDates = [
    '2025-06-04',
    '2025-06-05',
    '2025-06-06',
    '2025-06-09',
    '2025-06-10',
    '2025-06-11',
    '2025-06-12',
    '2025-06-13',
    '2025-06-16',
    '2025-06-17',
    '2025-06-18',
  ];
  const sampleDates = ['2025-04-07', ...regularDates];
  const qdiiNavRows = [
    { date: '2025-04-03', nav: 1 },
    { date: '2025-04-07', nav: 10 },
    ...regularDates.map((date) => ({ date: previousDate(date), nav: 1 })),
  ];
  const result = buildGapDistributionThresholdGrids({
    highCodes: ['513100'],
    lowCodes: ['L1'],
    historyByCode: {
      '513100': sampleDates.map((date) => ({ date, close: 1.05 })),
      L1: sampleDates.map((date) => ({ date, close: 1 })),
    },
    navHistoryByCode: {
      '513100': qdiiNavRows,
      L1: sampleDates.map((date) => ({ date, nav: 1 })),
    },
    crossBorderCodes: new Set(['513100']),
    skipChinaHolidayGap: true,
  });

  assert.equal(result.stats.sampleCount, 11);
});
