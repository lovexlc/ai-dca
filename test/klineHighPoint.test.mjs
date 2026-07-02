import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attachKlineHighPoint, deriveKlineHighPoint, pickHigherHighPoint } from '../workers/markets/src/klineHighPoint.js';
import { resolveKlineHighPointCache } from '../workers/markets/src/klineHighPointCache.js';

test('kline high point derives 365-day high from daily candles', () => {
  const candles = [
    { t: Date.parse('2025-06-01T15:00:00+08:00') / 1000, h: 5.464, c: 5.1 },
    { t: Date.parse('2026-06-03T15:00:00+08:00') / 1000, h: 2.577, c: 2.299 },
    { t: Date.parse('2026-07-02T15:00:00+08:00') / 1000, h: 2.196, c: 2.158 }
  ];

  const highPoint = deriveKlineHighPoint(candles, { daysBack: 365 });

  assert.equal(highPoint.high, 2.577);
  assert.equal(highPoint.highDate, '2026-06-03');
  assert.equal(highPoint.count, 2);
});

test('kline high point keeps cached high when short candles are lower', () => {
  const payload = attachKlineHighPoint({
    interval: '1d',
    highPoint: { high: 2.577, highDate: '2026-06-03', source: 'daily-kline-365d' },
    candles: [
      { t: Date.parse('2026-07-01T15:00:00+08:00') / 1000, h: 2.232, c: 2.209 },
      { t: Date.parse('2026-07-02T15:00:00+08:00') / 1000, h: 2.196, c: 2.158 }
    ]
  });

  assert.equal(payload.highPoint.high, 2.577);
  assert.equal(payload.highPoint.highDate, '2026-06-03');
});

test('kline high point can advance from a newer short candle', () => {
  const next = pickHigherHighPoint(
    { high: 2.577, highDate: '2026-06-03', source: 'daily-kline-365d' },
    { high: 2.6, highDate: '2026-07-03', source: 'daily-kline-1d' }
  );

  assert.equal(next.high, 2.6);
  assert.equal(next.highDate, '2026-07-03');
});

test('kline high point does not rescan candles when cached high exists unless forced', () => {
  const payload = {
    interval: '1d',
    highPoint: { high: 2.577, highDate: '2026-06-03', source: 'daily-kline-365d' },
    candles: [
      { t: Date.parse('2026-07-03T15:00:00+08:00') / 1000, h: 2.6, c: 2.59 }
    ]
  };

  assert.equal(attachKlineHighPoint(payload).highPoint.high, 2.577);
  assert.equal(attachKlineHighPoint(payload, { forceDerive: true }).highPoint.high, 2.6);
});

test('kline high point cache does not hydrate R2 unless requested', async () => {
  const store = new Map();
  let r2Reads = 0;
  const env = {
    MARKETS_KV: {
      async get(key) { return store.get(key) || null; },
      async put(key, value) { store.set(key, value); }
    },
    MARKETS_R2: {
      async get() {
        r2Reads += 1;
        return {
          text: async () => JSON.stringify({
            interval: '1d',
            candles: [
              { t: Date.parse('2026-06-03T15:00:00+08:00') / 1000, h: 2.577 },
              { t: Date.parse('2026-07-02T15:00:00+08:00') / 1000, h: 2.196 }
            ]
          })
        };
      },
      async put() {}
    }
  };

  assert.equal(await resolveKlineHighPointCache(env, { market: 'cn', symbol: 'sh513100' }), null);
  assert.equal(r2Reads, 0);
  assert.equal((await resolveKlineHighPointCache(env, { market: 'cn', symbol: 'sh513100', hydrateFromR2: true })).high, 2.577);
  assert.equal(r2Reads, 1);
  assert.equal((await resolveKlineHighPointCache(env, { market: 'cn', symbol: 'sh513100' })).high, 2.577);
  assert.equal(r2Reads, 1);
});
