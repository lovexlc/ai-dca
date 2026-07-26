import { test } from 'node:test';
import assert from 'node:assert/strict';

import { refreshCnEtfQuoteCache } from '../workers/markets/src/cnQuoteWarmup.js';
import { createCacheEnvelope } from '../workers/markets/src/cachePolicy.js';
import { klineMetaCacheKey } from '../workers/markets/src/klineMetaCache.js';

function quotePayload(symbol, code, current) {
  return {
    data: {
      quote: {
        symbol,
        code,
        name: code + ' ETF',
        current,
        last_close: current - 0.01,
        unit_nav: current - 0.08,
        premium_rate: 3.5,
        timestamp: Date.UTC(2026, 6, 7, 3, 0, 0)
      }
    }
  };
}

test('CN ETF quote warmup writes the same KV quote keys used by quotes API', async () => {
  const originalFetch = globalThis.fetch;
  const kvWrites = [];
  const metaEnvelope = (symbol, high, highDate, closeHigh, closeHighDate) => createCacheEnvelope({
    key: klineMetaCacheKey('cn', symbol, '1d'),
    market: 'cn',
    source: 'kline-batch',
    fetchedAt: new Date(),
    asOf: '2026-07-06',
    validUntil: new Date(Date.now() + 24 * 3600 * 1000),
    staleUntil: new Date(Date.now() + 8 * 24 * 3600 * 1000),
    payload: {
      market: 'cn',
      symbol,
      interval: '1d',
      highPoint: { high, highDate, source: 'daily-kline-365d' },
      closeHighPoint: { high: closeHigh, highDate: closeHighDate, source: 'daily-close-kline-365d' },
      latestBarDate: '2026-07-06',
      generatedAt: new Date().toISOString(),
      source: 'kline-batch'
    }
  });
  const kvStore = new Map([
    [klineMetaCacheKey('cn', 'sh513500', '1d'), JSON.stringify(metaEnvelope('sh513500', 2.7, '2026-06-02', 2.6, '2026-06-03'))],
    [klineMetaCacheKey('cn', 'sz159655', '1d'), JSON.stringify(metaEnvelope('sz159655', 2.0, '2026-06-02', 1.95, '2026-06-03'))]
  ]);

  globalThis.fetch = async (url, init = {}) => {
    const textUrl = String(url);
    if (textUrl.includes('SH513500')) {
      return new Response(JSON.stringify(quotePayload('SH513500', '513500', 2.5)), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (textUrl.includes('SZ159655')) {
      return new Response(JSON.stringify(quotePayload('SZ159655', '159655', 1.9)), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error('unexpected fetch ' + textUrl);
  };

  const env = {
    XUEQIU_COOKIE: 'xq_a_token=test',
    MARKETS_KV: {
      async get(key) { return kvStore.get(key) || null; },
      async put(key, value, opts) {
        kvWrites.push({ key, value: JSON.parse(value), opts });
        kvStore.set(key, value);
      }
    }
  };

  try {
    const result = await refreshCnEtfQuoteCache(env, { symbols: ['513500', '159655'] });
    assert.equal(result.successCount, 2);
    assert.equal(result.failureCount, 0);
    assert.equal(result.kvEntries, 2);
    assert.equal(result.kvOk, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const kvKeys = kvWrites.map((item) => item.key).sort();
  assert.deepEqual(kvKeys, ['quote:159655', 'quote:513500']);
  const kvPayload = kvWrites.find((item) => item.key === 'quote:513500').value.payload;
  assert.equal(kvPayload.premiumPercent, 3.5);
  assert.equal(kvPayload.highPoint.high, 2.7);
  assert.equal(kvPayload.closeHighPoint.high, 2.6);
  assert.equal(kvPayload.source, 'xueqiu-quote');
});
