import { test } from 'node:test';
import assert from 'node:assert/strict';

import { __internals } from '../src/app/marketHistoryCache.js';

test('market history cache preserves intraday candles sharing one date', () => {
  const candles = __internals.normalizeCandles([
    { t: 1783401900, c: 2.1 },
    { t: 1783402200, c: 2.2 },
    { t: 1783402200, c: 2.25 },
  ]);

  assert.equal(candles.length, 2);
  assert.deepEqual(candles.map((item) => item.t), [1783401900, 1783402200]);
  assert.equal(candles.at(-1).c, 2.25);
});

test('intraday cache keys are recognized across session suffixes', () => {
  assert.equal(__internals.isIntradayTimeframe('5m'), true);
  assert.equal(__internals.isIntradayTimeframe('5m|session=all'), true);
  assert.equal(__internals.isIntradayTimeframe('1d'), false);
});
