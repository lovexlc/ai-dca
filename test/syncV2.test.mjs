import assert from 'node:assert/strict';
import test from 'node:test';

import { encryptSyncItem } from '../src/app/secureVault.js';
import { saveCloudSession } from '../src/app/authSession.js';
import {
  clearV2SyncSession,
  collectV2BackupPayload,
  getV2SyncSessionStatus,
  prepareCloudSyncConflict,
  syncV2Now
} from '../src/app/syncV2/syncEngine.js';

class FakeStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

function installBrowser() {
  const localStorage = new FakeStorage();
  const listeners = new Map();
  const Storage = FakeStorage;
  globalThis.window = {
    localStorage,
    Storage,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener(type, listener) {
      const list = listeners.get(type) || [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter((item) => item !== listener));
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    }
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  };
  return localStorage;
}

function installSession() {
  saveCloudSession({ userId: 'usr_v2', username: 'v2-user', accessToken: 'token-v2' });
}

function createRemoteFetch() {
  const rows = new Map();
  const requests = [];
  function response(payload, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() { return JSON.stringify(payload); }
    };
  }
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, init });
    if (parsed.pathname.endsWith('/v2/items/meta')) {
      return response({ schemaVersion: 2, items: [...rows.values()].map(({ encryptedPayload, ...item }) => item) });
    }
    if (parsed.pathname.endsWith('/v2/items') && init.method === 'GET') {
      const keys = String(parsed.searchParams.get('keys') || '').split(',').filter(Boolean).map(decodeURIComponent);
      const items = [...rows.values()].filter((item) => !keys.length || keys.includes(item.syncKey));
      return response({ schemaVersion: 2, items });
    }
    const match = parsed.pathname.match(/\/v2\/items\/([^/]+)$/);
    if (match && init.method === 'PUT') {
      const key = decodeURIComponent(match[1]);
      const body = JSON.parse(init.body || '{}');
      const current = rows.get(key);
      if (current && Number(body.baseRevision) !== current.revision) return response({ item: current, code: 'SYNC_V2_REVISION_MISMATCH' }, 409);
      if (!current && Number(body.baseRevision) !== 0) return response({ item: null, code: 'SYNC_V2_REVISION_MISMATCH' }, 409);
      const item = {
        syncKey: key,
        revision: current ? current.revision + 1 : 1,
        contentHash: body.contentHash,
        cipherSha256: 'test-cipher-hash',
        encryptedPayload: body.encryptedPayload,
        updatedAt: new Date().toISOString(),
        clientUpdatedAt: body.clientUpdatedAt || '',
        deletedAt: body.deletedAt || ''
      };
      rows.set(key, item);
      return response({ ok: true, item });
    }
    return response({ message: 'not found' }, 404);
  };
  return { rows, requests };
}

test('V2 sync uses independent revisions and keeps device notification data out', async () => {
  const localStorage = installBrowser();
  installSession();
  const remote = createRemoteFetch();
  localStorage.setItem('aiDcaPlanStore', JSON.stringify({ plans: [{ id: 'plan-a', updatedAt: '2026-01-01' }] }));
  localStorage.setItem('aiDcaSwitchStrategyPrefs', JSON.stringify({ enabled: true }));
  localStorage.setItem('aiDcaNotifyClientConfig', JSON.stringify({ clientId: 'notify-device-secret' }));

  const first = await syncV2Now({ securityPassword: 'security-password-123', rememberDevice: false });
  assert.equal(first.uploaded, 2);
  assert.equal(remote.rows.get('aiDcaPlanStore').revision, 1);
  assert.equal(remote.rows.get('aiDcaSwitchStrategyPrefs').revision, 1);
  assert.equal(remote.rows.has('aiDcaNotifyClientConfig'), false);
  assert.equal(collectV2BackupPayload().keys.includes('aiDcaNotifyClientConfig'), false);
  assert.ok(remote.requests.every(({ init }) => !String(init.body || '').includes('notify-device-secret')));

  localStorage.setItem('aiDcaPlanStore', JSON.stringify({ plans: [{ id: 'plan-a', updatedAt: '2026-01-01' }, { id: 'plan-local', updatedAt: '2026-01-02' }] }));
  localStorage.setItem('aiDcaSwitchStrategyPrefs', JSON.stringify({ enabled: false }));
  const second = await syncV2Now({ rememberDevice: false });
  assert.equal(second.uploaded, 2);
  assert.equal(remote.rows.get('aiDcaPlanStore').revision, 2);
  assert.equal(remote.rows.get('aiDcaSwitchStrategyPrefs').revision, 2);
  assert.equal(getV2SyncSessionStatus().unlocked, true, 'same login session reuses the in-memory key');
});

