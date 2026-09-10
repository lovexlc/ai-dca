import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithGetRetry } from '../src/app/apiTransport.js';

test('retries a transient GET fetch failure once', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('Failed to fetch');
    return new Response('{}', { status: 200 });
  };
  try {
    const response = await fetchWithGetRetry('https://example.test', {}, { retryDelayMs: 0 });
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not retry POST mutations', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new TypeError('Failed to fetch');
  };
  try {
    await assert.rejects(() => fetchWithGetRetry('https://example.test', { method: 'POST' }, { retryDelayMs: 0 }));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not retry an intentional abort', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async () => {
    calls += 1;
    throw new DOMException('Aborted', 'AbortError');
  };
  try {
    await assert.rejects(() => fetchWithGetRetry('https://example.test', { signal: controller.signal }, { retryDelayMs: 0 }));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
