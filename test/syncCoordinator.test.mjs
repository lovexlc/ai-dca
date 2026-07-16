/* global EventTarget, Response, URL */

import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeCloudSync, syncNow } from '../src/app/syncCoordinator.js';
import { userDataStore } from '../src/app/userDataStore.js';

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
  localStorage.setItem('aiDcaFundHoldingsLedger', JSON.stringify({ transactions: [{ id: 'tx-1', code: '000001', shares: 1, price: 1 }] }));
  localStorage.setItem('aiDcaWorkspacePrefs', JSON.stringify({ theme: 'dark', marker: 'local' }));
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: parsed.pathname, body });
    if (parsed.pathname.endsWith('/v2/devices/register')) {
      return new Response(JSON.stringify({ device: { deviceId: body.deviceId, migrationStatus: 'completed', needsMigration: false } }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/secure-config') && init.method === 'GET') {
      return new Response(JSON.stringify({ key: parsed.searchParams.get('key'), encrypted: null }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/secure-config') && init.method === 'PUT') {
      return new Response(JSON.stringify({ ok: true, key: body.key }), { status: 200 });
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

test('migration acquires a writer with the explicit migration marker', async () => {
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
  const session = { userId: 'user-migration', username: 'migration', accessToken: 'access-token' };

  globalThis.window = windowLike;
  localStorage.setItem('aiDcaCloudSyncSession', JSON.stringify(session));
  localStorage.setItem('aiDcaWorkspacePrefs', JSON.stringify({ marker: 'migration-local' }));
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: parsed.pathname, body });
    if (parsed.pathname.endsWith('/v2/devices/register')) {
      return new Response(JSON.stringify({ device: { deviceId: body.deviceId, migrationStatus: 'pending', needsMigration: true } }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/secure-config') && init.method === 'GET') {
      return new Response(JSON.stringify({ key: parsed.searchParams.get('key'), encrypted: null }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/secure-config') && init.method === 'PUT') {
      return new Response(JSON.stringify({ ok: true, key: body.key }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/v2/devices/collecting')) {
      return new Response(JSON.stringify({ ok: true, migrationStatus: 'collecting' }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/v2/snapshot') && init.method === 'GET') {
      return new Response(JSON.stringify({ mode: 'legacy', revision, updatedAt: '', contentHash: encryptedEnvelope?.meta?.contentHash || '', encryptedEnvelope }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/v2/writer/acquire')) {
      assert.equal(body.migration, true);
      return new Response(JSON.stringify({ writerToken: 'migration-writer-token', deviceId: body.deviceId, sessionId: body.sessionId, expiresAt: new Date(Date.now() + 30000).toISOString(), revision, migration: true }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/v2/snapshot') && init.method === 'PUT') {
      encryptedEnvelope = body.encryptedEnvelope;
      revision += 1;
      return new Response(JSON.stringify({ revision, version: revision, updatedAt: new Date().toISOString(), keyCount: 1 }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/v2/devices/complete')) {
      return new Response(JSON.stringify({ ok: true, migrationStatus: 'completed' }), { status: 200 });
    }
    throw new Error('unexpected sync endpoint: ' + parsed.pathname + ' ' + init.method);
  };

  try {
    const result = await initializeCloudSync({ securityPassword: 'security-password-123' });
    assert.equal(result.migrated, true);
    assert.equal(result.uploaded, true);
    const acquireCall = calls.find((call) => call.path.endsWith('/v2/writer/acquire'));
    assert.equal(acquireCall.body.migration, true);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});

test('modern resource mode does not poll legacy secure-config keys', async () => {
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
  const session = { userId: 'user-modern-resources', username: 'modern', accessToken: 'access-token' };
  const calls = [];

  globalThis.window = windowLike;
  localStorage.setItem('aiDcaCloudSyncSession', JSON.stringify(session));
  userDataStore.mode = 'remote';
  userDataStore.userId = session.userId;
  userDataStore.session = session;
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push(parsed.pathname);
    assert.equal(parsed.pathname.endsWith('/secure-config'), false, 'modern resources must not use legacy secure-config');
    const body = init.body ? JSON.parse(init.body) : null;
    if (parsed.pathname.endsWith('/v2/devices/register')) {
      return new Response(JSON.stringify({ device: { deviceId: body.deviceId, migrationStatus: 'completed', needsMigration: false } }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/v2/snapshot') && init.method === 'GET') {
      return new Response(JSON.stringify({ mode: 'v2', revision: 0, encryptedEnvelope: null }), { status: 200 });
    }
    throw new Error('unexpected sync endpoint: ' + parsed.pathname + ' ' + init.method);
  };

  try {
    await initializeCloudSync();
    assert.deepEqual(calls, ['/api/sync/v2/devices/register', '/api/sync/v2/snapshot']);
  } finally {
    userDataStore.setAnonymous();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});