test('V2 same-key CAS race merges structured values, while another key remains independent', async () => {
  const localStorage = installBrowser();
  installSession();
  const remote = createRemoteFetch();
  const initial = JSON.stringify({ plans: [{ id: 'base', updatedAt: '2026-01-01' }] });
  localStorage.setItem('aiDcaPlanStore', initial);
  await syncV2Now({ securityPassword: 'security-password-123', rememberDevice: false });

  // Simulate another device committing a different plan against revision 1.
  const remoteEnvelope = {
    version: 1,
    source: 'ai-dca-sync-v2-item',
    keyCount: 1,
    keys: ['aiDcaPlanStore'],
    payload: { aiDcaPlanStore: JSON.stringify({ plans: [{ id: 'base', updatedAt: '2026-01-01' }, { id: 'plan-remote', updatedAt: '2026-01-03' }] }) }
  };
  const encrypted = await encryptSyncItem(remoteEnvelope, 'security-password-123', { rememberDevice: true });
  encrypted.source = 'ai-dca-secure-sync-v2';
  const remoteRow = remote.rows.get('aiDcaPlanStore');
  remote.rows.set('aiDcaPlanStore', {
    ...remoteRow,
    revision: 2,
    contentHash: encrypted.meta.contentHash,
    encryptedPayload: { version: encrypted.version, source: encrypted.source, crypto: encrypted.crypto, meta: encrypted.meta, ciphertext: encrypted.ciphertext }
  });

  localStorage.setItem('aiDcaPlanStore', JSON.stringify({ plans: [{ id: 'base', updatedAt: '2026-01-01' }, { id: 'plan-local', updatedAt: '2026-01-02' }] }));
  const result = await syncV2Now({ rememberDevice: false });
  assert.ok(result.mergedKeys.includes('aiDcaPlanStore'));
  assert.equal(remote.rows.get('aiDcaPlanStore').revision, 3);
  const merged = JSON.parse(localStorage.getItem('aiDcaPlanStore'));
  assert.deepEqual(merged.plans.map((item) => item.id).sort(), ['base', 'plan-local', 'plan-remote']);
  assert.equal(remote.rows.get('aiDcaSwitchStrategyPrefs'), undefined);
});

test('different local/remote keys do not open a conflict and both survive first sync', async () => {
  const localStorage = installBrowser();
  installSession();
  clearV2SyncSession();
  const remote = createRemoteFetch();
  localStorage.setItem('aiDcaPlanStore', JSON.stringify({ plans: [{ id: 'local-only' }] }));
  const remoteEnvelope = {
    version: 1,
    source: 'ai-dca-sync-v2-item',
    keyCount: 1,
    keys: ['aiDcaSwitchStrategyPrefs'],
    payload: { aiDcaSwitchStrategyPrefs: JSON.stringify({ enabled: true }) }
  };
  const encrypted = await encryptSyncItem(remoteEnvelope, 'security-password-123', { rememberDevice: true });
  encrypted.source = 'ai-dca-secure-sync-v2';
  remote.rows.set('aiDcaSwitchStrategyPrefs', {
    syncKey: 'aiDcaSwitchStrategyPrefs',
    revision: 1,
    contentHash: encrypted.meta.contentHash,
    cipherSha256: 'test-cipher-hash',
    encryptedPayload: { version: encrypted.version, source: encrypted.source, crypto: encrypted.crypto, meta: encrypted.meta, ciphertext: encrypted.ciphertext },
    updatedAt: new Date().toISOString(),
    clientUpdatedAt: '',
    deletedAt: ''
  });

  const conflict = await prepareCloudSyncConflict({ securityPassword: 'security-password-123', rememberDevice: false });
  assert.equal(conflict.hasLocalChanges, false);
  assert.deepEqual(conflict.localOnlyKeys, ['aiDcaPlanStore']);
  assert.deepEqual(conflict.remoteOnlyKeys, ['aiDcaSwitchStrategyPrefs']);
  await syncV2Now({ securityPassword: 'security-password-123', rememberDevice: false, mode: 'merge' });
  assert.ok(remote.rows.has('aiDcaPlanStore'));
  assert.deepEqual(JSON.parse(localStorage.getItem('aiDcaSwitchStrategyPrefs')), { enabled: true });
});

test('V2 clears its in-memory and remembered session key on logout', () => {
  const localStorage = installBrowser();
  installSession();
  localStorage.setItem('aiDcaSecureSyncV2RememberedKey', JSON.stringify({ userId: 'other-user', rawKey: 'raw', crypto: {} }));
  assert.equal(getV2SyncSessionStatus().remembered, false, 'invalid remembered metadata is ignored');
  clearV2SyncSession();
  assert.equal(localStorage.getItem('aiDcaSecureSyncV2RememberedKey'), null);
});
