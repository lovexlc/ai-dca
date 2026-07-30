import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchFundLimit, normalizeFundLimitEntries } from '../src/app/fundLimitApi.js';

test('fund-limit client normalizes response codes in one place', () => {
  assert.deepEqual(normalizeFundLimitEntries([
    { ok: true, code: 'sh000834', data: { code: '000834', buyStatus: 'limit_large' } },
    { ok: true, code: '270042', data: { buyStatus: 'open' } },
    { ok: false, code: '123456', data: { buyStatus: 'open' } },
  ]), {
    '000834': { code: '000834', buyStatus: 'limit_large' },
    '270042': { code: '270042', buyStatus: 'open' },
  });
});

test('fund-limit client uses GET for cache reads and POST only for explicit refresh', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ code: '000834', buyStatus: 'open' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const cached = await fetchFundLimit('sh000834');
    const refreshed = await fetchFundLimit('000834', { refresh: true });

    assert.equal(cached.code, '000834');
    assert.equal(refreshed.code, '000834');
    assert.equal(calls.length, 2);

    const getUrl = new URL(calls[0].url, 'https://example.test');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(getUrl.pathname, '/api/fund-limit');
    assert.equal(getUrl.searchParams.get('code'), '000834');

    assert.equal(calls[1].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[1].init.body), { code: '000834' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
