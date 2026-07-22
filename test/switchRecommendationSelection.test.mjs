import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  annualizedImprovement,
  recommendationWinRate,
  selectBacktestCounterpart,
  selectRecommendedThreshold,
  switchRecommendationCrossBorderCodes
} from '../workers/notify/src/switchRecommendation.js';

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
    { threshold: 2, passed: true, tradeCount: 4, triggerCount: 2, annualizedReturnPct: 8, winRatePct: 70, maxDrawdownPct: 4 },
    { threshold: 2.5, passed: true, tradeCount: 5, triggerCount: 3, annualizedReturnPct: 10, winRatePct: 60, maxDrawdownPct: 6 },
    { threshold: 2.65, passed: true, tradeCount: 5, triggerCount: 3, annualizedReturnPct: 10, winRatePct: 60, maxDrawdownPct: 5 },
    { threshold: 3, passed: true, tradeCount: 2, triggerCount: 1, annualizedReturnPct: 9, winRatePct: 80, maxDrawdownPct: 3 }
  ]);

  assert.equal(result.status, 'optimized');
  assert.equal(result.metric, 'annualizedReturnPct');
  assert.equal(result.item.threshold, 2.65);
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

test('recommendation leaves win rate empty when no switch was completed', () => {
  assert.equal(recommendationWinRate({ summary: { signalCount: 0, winRatePct: 0 } }), null);
  assert.equal(recommendationWinRate({ summary: { signalCount: 2, winRatePct: 50 } }), 50);
});

test('recommendation marks catalog QDII codes as cross-border backtest inputs', () => {
  assert.deepEqual(
    switchRecommendationCrossBorderCodes(['513100', '159501', '000001']),
    ['513100', '159501']
  );
});
