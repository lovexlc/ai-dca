import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  annualizedImprovement,
  calculateSharedKlineCoverage,
  recommendationWinRate,
  runRecommendationBacktestScenario,
  selectBacktestCounterpart,
  selectRecommendationThresholdForSide,
  selectRecommendedThreshold,
  switchRecommendationCrossBorderCodes
} from '../workers/notify/src/switchRecommendation.js';

function premiumCandles(premiums = [], start = Math.floor(Date.UTC(2026, 5, 12, 1, 30) / 1000)) {
  return premiums.map((premiumPct, index) => ({
    t: start + index * 300,
    c: 1 + Number(premiumPct) / 100
  }));
}

test('recommendation selects a signal-producing pair with valid shared history', () => {
  const selected = selectBacktestCounterpart([
    {
      candidateCode: '159513',
      currentRank: 0,
      annualizedReturnPct: 20,
      result: { status: 'failed', summary: { signalCount: 4, sampleCount: 480 } }
    },
    {
      candidateCode: '159509',
      currentRank: 1,
      annualizedReturnPct: 8,
      result: { status: 'passed', summary: { signalCount: 2, sampleCount: 460 } }
    },
    {
      candidateCode: '159941',
      currentRank: 2,
      annualizedReturnPct: 12,
      result: { status: 'passed', summary: { signalCount: 0, sampleCount: 500 } }
    }
  ]);

  assert.equal(selected.candidateCode, '159509');
});

test('recommendation selects the best valid threshold by return, win rate, then drawdown', () => {
  const result = selectRecommendedThreshold([
    { threshold: 2, passed: true, cycleCount: 1, annualizedReturnPct: 8, winRatePct: 70, maxDrawdownPct: 4 },
    { threshold: 2.5, passed: true, cycleCount: 2, annualizedReturnPct: 10, winRatePct: 60, maxDrawdownPct: 6 },
    { threshold: 2.65, passed: true, cycleCount: 2, annualizedReturnPct: 10, winRatePct: 60, maxDrawdownPct: 5 },
    { threshold: 3, passed: true, cycleCount: 1, annualizedReturnPct: 9, winRatePct: 80, maxDrawdownPct: 3 }
  ]);

  assert.equal(result.status, 'optimized');
  assert.equal(result.metric, 'annualizedReturnPct');
  assert.equal(result.item.threshold, 2.65);
});

test('low-side recommendation can optimize away from the one-percent fallback', () => {
  const result = selectRecommendationThresholdForSide([
    { threshold: 0.75, passed: true, cycleCount: 1, annualizedReturnPct: 8, winRatePct: 50, maxDrawdownPct: -4 },
    { threshold: 1, passed: true, cycleCount: 1, annualizedReturnPct: 6, winRatePct: 50, maxDrawdownPct: -3 }
  ], 'low');

  assert.equal(result.status, 'optimized');
  assert.equal(result.item.threshold, 0.75);
});

test('recommendation drawdown tie-breaker prefers the smaller negative drawdown magnitude', () => {
  const result = selectRecommendedThreshold([
    { threshold: 0.75, passed: true, cycleCount: 1, annualizedReturnPct: 8, winRatePct: 50, maxDrawdownPct: -8 },
    { threshold: 1.25, passed: true, cycleCount: 1, annualizedReturnPct: 8, winRatePct: 50, maxDrawdownPct: -3 }
  ], 1);

  assert.equal(result.item.threshold, 1.25);
});

test('recommendation marks the default as fallback when no threshold has a valid trade', () => {
  const result = selectRecommendedThreshold([
    { threshold: 2, passed: true, tradeCount: 0, triggerCount: 0, annualizedReturnPct: 0, winRatePct: 0, maxDrawdownPct: 0 },
    { threshold: 2.65, passed: true, tradeCount: 0, triggerCount: 0, annualizedReturnPct: 0, winRatePct: 0, maxDrawdownPct: 0 }
  ]);

  assert.equal(result.status, 'fallback');
  assert.equal(result.item.threshold, 2.65);
});

