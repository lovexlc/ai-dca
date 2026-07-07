import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPremiumSpreadInputFromLegacyRows,
  buildPremiumPanel,
  buildNavLookup,
  classifyPremiumCodes,
  createTradeSimulator,
  normalizeBacktestCandles,
  runBacktest,
  runPremiumSpreadBacktest
} from '../src/app/backtest/index.js';
import { isChinaMarketHoliday } from '../src/app/holidaysCN.js';

function premiumCandles(premiums = [], { start = Math.floor(Date.UTC(2026, 5, 12, 1, 30) / 1000), step = 300 } = {}) {
  return premiums.map((premiumPct, index) => ({
    t: start + index * step,
    c: 1 + Number(premiumPct) / 100
  }));
}

test('unified backtest entry runs premium-spread strategy with one schema', () => {
  const gaps = [3, 3, 1, 1, 3, 3, 1, 1, 3, 3, 1, 1];
  const result = runBacktest({
    type: 'premium-spread',
    id: 'unified',
    name: 'Unified Backtest',
    highCodes: ['513100'],
    lowCodes: ['159501'],
    activeSide: 'all',
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3
  }, {
    timeframe: '5m',
    initialEquity: 100000,
    historyByCode: {
      '513100': premiumCandles(gaps),
      '159501': premiumCandles(gaps.map(() => 0))
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-06-12', nav: 1 }],
      '159501': [{ date: '2026-06-12', nav: 1 }]
    },
    crossBorderCodes: []
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'passed');
  assert.equal(result.strategyId, 'unified');
  assert.equal(result.summary.sampleCount, 12);
  assert.ok(result.summary.signalCount > 0);
  assert.ok(Array.isArray(result.rows));
  assert.ok(Array.isArray(result.signals));
  assert.ok(Array.isArray(result.trades));
  assert.equal(result.chart.code, '513100');
  assert.equal(result.quality.passed, true);
});

test('premium panel aligns K-line and NAV data once before simulation', () => {
  const panel = buildPremiumPanel({
    codes: ['513100', '159501'],
    historyByCode: {
      '513100': premiumCandles(Array.from({ length: 12 }, () => 5)),
      '159501': premiumCandles(Array.from({ length: 10 }, () => 1))
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-06-12', nav: 1 }],
      '159501': [{ date: '2026-06-12', nav: 1 }]
    },
    crossBorderCodes: []
  });

  assert.equal(panel.anchorCode, '513100');
  assert.equal(panel.anchorCandles.length, 12);
  assert.equal(panel.rows.length, 10);
  assert.equal(panel.coverage.completePriceRows, 10);
  assert.equal(panel.coverage.completeNavRows, 10);
  assert.equal(panel.coverage.priceCoveragePct, 83.33);
  assert.equal(panel.coverage.navCoveragePct, 100);
  assert.equal(panel.rows[0].premiums['513100'], 5);
  assert.equal(panel.rows[0].premiums['159501'], 1);
  assert.equal(panel.getBar('159501', panel.rows[0].ts).close, 1.01);
});

test('premium panel classification uses realized average premium', () => {
  const panel = buildPremiumPanel({
    codes: ['159513', '513100'],
    historyByCode: {
      '159513': premiumCandles(Array.from({ length: 12 }, () => 2)),
      '513100': premiumCandles(Array.from({ length: 12 }, () => 5))
    },
    navHistoryByCode: {
      '159513': [{ date: '2026-06-12', nav: 1 }],
      '513100': [{ date: '2026-06-12', nav: 1 }]
    },
    crossBorderCodes: []
  });

  const classified = classifyPremiumCodes(panel);
  assert.deepEqual(classified.highCodes, ['513100']);
  assert.deepEqual(classified.lowCodes, ['159513']);
  assert.equal(classified.avgPremiumByCode['513100'], 5);
  assert.equal(classified.avgPremiumByCode['159513'], 2);
});

test('premium panel classification samples each code independently', () => {
  const panel = buildPremiumPanel({
    codes: ['513100', '159501'],
    historyByCode: {
      '513100': premiumCandles([
        ...Array.from({ length: 10 }, () => 2),
        8,
        8
      ]),
      '159501': premiumCandles(Array.from({ length: 10 }, () => 2.5))
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-06-12', nav: 1 }],
      '159501': [{ date: '2026-06-12', nav: 1 }]
    },
    crossBorderCodes: []
  });

  const classified = classifyPremiumCodes(panel);
  assert.equal(panel.rows.length, 10);
  assert.deepEqual(classified.highCodes, ['513100']);
  assert.deepEqual(classified.lowCodes, ['159501']);
  assert.equal(classified.avgPremiumByCode['513100'], 3);
  assert.equal(classified.avgPremiumByCode['159501'], 2.5);
});

test('deprecated premium-spread alias delegates to the unified engine', () => {
  const result = runPremiumSpreadBacktest({
    highCodes: ['513100'],
    lowCodes: ['159501'],
    intraBuyOtherPct: 3
  }, {
    historyByCode: {
      '513100': premiumCandles(Array.from({ length: 12 }, () => 4)),
      '159501': premiumCandles(Array.from({ length: 12 }, () => 0))
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-06-12', nav: 1 }],
      '159501': [{ date: '2026-06-12', nav: 1 }]
    },
    crossBorderCodes: []
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'passed');
});

test('premium-spread auto classifies inverted H/L labels by actual average premium', () => {
  const result = runPremiumSpreadBacktest({
    highCodes: ['159513'],
    lowCodes: ['513100'],
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3
  }, {
    historyByCode: {
      '159513': premiumCandles(Array.from({ length: 12 }, () => 2)),
      '513100': premiumCandles(Array.from({ length: 12 }, () => 5))
    },
    navHistoryByCode: {
      '159513': [{ date: '2026-06-12', nav: 1 }],
      '513100': [{ date: '2026-06-12', nav: 1 }]
    },
    crossBorderCodes: [],
    silent: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'passed');
  assert.equal(result.autoClassified, true);
  assert.deepEqual(result.effectiveHighCodes, ['513100']);
  assert.deepEqual(result.effectiveLowCodes, ['159513']);
  assert.equal(result.summary.highCode, '513100');
  assert.equal(result.summary.lowCode, '159513');
  assert.equal(result.avgPremiumByCode['513100'], 5);
  assert.equal(result.avgPremiumByCode['159513'], 2);
});

test('premium-spread chooses highest gap low candidate when holding H', () => {
  const result = runBacktest({
    type: 'premium-spread',
    highCodes: ['513100'],
    lowCodes: ['159501', '159941'],
    initialSide: 'H',
    autoClassify: false,
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3
  }, {
    timeframe: '5m',
    initialEquity: 100000,
    feeRate: 0,
    slippageTicks: 0,
    historyByCode: {
      '513100': premiumCandles(Array.from({ length: 12 }, () => 5)),
      '159501': premiumCandles(Array.from({ length: 12 }, () => 1)),
      '159941': premiumCandles(Array.from({ length: 12 }, () => 0))
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-06-12', nav: 1 }],
      '159501': [{ date: '2026-06-12', nav: 1 }],
      '159941': [{ date: '2026-06-12', nav: 1 }]
    },
    crossBorderCodes: [],
    silent: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.signals[0].fromCode, '513100');
  assert.equal(result.signals[0].toCode, '159941');
  assert.equal(result.signals[0].targetReason, 'max_gap');
  assert.equal(result.signals[0].gapPct, 5);
});

test('premium-spread chooses lowest gap high candidate when holding L', () => {
  const result = runBacktest({
    type: 'premium-spread',
    highCodes: ['513100', '513300'],
    lowCodes: ['159501'],
    initialSide: 'L',
    autoClassify: false,
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3
  }, {
    timeframe: '5m',
    initialEquity: 100000,
    feeRate: 0,
    slippageTicks: 0,
    historyByCode: {
      '513100': premiumCandles(Array.from({ length: 12 }, () => 3)),
      '513300': premiumCandles(Array.from({ length: 12 }, () => 1.2)),
      '159501': premiumCandles(Array.from({ length: 12 }, () => 1))
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-06-12', nav: 1 }],
      '513300': [{ date: '2026-06-12', nav: 1 }],
      '159501': [{ date: '2026-06-12', nav: 1 }]
    },
    crossBorderCodes: [],
    silent: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.signals[0].fromCode, '159501');
  assert.equal(result.signals[0].toCode, '513300');
  assert.equal(result.signals[0].targetReason, 'min_gap');
  assert.equal(result.signals[0].gapPct, 0.2);
});

test('legacy premium rows adapt to unified backtest inputs', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    date: `2026-06-${String(index + 1).padStart(2, '0')}`,
    sellBid: index % 4 < 2 ? 1.03 : 1.01,
    sellAsk: index % 4 < 2 ? 1.031 : 1.011,
    sellIOPV: 1,
    buyBid: 1,
    buyAsk: 1.001,
    buyIOPV: 1
  }));
  const { historyByCode, navHistoryByCode } = buildPremiumSpreadInputFromLegacyRows(rows, {
    highCode: '159513',
    lowCode: '513100'
  });

  const result = runBacktest({
    type: 'premium-spread',
    highCodes: ['159513'],
    lowCodes: ['513100'],
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3
  }, {
    timeframe: '1d',
    historyByCode,
    navHistoryByCode,
    crossBorderCodes: []
  });

  assert.equal(historyByCode['159513'].length, 12);
  assert.equal(navHistoryByCode['513100'].length, 12);
  assert.equal(result.status, 'passed');
  assert.equal(result.summary.sampleCount, 12);
});

test('core helpers normalize candles, nav, and bid ask execution prices', () => {
  const candles = normalizeBacktestCandles([{
    t: Math.floor(Date.UTC(2026, 0, 2, 1, 35) / 1000),
    c: 1.03,
    orderBook: { bidPrice: 1.02, askPrice: 1.04 }
  }]);
  const navLookup = buildNavLookup([
    { date: '2026-01-01', nav: 1 },
    { date: '2026-01-03', nav: 1.1 }
  ]);
  const simulator = createTradeSimulator({ initialCash: 10000, feeRate: 0, slippageTicks: 1 });

  const buy = simulator.executeBuy('513100', candles[0], 10000);
  const sell = simulator.executeSell('513100', candles[0]);

  assert.equal(candles[0].datetime, '2026-01-02 09:35');
  assert.equal(navLookup('2026-01-02'), 1);
  assert.equal(navLookup('2026-01-04'), 1.1);
  assert.equal(buy.price, 1.04);
  assert.equal(buy.priceSource, 'ask');
  assert.equal(sell.price, 1.02);
  assert.equal(sell.priceSource, 'bid');
});

test('trade simulator can ceil buy to next 100-share lot and carry negative cash', () => {
  const simulator = createTradeSimulator({ initialCash: 100000, feeRate: 0, lotSize: 100 });
  const buy = simulator.executeBuy('513100', { close: 1002 }, 100000, { roundLotMode: 'ceil' });

  assert.equal(buy.shares, 100);
  assert.equal(buy.totalCost, 100200);
  assert.equal(simulator.cash, -200);
});

test('trade simulator accumulates repeated buys into one weighted position', () => {
  const simulator = createTradeSimulator({ initialCash: 1000, feeRate: 0, lotSize: 1, useQuotedPrices: false });

  simulator.executeBuy('513100', { close: 1 }, 100);
  simulator.executeBuy('513100', { close: 2 }, 200);

  assert.equal(simulator.positions['513100'].shares, 200);
  assert.equal(simulator.positions['513100'].costPrice, 1.5);
  assert.equal(simulator.calcEquity({ '513100': 2 }), 1100);
});

test('unified engine reports quality failure for missing kline data', () => {
  const result = runBacktest({
    type: 'premium-spread',
    highCodes: ['159509'],
    lowCodes: ['513100']
  }, {
    timeframe: '5m',
    historyByCode: {
      '159509': [],
      '513100': premiumCandles(Array.from({ length: 12 }, () => 0))
    },
    navHistoryByCode: {
      '159509': [{ date: '2026-06-12', nav: 1 }],
      '513100': [{ date: '2026-06-12', nav: 1 }]
    },
    crossBorderCodes: [],
    dataIssues: {
      kline: [{ code: '159509', timeframe: '5m', reason: 'empty' }]
    }
  });

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.quality.missingKlineCodes, ['159509']);
  assert.match(result.quality.reason, /159509/);
});

