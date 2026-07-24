import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CACHE_STATUS,
  createCacheEnvelope,
  resolveCacheStatus
} from '../workers/markets/src/cachePolicy.js';

function envelopeAt(now, validMs = 1000, staleMs = 5000) {
  return createCacheEnvelope({
    key: 'quote:513100',
    market: 'cn',
    source: 'xueqiu-quote',
    fetchedAt: new Date(now),
    asOf: new Date(now),
    validUntil: new Date(now + validMs),
    staleUntil: new Date(now + staleMs),
    payload: { code: '513100', price: 1.2, source: 'xueqiu-quote' }
  });
}

test('cache freshness has explicit fresh/stale/miss boundaries', () => {
  const now = Date.parse('2026-07-23T00:00:00.000Z');
  const envelope = envelopeAt(now);
  const options = { key: envelope.key, source: 'xueqiu-quote', payloadValidator: (value) => value.price > 0 };
  assert.equal(resolveCacheStatus(envelope, { ...options, now }), CACHE_STATUS.FRESH);
  assert.equal(resolveCacheStatus(envelope, { ...options, now: now + 1001 }), CACHE_STATUS.STALE);
  assert.equal(resolveCacheStatus(envelope, { ...options, now: now + 5001 }), CACHE_STATUS.MISS);
  assert.equal(resolveCacheStatus(envelope, { ...options, now, delayed: true }), CACHE_STATUS.DELAYED);
});

test('cache envelope rejects key, source and payload shape mismatches', () => {
  const now = Date.parse('2026-07-23T00:00:00.000Z');
  const envelope = envelopeAt(now);
  const options = { key: envelope.key, source: 'xueqiu-quote', payloadValidator: (value) => value.price > 0 };
  assert.equal(resolveCacheStatus({ ...envelope, key: 'quote:other' }, { ...options, now }), CACHE_STATUS.MISS);
  assert.equal(resolveCacheStatus({ ...envelope, source: 'unknown' }, { ...options, now }), CACHE_STATUS.MISS);
  assert.equal(resolveCacheStatus({ ...envelope, payload: { code: '513100' } }, { ...options, now }), CACHE_STATUS.MISS);
  assert.equal(resolveCacheStatus({ ...envelope, version: 1 }, { ...options, now }), CACHE_STATUS.MISS);
});