test('recommendation annualized improvement subtracts the original holding return', () => {
  const from = '2025-01-01';
  const to = '2026-01-01';
  const result = {
    summary: { from, to, totalReturnPct: 10 }
  };
  const holdingHistory = [
    { date: from, t: Date.parse(`${from}T00:00:00Z`) / 1000, close: 100 },
    { date: to, t: Date.parse(`${to}T00:00:00Z`) / 1000, close: 105 }
  ];

  assert.equal(annualizedImprovement(result, holdingHistory), 5);
});

test('recommendation leaves win rate empty until a full rotation cycle completes', () => {
  assert.equal(recommendationWinRate({ summary: { signalCount: 1, cycleCount: 0, winRatePct: null } }), null);
  assert.equal(recommendationWinRate({ summary: { signalCount: 2, cycleCount: 1, winRatePct: 100 } }), 100);
});

test('recommendation marks catalog QDII codes as cross-border backtest inputs', () => {
  assert.deepEqual(
    switchRecommendationCrossBorderCodes(['513100', '159501', '000001']),
    ['513100', '159501']
  );
});

test('recommendation calculates the shared K-line coverage in months for the selected pair', () => {
  const coverage = calculateSharedKlineCoverage({
    '000001': [
      { t: Date.parse('2026-01-01T00:00:00Z') / 1000, date: '2026-01-01' },
      { t: Date.parse('2026-06-20T00:00:00Z') / 1000, date: '2026-06-20' }
    ],
    '000002': [
      { t: Date.parse('2026-02-01T00:00:00Z') / 1000, date: '2026-02-01' },
      { t: Date.parse('2026-07-20T00:00:00Z') / 1000, date: '2026-07-20' }
    ]
  }, ['000001', '000002']);

  assert.deepEqual(coverage, {
    from: '2026-02-01',
    to: '2026-06-20',
    days: 139,
    months: 4.6
  });
});

test('low-side 5m recommendation comparisons apply each candidate threshold', () => {
  const base = {
    holdingCode: '000002',
    codes: ['000001', '000002'],
    historyByCode: {
      '000001': premiumCandles(Array.from({ length: 12 }, () => 0.5)),
      '000002': premiumCandles(Array.from({ length: 12 }, () => 0))
    },
    navHistoryByCode: {
      '000001': [{ date: '2026-06-12', nav: 1 }],
      '000002': [{ date: '2026-06-12', nav: 1 }]
    },
    feeConfig: {},
    side: 'low',
    highCodes: ['000001'],
    lowCodes: ['000002'],
    holdingNotional: 100000,
    backtestParams: { timeframe: '5m' }
  };

  const strict = runRecommendationBacktestScenario({ ...base, threshold: 0.25 });
  const loose = runRecommendationBacktestScenario({ ...base, threshold: 0.75 });

  assert.equal(strict.summary.signalCount, 0);
  assert.equal(loose.summary.signalCount, 1);
  assert.equal(loose.summary.cycleCount, 0);
  assert.equal(loose.summary.winRatePct, null);
  assert.equal(loose.signals[0].threshold, 0.75);
});

test('worker recommendation win rate uses completed relative rotation instead of absolute sell profit', () => {
  const result = runRecommendationBacktestScenario({
    holdingCode: '000002',
    codes: ['000001', '000002'],
    historyByCode: {
      '000001': premiumCandles([0, ...Array.from({ length: 11 }, () => -5)]),
      '000002': premiumCandles([0, ...Array.from({ length: 11 }, () => -10)])
    },
    navHistoryByCode: {
      '000001': [{ date: '2026-06-12', nav: 1 }],
      '000002': [{ date: '2026-06-12', nav: 1 }]
    },
    feeConfig: {},
    threshold: 1,
    side: 'low',
    highCodes: ['000001'],
    lowCodes: ['000002'],
    holdingNotional: 100000,
    backtestParams: { timeframe: '5m' }
  });

  assert.equal(result.summary.signalCount, 2);
  assert.equal(result.summary.cycleCount, 1);
  assert.equal(result.summary.winningCycleCount, 1);
  assert.equal(result.summary.winRatePct, 100);
  assert.ok(result.trades.filter((trade) => trade.type === 'sell').every((trade) => trade.profit <= 0));
  assert.ok(result.cycles[0].excessProfit > 0);
});
