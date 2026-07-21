import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addYtdRanks,
  calculateCandidateTradeMetrics,
  candidateYtdReturn,
  candidateSuggestion,
  formatTurnover
} from '../src/components/fund-switch/candidateFundMetrics.js';

test('missing YTD return stays missing instead of becoming zero', () => {
  assert.equal(candidateYtdReturn({ ytdReturn: null }), null);
  assert.equal(candidateYtdReturn({ ytdReturnPct: undefined, ytdReturn: 0 }), 0);
});

test('candidate trade metrics use holding amount, commission rates and ETF lots', () => {
  const result = calculateCandidateTradeMetrics({
    candidate: { price: 1 },
    feeConfig: {
      mode: 'detailed',
      sellCommissionRate: 0.03,
      buyCommissionRate: 0.03,
      minimumCommission: 0,
      otherFee: 0
    },
    holdingQuantity: 22300,
    holdingNotional: 20000
  });

  assert.equal(result.sellShares, 22300);
  assert.equal(result.sellLots, 223);
  assert.equal(result.buyShares, 19900);
  assert.equal(result.buyLots, 199);
  assert.equal(result.fee, 11.97);
  assert.deepEqual(result.feeBreakdown, { sell: 6, buy: 5.97, other: 0 });
});

test('ytd rank is calculated within the candidate pool', () => {
  const ranked = addYtdRanks([
    { code: 'A', ytdReturnPct: 4.2 },
    { code: 'B', ytdReturnPct: 9.1 },
    { code: 'C', ytdReturnPct: null }
  ]);
  assert.equal(ranked[0].ytdRank, 2);
  assert.equal(ranked[1].ytdRank, 1);
  assert.equal(ranked[2].ytdRank, null);
  assert.equal(ranked[0].ytdRankTotal, 2);
});

test('candidate list exposes readable turnover and decision advice', () => {
  assert.equal(formatTurnover(325000000), '¥3.25亿');
  assert.equal(candidateSuggestion({ status: 'better' }), '建议：可切换，当前优势已达到提醒条件');
  assert.equal(candidateSuggestion({ status: 'near' }, { distancePct: 0.34 }), '建议：继续观察，还差 0.34%');
});
