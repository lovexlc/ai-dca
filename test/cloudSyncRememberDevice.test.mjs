import assert from 'node:assert/strict';
import test from 'node:test';

import { pullRemoteAuthoritativeMerge } from '../src/app/cloudSync.js';
import { encryptBackupEnvelope } from '../src/app/secureVault.js';

class MemoryStorage {
  #values = new Map();

  get length() {
    return this.#values.size;
  }

  key(index) {
    return [...this.#values.keys()][index] ?? null;
  }

  getItem(key) {
    const normalized = String(key);
    return this.#values.has(normalized) ? this.#values.get(normalized) : null;
  }

  setItem(key, value) {
    this.#values.set(String(key), String(value));
  }

  removeItem(key) {
    this.#values.delete(String(key));
  }

  clear() {
    this.#values.clear();
  }
}

test('remote-authoritative pull remembers the device key after password login', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const localStorage = new MemoryStorage();
  const windowLike = Object.assign(new EventTarget(), {
    localStorage,
    navigator: { userAgent: 'node-test' },
    innerWidth: 1200,
    setTimeout,
    clearTimeout
  });
  const securityPassword = 'security-password-123';
  const remoteEnvelope = {
    version: 1,
    exportedAt: '2026-07-14T00:00:00.000Z',
    source: 'ai-dca',
    keyCount: 1,
    keys: ['aiDcaWorkspacePrefs'],
    payload: {
      aiDcaWorkspacePrefs: JSON.stringify({ scenario: 'stock', marker: 'remote-device' })
    }
  };

  try {
    globalThis.window = windowLike;
    localStorage.setItem('aiDcaCloudSyncSession', JSON.stringify({
      userId: 'user-1',
      username: 'sync-user',
      accessToken: 'access-token'
    }));
    const encrypted = await encryptBackupEnvelope(remoteEnvelope, securityPassword, { rememberDevice: false });
    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/latest$/);
      return new Response(JSON.stringify({
        version: 4,
        updatedAt: '2026-07-14T00:00:00.000Z',
        encryptedEnvelope: {
          version: encrypted.version,
          source: encrypted.source,
          crypto: encrypted.crypto,
          meta: encrypted.meta,
          ciphertext: encrypted.ciphertext
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    const result = await pullRemoteAuthoritativeMerge({
      securityPassword,
      rememberDevice: true,
      useRemembered: false
    });

    assert.equal(result.pulled, true);
    assert.equal(result.reuploaded, false);
    assert.equal(JSON.parse(localStorage.getItem('aiDcaWorkspacePrefs')).marker, 'remote-device');
    const remembered = JSON.parse(localStorage.getItem('aiDcaSecureSyncRememberedKey') || 'null');
    assert.ok(remembered?.rawKey, 'successful password pull should enable later automatic uploads');
    assert.equal(remembered.username, 'sync-user');
    assert.equal(remembered.version, 4);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