test('premium panel uses previous available NAV for 513100 on 2025-04-09', () => {
  const t = Math.floor(Date.parse('2025-04-09T15:00:00+08:00') / 1000);
  const panel = buildPremiumPanel({
    codes: ['513100'],
    historyByCode: {
      '513100': [{ t, c: 1.300 }]
    },
    navHistoryByCode: {
      '513100': [
        { date: '2025-04-08', nav: 1.2350 },
        { date: '2025-04-09', nav: 1.3830 }
      ]
    }
  });

  assert.equal(panel.rows.length, 1);
  assert.equal(panel.rows[0].premiums['513100'], 5.2632);
});

test('premium panel uses post-holiday NAV for 513100 on 2025-04-07', () => {
  const t = Math.floor(Date.parse('2025-04-07T15:00:00+08:00') / 1000);
  const panel = buildPremiumPanel({
    codes: ['513100'],
    historyByCode: {
      '513100': [{ t, c: 1.272 }]
    },
    navHistoryByCode: {
      '513100': [
        { date: '2025-04-03', nav: 1.336 },
        { date: '2025-04-07', nav: 1.259 }
      ]
    }
  });

  assert.equal(panel.rows.length, 1);
  assert.equal(panel.rows[0].premiums['513100'], 1.0326);
});

