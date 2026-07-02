import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadWatchQuotesWithEnhancements } from '../src/pages/markets/marketsWatchData.js';
import { buildOtcFundQuoteFromSnapshot } from '../src/pages/markets/marketsCatalog.js';

test('watch quotes do not fetch OTC nav snapshots when quote is usable', async () => {
  let navSnapshotCalls = 0;
  const result = await loadWatchQuotesWithEnhancements({
    symbols: ['006479'],
    market: 'cn',
    fetchQuotes: async () => ({
      quotes: {
        '006479': {
          symbol: '006479',
          code: '006479',
          price: 2.1,
          latestNav: 2.1,
          source: 'danjuan'
        }
      }
    }),
    getNavSnapshots: async () => {
      navSnapshotCalls += 1;
      return { items: [] };
    },
    fetchFundFees: async () => ({ items: [] }),
    buildOtcFundQuoteFromSnapshot,
    hasNasdaqOtcFund: (code) => code === '006479'
  });

  assert.equal(navSnapshotCalls, 0);
  assert.equal(result.quotes['006479'].price, 2.1);
});

test('watch quotes fetch OTC nav snapshots only as quote fallback', async () => {
  let navSnapshotCalls = 0;
  const result = await loadWatchQuotesWithEnhancements({
    symbols: ['006479'],
    market: 'cn',
    fetchQuotes: async () => ({ quotes: {} }),
    getNavSnapshots: async (codes) => {
      navSnapshotCalls += 1;
      assert.deepEqual(codes, ['006479']);
      return {
        items: [{
          code: '006479',
          name: '广发纳斯达克100ETF联接',
          latestNav: 1.23,
          previousNav: 1.2,
          latestNavDate: '2026-07-01',
          updatedAt: '2026-07-02T00:00:00.000Z'
        }]
      };
    },
    fetchFundFees: async () => ({ items: [] }),
    buildOtcFundQuoteFromSnapshot,
    hasNasdaqOtcFund: (code) => code === '006479'
  });

  assert.equal(navSnapshotCalls, 1);
  assert.equal(result.quotes['006479'].price, 1.23);
  assert.equal(result.quotes['006479'].source, 'otc-fund-nav-fallback');
});
