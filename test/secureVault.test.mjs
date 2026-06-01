import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decryptBackupEnvelope,
  encryptBackupEnvelope,
  loadRememberedKey,
  rememberKeyForEncryptedEnvelope
} from '../src/app/secureVault.js';

function installLocalStorageMock() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(String(key), String(value)); },
      removeItem: (key) => { store.delete(String(key)); }
    }
  };
}

test('rememberKeyForEncryptedEnvelope stores a reusable key after restore password succeeds', async () => {
  installLocalStorageMock();
  const envelope = {
    version: 1,
    source: 'ai-dca',
    keyCount: 1,
    keys: ['aiDcaPlanStore'],
    payload: { aiDcaPlanStore: '{"plans":[]}' }
  };
  const encrypted = await encryptBackupEnvelope(envelope, 'security-password-123', { rememberDevice: false });
  const rawKey = await rememberKeyForEncryptedEnvelope(encrypted, 'security-password-123', { username: 'pc-user', version: 3 });
  const remembered = loadRememberedKey();

  assert.equal(typeof rawKey, 'string');
  assert.ok(rawKey.length > 20);
  assert.equal(remembered.username, 'pc-user');
  assert.equal(remembered.version, 3);
  assert.equal(remembered.rawKey, rawKey);

  const restored = await decryptBackupEnvelope(encrypted, `raw:${remembered.rawKey}`);
  assert.deepEqual(restored, envelope);
});
