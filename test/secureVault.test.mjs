import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decryptBackupEnvelope,
  encryptBackupEnvelope,
  loadRememberedKey,
  rememberKeyForEncryptedEnvelope,
  SecureVaultError,
  SECURE_VAULT_ERROR_CODES
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

const SAMPLE_ENVELOPE = {
  version: 1,
  source: 'ai-dca',
  keyCount: 1,
  keys: ['aiDcaPlanStore'],
  payload: { aiDcaPlanStore: '{"plans":[]}' }
};

test('decrypt with a wrong password throws WRONG_PASSWORD', async () => {
  installLocalStorageMock();
  const encrypted = await encryptBackupEnvelope(SAMPLE_ENVELOPE, 'correct-password-123', {});
  await assert.rejects(
    () => decryptBackupEnvelope(encrypted, 'totally-wrong-456'),
    (err) => {
      assert.ok(err instanceof SecureVaultError);
      assert.equal(err.code, SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD);
      return true;
    }
  );
});

test('a RAW-key envelope decrypted with a password throws NEED_DEVICE_KEY but works with raw key', async () => {
  installLocalStorageMock();
  const seed = await encryptBackupEnvelope(SAMPLE_ENVELOPE, 'security-password-123', { rememberDevice: true });
  const rawKey = seed.rememberedKey;
  assert.equal(typeof rawKey, 'string');

  const rawEnvelope = await encryptBackupEnvelope(SAMPLE_ENVELOPE, '', { rawKey });
  assert.equal(rawEnvelope.crypto.kdf, 'RAW-AES-GCM');
  assert.equal(rawEnvelope.crypto.salt, '');

  await assert.rejects(
    () => decryptBackupEnvelope(rawEnvelope, 'security-password-123'),
    (err) => {
      assert.ok(err instanceof SecureVaultError);
      assert.equal(err.code, SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY);
      return true;
    }
  );

  const restored = await decryptBackupEnvelope(rawEnvelope, `raw:${rawKey}`);
  assert.deepEqual(restored, SAMPLE_ENVELOPE);
});

test('iterations=0 in a PBKDF2 envelope still decrypts (normalizeIterations fallback)', async () => {
  installLocalStorageMock();
  const encrypted = await encryptBackupEnvelope(SAMPLE_ENVELOPE, 'security-password-123', {});
  // 模拟历史信封把 iterations 落成了 0（旧 bug：falsy 会被回退到默认值）。
  encrypted.crypto.iterations = 0;
  const restored = await decryptBackupEnvelope(encrypted, 'security-password-123');
  assert.deepEqual(restored, SAMPLE_ENVELOPE);
});

test('an unsupported future version throws FORMAT', async () => {
  installLocalStorageMock();
  const encrypted = await encryptBackupEnvelope(SAMPLE_ENVELOPE, 'security-password-123', {});
  encrypted.version = 3;
  await assert.rejects(
    () => decryptBackupEnvelope(encrypted, 'security-password-123'),
    (err) => err instanceof SecureVaultError && err.code === SECURE_VAULT_ERROR_CODES.FORMAT
  );
});

test('an unsupported cipher alg throws FORMAT', async () => {
  installLocalStorageMock();
  const encrypted = await encryptBackupEnvelope(SAMPLE_ENVELOPE, 'security-password-123', {});
  encrypted.crypto.alg = 'AES-CBC';
  await assert.rejects(
    () => decryptBackupEnvelope(encrypted, 'security-password-123'),
    (err) => err instanceof SecureVaultError && err.code === SECURE_VAULT_ERROR_CODES.FORMAT
  );
});

test('an empty ciphertext throws CORRUPTED', async () => {
  installLocalStorageMock();
  await assert.rejects(
    () => decryptBackupEnvelope({ version: 2, crypto: { alg: 'AES-GCM' }, ciphertext: '' }, 'security-password-123'),
    (err) => err instanceof SecureVaultError && err.code === SECURE_VAULT_ERROR_CODES.CORRUPTED
  );
});
