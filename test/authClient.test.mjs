import assert from 'node:assert/strict';
import test from 'node:test';

import { __internals } from '../src/app/authClient.js';

test('auth password hashing falls back when crypto.subtle.digest is unavailable', async () => {
  const expected = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

  assert.equal(__internals.sha256HexFallback('hello'), expected);
  assert.equal(await __internals.sha256Hex('hello', {}), expected);
});

test('auth password hash normalizes username before hashing', async () => {
  const upper = await __internals.passwordHash(' Alice ', 'password-123');
  const lower = await __internals.sha256Hex('alice:password-123', {});

  assert.equal(upper, lower);
});

test('same GET sync request aborts the previous in-flight request', async () => {
  const previousFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (_url, init = {}) => {
    callCount += 1;
    if (callCount === 1) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
  };

  try {
    const first = __internals.requestSync('/same-resource', { method: 'GET' });
    const second = __internals.requestSync('/same-resource', { method: 'GET' });
    await assert.rejects(first, (error) => error?.name === 'AbortError');
    await assert.doesNotReject(second);
    assert.equal(callCount, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