test('premium panel can skip cross-border China holiday NAV gaps for backtests', () => {
  const t = Math.floor(Date.parse('2025-04-07T15:00:00+08:00') / 1000);
  const panel = buildPremiumPanel({
    codes: ['513100'],
    historyByCode: {
      '513100': [{ t, c: 1.272 }]
    },
    navHistoryByCode: {
      '513100': [
        { date: '2025-04-03', nav: 1.336 },
        { date: '2025-04-07', nav: 1.259 }
      ]
    },
    skipChinaHolidayGap: true
  });

  assert.equal(panel.rows.length, 1);
  assert.equal(panel.rows[0].canTrade, false);
  assert.equal(panel.rows[0].currentPrices['513100'], 1.272);
  assert.equal(panel.rows[0].premiums['513100'], undefined);
  assert.equal(panel.coverage.completeNavRows, 0);

  const simulator = createTradeSimulator({ initialCash: 10000, feeRate: 0, lotSize: 100, useQuotedPrices: false });
  simulator.executeBuy('513100', { close: 1.272 }, 10000, { roundLotMode: 'ceil' });
  assert.ok(simulator.cash < 0);
  assert.equal(simulator.calcEquity(panel.rows[0].currentPrices), 10000);
});

test('A-share holiday table covers 2024 National Day used by two-year premium backtests', () => {
  assert.equal(isChinaMarketHoliday('2024-10-01'), true);
  assert.equal(isChinaMarketHoliday('2024-10-07'), true);
  assert.equal(isChinaMarketHoliday('2024-10-08'), false);
});
