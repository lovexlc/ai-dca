import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIST_HISTORY_CACHE_LIMIT,
  loadCachedListHistoryMetrics
} from '../src/pages/markets/listHistoryCacheLoader.js';

function makeCandles(count = LIST_HISTORY_CACHE_LIMIT) {
  const start = Math.floor(Date.UTC(2025, 0, 1, 7, 0) / 1000);
  return Array.from({ length: count }, (_item, index) => {
    const close = Number((1 + index * 0.001).toFixed(4));
    return {
      t: start + index * 86400,
      date: new Date((start + index * 86400) * 1000).toISOString().slice(0, 10),
      o: close,
      h: Number((close + 0.01).toFixed(4)),
      l: Number((close - 0.01).toFixed(4)),
      c: close,
    };
  });
}

test('list history loader reads only cached kline data for visible symbols', async () => {
  const requested = [];
  globalThis.fetch = async () => {
    throw new Error('list history loader must not fetch network kline data');
  };

  const metrics = await loadCachedListHistoryMetrics(['513100', '513100', '513500'], {
    readCachedKlineFn: async (args) => {
      requested.push(args);
      if (args.symbol === '513100') return { candles: makeCandles() };
      return null;
    },
  });

  assert.deepEqual(requested.map((item) => item.symbol), ['513100', '513500']);
  assert.equal(requested[0].timeframe, '1d');
  assert.equal(requested[0].minCandles, LIST_HISTORY_CACHE_LIMIT);
  assert.ok(metrics['513100']?.candles?.length);
  assert.equal(metrics['513500'], undefined);
});

test('list history loader skips symbols already hydrated in memory', async () => {
  const requested = [];
  const metrics = await loadCachedListHistoryMetrics(['513100', '513500'], {
    existingMap: { '513100': { candles: makeCandles() } },
    readCachedKlineFn: async (args) => {
      requested.push(args.symbol);
      return { candles: makeCandles() };
    },
  });

  assert.deepEqual(requested, ['513500']);
  assert.equal(metrics['513100'], undefined);
  assert.ok(metrics['513500']?.candles?.length);
});
