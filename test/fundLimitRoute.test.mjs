import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleFundLimit } from '../workers/ocr-proxy/src/fundRoutes.js';

function kv(value) {
  return { get: async () => value, put: async () => {} };
}

test('fund limit GET reads KV only and returns cache miss without upstream fetch', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('upstream must not be called'); };
  try {
    const hit = await handleFundLimit(new Request('https://example.test/api/fund-limit?code=000834'), { FUND_LIMIT_KV: kv({ code: '000834', buyStatus: 'limit_large' }) }, {}, new URLSearchParams('code=000834'));
    assert.equal(hit.status, 200);
    assert.equal((await hit.json()).buyStatus, 'limit_large');
    const miss = await handleFundLimit(new Request('https://example.test/api/fund-limit?code=270042'), { FUND_LIMIT_KV: kv(null) }, {}, new URLSearchParams('code=270042'));
    assert.equal(miss.status, 404);
    assert.equal((await miss.json()).error, '基金限额缓存未命中。');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fund limit POST rejects multi-code payloads', async () => {
  const response = await handleFundLimit(new Request('https://example.test/api/fund-limit', { method: 'POST', body: JSON.stringify({ codes: ['000834', '270042'] }) }), { FUND_LIMIT_KV: kv(null) }, {});
  assert.equal(response.status, 400);
});
