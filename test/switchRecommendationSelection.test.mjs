import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectRecommendedThreshold } from '../workers/notify/src/switchRecommendation.js';

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
