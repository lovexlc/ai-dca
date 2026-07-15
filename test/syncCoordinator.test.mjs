/* global EventTarget, Response, URL */

import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeCloudSync, syncNow } from '../src/app/syncCoordinator.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

test('coordinator uses v2, remembers the DEK, and pushes later without a password', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const windowLike = Object.assign(new EventTarget(), {
    localStorage,
    sessionStorage,
    navigator: { userAgent: 'node-test' },
    innerWidth: 1280
  });
  const calls = [];
  let revision = 0;
  let encryptedEnvelope = null;
  const session = { userId: 'user-coordinator', username: 'coordinator', accessToken: 'access-token' };

  globalThis.window = windowLike;
  localStorage.setItem('aiDcaCloudSyncSession', JSON.stringify(session));
  localStorage.setItem('aiDcaWorkspacePrefs', JSON.stringify({ theme: 'dark', marker: 'local' }));
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: parsed.pathname, body });
    if (parsed.pathname.endsWith('/v2/devices/register')) {
      return new Response(JSON.stringify({ device: { deviceId: body.deviceId, migrationStatus: 'completed', needsMigration: false } }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/v2/snapshot') && init.method === 'GET') {
      return new Response(JSON.stringify({ mode: encryptedEnvelope ? 'v2' : 'v2', revision, updatedAt: '', contentHash: encryptedEnvelope?.meta?.contentHash || '', encryptedEnvelope }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/v2/writer/acquire')) {
      return new Response(JSON.stringify({ writerToken: 'writer-token', deviceId: body.deviceId, sessionId: body.sessionId, expiresAt: new Date(Date.now() + 30000).toISOString(), revision }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/v2/snapshot') && init.method === 'PUT') {
      assert.equal(body.securityPassword, undefined);
      assert.equal(body.encryptedEnvelope.source, 'ai-dca-secure-sync');
      encryptedEnvelope = body.encryptedEnvelope;
      revision += 1;
      return new Response(JSON.stringify({ revision, version: revision, updatedAt: new Date().toISOString(), keyCount: 1 }), { status: 200 });
    }
    throw new Error('unexpected sync endpoint: ' + parsed.pathname + ' ' + init.method);
  };

  try {
    const first = await initializeCloudSync({ securityPassword: 'security-password-123' });
    assert.equal(first.uploaded, true);
    assert.ok(localStorage.getItem('aiDcaSecureSyncRememberedKey:user-coordinator'));
    assert.equal(calls.some((call) => call.path.endsWith('/latest')), false);

    const second = await syncNow({ securityPassword: '' });
    assert.equal(second.skipped, true);
    assert.equal(calls.filter((call) => call.path.endsWith('/v2/snapshot') && call.body).length, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});
