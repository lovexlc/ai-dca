import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadWatchQuotesWithEnhancements } from '../src/pages/markets/marketsWatchData.js';
import { buildOtcFundQuoteFromSnapshot } from '../src/pages/markets/marketsCatalog.js';

test('watch quotes do not fetch OTC nav snapshots when quote is usable', async () => {
  let navSnapshotCalls = 0;
  let fundFeeCalls = 0;
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
    fetchFundFees: async () => {
      fundFeeCalls += 1;
      return { items: [] };
    },
    buildOtcFundQuoteFromSnapshot,
    hasNasdaqOtcFund: (code) => code === '006479'
  });

  assert.equal(navSnapshotCalls, 0);
  assert.equal(fundFeeCalls, 0);
  assert.equal(result.quotes['006479'].price, 2.1);
});

test('watch quotes fetch fund fees only when fee columns are requested', async () => {
  let fundFeeCalls = 0;
  const result = await loadWatchQuotesWithEnhancements({
    symbols: ['006479'],
    market: 'cn',
    fetchQuotes: async () => ({ quotes: { '006479': { symbol: '006479', code: '006479', price: 2.1 } } }),
    getNavSnapshots: async () => ({ items: [] }),
    fetchFundFees: async (codes) => {
      fundFeeCalls += 1;
      assert.deepEqual(codes, ['006479']);
      return { items: [{ ok: true, data: { code: '006479', annualFeeRate: 0.6 } }] };
    },
    buildOtcFundQuoteFromSnapshot,
    hasNasdaqOtcFund: (code) => code === '006479',
    includeFundFees: true,
  });

  assert.equal(fundFeeCalls, 1);
  assert.equal(result.fundFees['006479'].annualFeeRate, 0.6);
});

test('watch quotes fetch xueqiu worker quotes for visible premium column when direct quote misses premium', async () => {
  let navSnapshotCalls = 0;
  let premiumQuoteCalls = 0;
  const result = await loadWatchQuotesWithEnhancements({
    symbols: ['513100'],
    market: 'cn',
    fetchQuotes: async () => ({
      quotes: {
        '513100': {
          symbol: '513100',
          code: '513100',
          price: 1.234,
          source: 'tencent'
        }
      }
    }),
    getNavSnapshots: async () => {
      navSnapshotCalls += 1;
      return { items: [] };
    },
    fetchPremiumQuotes: async (codes) => {
      premiumQuoteCalls += 1;
      assert.deepEqual(codes, ['513100']);
      return {
        quotes: {
          '513100': {
            symbol: 'sh513100',
            code: '513100',
            latestNav: 1.2,
            previousNav: 1.19,
            latestNavDate: '2026-07-06',
            premiumPercent: 2.8333,
            source: 'xueqiu-quote'
          }
        }
      };
    },
    fetchFundFees: async () => ({ items: [] }),
    buildOtcFundQuoteFromSnapshot,
    hasNasdaqOtcFund: () => false,
    includePremiumSnapshots: true,
  });

  assert.equal(navSnapshotCalls, 0);
  assert.equal(premiumQuoteCalls, 1);
  assert.equal(result.quotes['513100'].premiumPercent, 2.8333);
  assert.equal(result.quotes['513100'].latestNav, 1.2);
  assert.equal(result.quotes['513100'].source, 'xueqiu-quote');
});

test('watch quotes emit base quotes before premium enhancement settles', async () => {
  let baseResult = null;
  let resolvePremium;
  const pendingPremium = new Promise((resolve) => { resolvePremium = resolve; });
  const resultPromise = loadWatchQuotesWithEnhancements({
    symbols: ['513100'],
    market: 'cn',
    fetchQuotes: async () => ({
      quotes: {
        '513100': { symbol: '513100', code: '513100', price: 1.234, source: 'tencent' }
      }
    }),
    getNavSnapshots: async () => ({ items: [] }),
    fetchPremiumQuotes: async () => pendingPremium,
    fetchFundFees: async () => ({ items: [] }),
    buildOtcFundQuoteFromSnapshot,
    hasNasdaqOtcFund: () => false,
    includePremiumSnapshots: true,
    onBaseResult: (result) => { baseResult = result; },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(baseResult?.quotes?.['513100']?.price, 1.234);
  assert.equal(baseResult?.quotes?.['513100']?.premiumPercent, undefined);

  resolvePremium({ quotes: { '513100': { code: '513100', premiumPercent: 2.5, source: 'xueqiu-quote' } } });
  const result = await resultPromise;
  assert.equal(result.quotes['513100'].price, 1.234);
  assert.equal(result.quotes['513100'].premiumPercent, 2.5);
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
