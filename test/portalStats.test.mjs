import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPortalStats, readPortalSnapshot } from '../src/pages/portal/portalStats.js';
import { buildPortalRankings } from '../src/pages/portal/portalMarketData.js';

test('buildPortalStats aggregates only local lightweight counts', () => {
  const stats = buildPortalStats({
    watchlist: {
      activeListId: 'list-a',
      lists: [
        { id: 'list-a', cn: ['513100', '513500'], us: [] },
        { id: 'list-b', cn: ['513100'], us: [] },
      ],
    },
    plans: [{ isConfigured: true }, { isConfigured: false }],
    dcaPlans: [{ isConfigured: true }],
    sellPlans: [{ isConfigured: true }],
    holdingCodes: ['513100', '513100', '159509'],
    signalCount: 3,
  });

  assert.deepEqual(stats.map(({ key, value }) => ({ key, value })), [
    { key: 'monitored', value: 2 },
    { key: 'watchlists', value: 2 },
    { key: 'strategies', value: 3 },
    { key: 'holdings', value: 2 },
    { key: 'signals', value: 3 },
  ]);
});

test('readPortalSnapshot isolates reader failures and normalizes holding codes', () => {
  const snapshot = readPortalSnapshot({
    watchlist: () => ({ lists: [], activeListId: '' }),
    plans: () => { throw new Error('unavailable'); },
    dcaPlans: () => [{ id: 'dca-1' }],
    sellPlans: () => [],
    ledger: () => ({ transactions: [{ code: '513100' }, { code: '513100' }, { code: '' }] }),
  });

  assert.deepEqual(snapshot.plans, []);
  assert.deepEqual(snapshot.dcaPlans, [{ id: 'dca-1' }]);
  assert.deepEqual(snapshot.holdingCodes, ['513100']);
});

test('portal drawdown ranking only uses cached high points for CN funds', () => {
  const rankings = buildPortalRankings({
    symbols: ['513100', '513500'],
    market: 'cn',
    quotes: {
      '513100': { symbol: '513100', price: 1, changePercent: 1, high52w: 2 },
      '513500': { symbol: '513500', price: 1.5, changePercent: -1, highPoint: { high: 2, source: 'kline-high' } },
    },
  });

  assert.deepEqual(rankings.drawdowns.map((row) => row.symbol), ['513500']);
  assert.deepEqual(rankings.movers.map((row) => row.symbol), ['513100', '513500']);
});
