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

test('browser K-line cache expiration requires Worker revalidation', () => {
  const now = Date.parse('2026-07-23T00:00:00.000Z');
  const record = {
    schemaVersion: __internals.CACHE_SCHEMA_VERSION,
    source: 'r2-batch',
    validUntil: new Date(now + 1000).toISOString(),
    staleUntil: new Date(now + 5000).toISOString(),
    candles: [{ date: '2026-07-22', c: 1 }]
  };
  assert.equal(__internals.resolveLocalCacheStatus(record, { now }), 'fresh');
  assert.equal(__internals.resolveLocalCacheStatus(record, { now: now + 1001 }), 'miss');
  assert.equal(__internals.resolveLocalCacheStatus(record, { now: now + 1001, allowStale: true }), 'stale');
  assert.equal(__internals.resolveLocalCacheStatus(record, { now: now + 5001, allowStale: true }), 'miss');
  assert.equal(__internals.resolveLocalCacheStatus({ ...record, schemaVersion: 2 }, { now, allowStale: true }), 'stale');
});

test('browser K-line cache rejects an untrusted source', () => {
  const now = Date.parse('2026-07-23T00:00:00.000Z');
  assert.equal(__internals.resolveLocalCacheStatus({
    schemaVersion: __internals.CACHE_SCHEMA_VERSION,
    source: 'eastmoney-direct',
    validUntil: new Date(now + 1000).toISOString(),
    staleUntil: new Date(now + 5000).toISOString(),
    candles: [{ date: '2026-07-22', c: 1 }]
  }, { now }), 'miss');
});
