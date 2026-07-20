import { test } from 'node:test';
import assert from 'node:assert/strict';

/* global Response, URLSearchParams */

import { fetchCnKlineWithFallback } from '../workers/markets/src/marketRuntime.js';
import { handleKline } from '../workers/markets/src/fundMetricsRoutes.js';

function sinaRows() {
  return [
    { day: '2026-07-16', open: '1.10', high: '1.15', low: '1.08', close: '1.13', volume: '1200' },
    { day: '2026-07-17', open: '1.13', high: '1.18', low: '1.12', close: '1.17', volume: '1500' }
  ];
}

function mockKlineSources({ cached = null } = {}) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const r2 = {
    async get(key) {
      assert.equal(key, 'kline/cn/sh513390/1d.json');
      if (!cached) return null;
      return { async text() { return JSON.stringify(cached); } };
    },
    async put() {}
  };
  globalThis.fetch = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.includes('stock.xueqiu.com')) {
      return new Response(JSON.stringify({
        error_code: 400016,
        error_description: '遇到错误，请刷新页面或者重新登录帐号后再试'
      }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    if (value.includes('quotes.sina.cn')) {
      return new Response(JSON.stringify(sinaRows()), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch: ${value}`);
  };
  return { calls, r2, restore() { globalThis.fetch = originalFetch; } };
}

test('CN kline falls back to Sina when Xueqiu returns the session error', async () => {
  const mocked = mockKlineSources();
  try {
    const payload = await fetchCnKlineWithFallback(
      { XUEQIU_COOKIE: 'xq_a_token=test' },
      '513390',
      '1d',
      { limit: 1000 }
    );

    assert.equal(payload.source, 'sina-kline');
    assert.equal(payload.fallback, 'sina');
    assert.equal(payload.market, 'cn');
    assert.match(payload.primaryError, /400016/);
    assert.deepEqual(payload.candles.map((candle) => candle.c), [1.13, 1.17]);
    assert.match(mocked.calls[0], /symbol=SH513390/);
    assert.match(mocked.calls[0], /count=-1000/);
    assert.match(mocked.calls[1], /symbol=sh513390/);
    assert.match(mocked.calls[1], /datalen=1000/);
  } finally {
    mocked.restore();
  }
});

test('CN kline limit=1000 reads a valid Sina fallback payload from R2', async () => {
  const lastTimestamp = Math.floor(Date.now() / 1000);
  const mocked = mockKlineSources({
    cached: {
      symbol: 'sh513390',
      interval: '1d',
      market: 'cn',
      source: 'sina-kline',
      generatedAt: new Date().toISOString(),
      candles: [{ t: lastTimestamp, o: 1, h: 1.1, l: 0.9, c: 1.05, v: 10 }]
    }
  });
  try {
    const response = await handleKline(
      { MARKETS_R2: mocked.r2, XUEQIU_COOKIE: 'xq_a_token=test' },
      '513390',
      new URLSearchParams('tf=1d&limit=1000')
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.cached, true);
    assert.equal(payload.source, 'r2-cache');
    assert.equal(payload.candles.length, 1);
    assert.equal(mocked.calls.length, 0);
  } finally {
    mocked.restore();
  }
});

test('CN kline rejects an untrusted R2 source and refreshes through the approved fallback', async () => {
  const mocked = mockKlineSources({
    cached: {
      symbol: 'sh513390',
      interval: '1d',
      market: 'cn',
      source: 'eastmoney-kline',
      generatedAt: new Date().toISOString(),
      candles: [{ t: Math.floor(Date.now() / 1000), o: 1, h: 1.1, l: 0.9, c: 1.05, v: 10 }]
    }
  });
  try {
    const response = await handleKline(
      { MARKETS_R2: mocked.r2, XUEQIU_COOKIE: 'xq_a_token=test' },
      '513390',
      new URLSearchParams('tf=1d&limit=1000')
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.cached, false);
    assert.equal(payload.source, 'realtime');
    assert.equal(payload.fallback, 'sina');
    assert.equal(mocked.calls.length, 2);
  } finally {
    mocked.restore();
  }
});
