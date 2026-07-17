import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __internals,
  fetchTabResource,
  fetchUserDataManifest,
  saveCloudDataCheck
} from '../src/app/authClient.js';
import { clearAccountDataScope, markAccountDataScopeReady } from '../src/app/accountDataScope.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}

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

test('completed device uses account scope for account data APIs while retaining device check identity', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage, sessionStorage: new MemoryStorage() };
  localStorage.setItem('aiDcaSyncClientId', 'device-a');
  const session = { userId: 'user-a', username: 'LoveXL', accessToken: 'access-token' };
  markAccountDataScopeReady(session, 'device-a', { completedAt: '2026-07-17T00:00:00.000Z' });
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: new URL(url), init });
    return new Response(JSON.stringify({ ok: true, resources: [], data: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    await fetchUserDataManifest(session, 'device-a');
    await fetchTabResource('trade-plans', 'plan-state', session);
    await saveCloudDataCheck({ deviceId: 'device-a', status: 'completed' }, session);
    assert.equal(calls[0].url.searchParams.get('accountUsername'), 'lovexl');
    assert.equal(calls[0].url.searchParams.has('deviceId'), false);
    assert.equal(calls[1].url.searchParams.get('accountUsername'), 'lovexl');
    assert.equal(calls[1].url.searchParams.has('deviceId'), false);
    const checkBody = JSON.parse(calls[2].init.body);
    assert.equal(checkBody.accountUsername, 'lovexl');
    assert.equal(checkBody.deviceId, 'device-a');
  } finally {
    clearAccountDataScope(session, 'device-a');
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});
