import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarketsApiUrl,
  fetchMarketsJson,
  fetchMarketsResponse,
} from '../workers/shared/src/marketsServiceClient.js';

test('markets service client builds one public API path for shared callers', () => {
  const env = { PUBLIC_DATA_BASE_URL: 'https://test.example/' };
  assert.equal(buildMarketsApiUrl(env, '/quotes?symbols=513100'), 'https://test.example/api/markets/quotes?symbols=513100');
  assert.equal(buildMarketsApiUrl(env, '/api/markets/fund-metrics'), 'https://test.example/api/markets/fund-metrics');
});

test('markets service client prefers the internal service binding', async () => {
  let bindingCalls = 0;
  const env = {
    MARKETS: {
      async fetch(request) {
        bindingCalls += 1;
        assert.equal(new URL(request.url).pathname, '/api/markets/fund-metrics');
        assert.equal(request.headers.get('accept'), 'application/json');
        return new Response(JSON.stringify({ items: [{ code: '513100' }] }), { status: 200 });
      }
    }
  };

  const payload = await fetchMarketsJson(env, '/fund-metrics', { method: 'POST' });
  assert.equal(bindingCalls, 1);
  assert.deepEqual(payload.items, [{ code: '513100' }]);
});

test('markets service client falls back to the configured public origin', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (request) => {
    requestedUrl = String(request.url || request);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    const response = await fetchMarketsResponse({ PUBLIC_DATA_BASE_URL: 'https://test.example' }, '/quotes');
    assert.equal(response.ok, true);
    assert.equal(requestedUrl, 'https://test.example/api/markets/quotes');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('markets service client reports non-2xx responses consistently', async () => {
  const env = {
    MARKETS: {
      async fetch() {
        return new Response('unavailable', { status: 503 });
      }
    }
  };
  await assert.rejects(
    () => fetchMarketsJson(env, '/quotes'),
    /请求 .* 失败：状态 503/
  );
});
