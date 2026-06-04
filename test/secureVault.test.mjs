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
  encrypted.version = 4;
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

test('v3 envelope: password round-trip carries wrappedDek + verifier', async () => {
  installLocalStorageMock();
  const enc = await encryptBackupEnvelope(SAMPLE_ENVELOPE, 'security-password-123', { rememberDevice: false });
  assert.equal(enc.version, 3);
  assert.ok(enc.crypto.wrappedDek, 'expected wrappedDek in v3 crypto block');
  assert.ok(enc.crypto.verifier, 'expected verifier in v3 crypto block');
  assert.equal(enc.rememberedKey, '');
  const restored = await decryptBackupEnvelope(enc, 'security-password-123');
  assert.deepEqual(restored, SAMPLE_ENVELOPE);
});

test('v3 envelope: tampered verifier with correct password throws CORRUPTED', async () => {
  installLocalStorageMock();
  const enc = await encryptBackupEnvelope(SAMPLE_ENVELOPE, 'security-password-123', {});
  assert.equal(enc.version, 3);
  enc.crypto.verifier = 'AAAAAAAAAAAAAAAAAAAAAA==';
  await assert.rejects(
    () => decryptBackupEnvelope(enc, 'security-password-123'),
    (err) => err instanceof SecureVaultError && err.code === SECURE_VAULT_ERROR_CODES.CORRUPTED
  );
});

test('v3 remembered-device re-upload stays password-decryptable (root-cause-A fix)', async () => {
  installLocalStorageMock();
  const seed = await encryptBackupEnvelope(SAMPLE_ENVELOPE, 'security-password-123', { rememberDevice: true });
  assert.equal(seed.version, 3);
  const dek = seed.rememberedKey;
  assert.equal(typeof dek, 'string');
  assert.ok(dek.length > 20);

  // 设备用记住的 DEK + 原有 crypto 块重新加密（模拟后续自动上传）。
  const reEnc = await encryptBackupEnvelope(SAMPLE_ENVELOPE, '', {
    rawKey: dek,
    cryptoMeta: seed.crypto,
    rememberDevice: true
  });
  assert.equal(reEnc.version, 3);
  // KEK 包裹块保留（密码仍可派生），数据 IV 换新。
  assert.equal(reEnc.crypto.wrappedDek, seed.crypto.wrappedDek);
  assert.notEqual(reEnc.crypto.iv, seed.crypto.iv);

  // 关键：只有记住设备上传的信封，另一台只有密码的设备仍可解密。
  const byPassword = await decryptBackupEnvelope(reEnc, 'security-password-123');
  assert.deepEqual(byPassword, SAMPLE_ENVELOPE);
  const byKey = await decryptBackupEnvelope(reEnc, `raw:${dek}`);
  assert.deepEqual(byKey, SAMPLE_ENVELOPE);
});

test('legacy v2 envelope still decrypts with password (v2->v3 compat)', async () => {
  installLocalStorageMock();
  const v2 = await encryptBackupEnvelope(SAMPLE_ENVELOPE, 'security-password-123', { legacyVersion: 2 });
  assert.equal(v2.version, 2);
  assert.ok(!v2.crypto.wrappedDek, 'v2 envelope must not carry wrappedDek');
  const restored = await decryptBackupEnvelope(v2, 'security-password-123');
  assert.deepEqual(restored, SAMPLE_ENVELOPE);
});
