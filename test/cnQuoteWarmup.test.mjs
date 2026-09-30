import { test } from 'node:test';
import assert from 'node:assert/strict';

import { refreshCnEtfQuoteCache } from '../workers/markets/src/cnQuoteWarmup.js';

test('CN ETF quote warmup writes the same KV quote keys used by quotes API', async () => {
  const originalFetch = globalThis.fetch;
  const kvWrites = [];
  const kvStore = new Map([
    ['kline-high:cn:sh513500:1d', JSON.stringify({ high: 2.7, highDate: '2026-06-02', source: 'daily-kline-365d' })],
    ['kline-high:cn:sz159655:1d', JSON.stringify({ high: 2.0, highDate: '2026-06-02', source: 'daily-kline-365d' })],
    ['kline-close-high:cn:sh513500:1d', JSON.stringify({ high: 2.6, highDate: '2026-06-03', source: 'daily-close-kline-365d' })],
    ['kline-close-high:cn:sz159655:1d', JSON.stringify({ high: 1.95, highDate: '2026-06-03', source: 'daily-close-kline-365d' })],
  ]);

  globalThis.fetch = async (url, init = {}) => {
    const textUrl = String(url);
    if (textUrl.includes('qt.gtimg.cn')) return new Response('v_sh513500="51~ETF~513500~2.5~2.49~2.49";v_sz159655="51~ETF~159655~1.9~1.89~1.89";');
    if (textUrl.includes('push2delay.eastmoney.com')) return Response.json({ data: { diff: [] } });
    if (textUrl.includes('fundmobapi.eastmoney.com')) return Response.json({ Datas: [{ FCODE: '513500', NAV: '2.4', HQDATE: '2026-09-30' }, { FCODE: '159655', NAV: '1.8', HQDATE: '2026-09-30' }] });
    throw new Error('unexpected fetch ' + textUrl);
  };

  const env = {
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
  assert.deepEqual(kvKeys, ['quote:sh513500', 'quote:sz159655']);
  const kvPayload = kvWrites.find((item) => item.key === 'quote:sh513500').value;
  assert.equal(kvPayload.premiumPercent, 4.1667);
  assert.equal(kvPayload.highPoint.high, 2.7);
  assert.equal(kvPayload.closeHighPoint.high, 2.6);
  assert.equal(kvPayload.source, 'tencent-quote');
});
