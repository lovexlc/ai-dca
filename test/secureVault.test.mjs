import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decryptSyncItem,
  deriveDeviceKeyForSyncItem,
  encryptSyncItem,
  SecureVaultError,
  SECURE_VAULT_ERROR_CODES
} from '../src/app/secureVault.js';

const SAMPLE_ITEM = {
  version: 1,
  source: 'ai-dca-sync-v2-item',
  keyCount: 1,
  keys: ['aiDcaPlanStore'],
  payload: { aiDcaPlanStore: '{"plans":[]}' }
};

test('V2 secure item round-trips with a security password', async () => {
  const encrypted = await encryptSyncItem(SAMPLE_ITEM, 'security-password-123', { rememberDevice: false });
  assert.equal(encrypted.version, 3);
  assert.equal(encrypted.source, 'ai-dca-secure-sync');
  assert.ok(encrypted.crypto.wrappedDek);
  assert.ok(encrypted.crypto.verifier);
  assert.ok(encrypted.deviceKey);
  assert.equal(encrypted.deviceKey.extractable, false);
  assert.equal(encrypted.rememberedKey, undefined);
  assert.deepEqual(await decryptSyncItem(encrypted, 'security-password-123'), SAMPLE_ITEM);
});

test('a wrong security password returns WRONG_PASSWORD', async () => {
  const encrypted = await encryptSyncItem(SAMPLE_ITEM, 'correct-password-123', { rememberDevice: false });
  await assert.rejects(
    () => decryptSyncItem(encrypted, 'totally-wrong-456'),
    (error) => error instanceof SecureVaultError && error.code === SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD
  );
});

test('the remembered V2 key keeps password and device-key decryption available', async () => {
  const seed = await encryptSyncItem(SAMPLE_ITEM, 'security-password-123', { rememberDevice: true });
  const reencrypted = await encryptSyncItem(SAMPLE_ITEM, '', {
    deviceKey: seed.deviceKey,
    cryptoMeta: seed.crypto,
    rememberDevice: true
  });
  assert.equal(reencrypted.version, 3);
  assert.equal(reencrypted.crypto.wrappedDek, seed.crypto.wrappedDek);
  assert.notEqual(reencrypted.crypto.iv, seed.crypto.iv);
  assert.deepEqual(await decryptSyncItem(reencrypted, 'security-password-123'), SAMPLE_ITEM);
  assert.deepEqual(await decryptSyncItem(reencrypted, seed.deviceKey), SAMPLE_ITEM);
});

test('V2 derives the reusable data key only from the V2 wrapped DEK', async () => {
  const encrypted = await encryptSyncItem(SAMPLE_ITEM, 'security-password-123', { rememberDevice: false });
  const deviceKey = await deriveDeviceKeyForSyncItem(encrypted, 'security-password-123');
  assert.equal(deviceKey.extractable, false);
  assert.deepEqual(await decryptSyncItem(encrypted, deviceKey), SAMPLE_ITEM);
});

test('unsupported formats are rejected instead of being decoded by a fallback', async () => {
  const encrypted = await encryptSyncItem(SAMPLE_ITEM, 'security-password-123', { rememberDevice: false });
  encrypted.version = 4;
  await assert.rejects(
    () => decryptSyncItem(encrypted, 'security-password-123'),
    (error) => error instanceof SecureVaultError && error.code === SECURE_VAULT_ERROR_CODES.FORMAT
  );
});

test('invalid cipher and empty ciphertext are rejected', async () => {
  const encrypted = await encryptSyncItem(SAMPLE_ITEM, 'security-password-123', { rememberDevice: false });
  encrypted.crypto.alg = 'AES-CBC';
  await assert.rejects(
    () => decryptSyncItem(encrypted, 'security-password-123'),
    (error) => error instanceof SecureVaultError && error.code === SECURE_VAULT_ERROR_CODES.FORMAT
  );
  await assert.rejects(
    () => decryptSyncItem({ version: 3, crypto: { alg: 'AES-GCM', wrappedDek: 'wrapped' }, ciphertext: '' }, 'security-password-123'),
    (error) => error instanceof SecureVaultError && error.code === SECURE_VAULT_ERROR_CODES.CORRUPTED
  );
});

test('tampering the verifier is reported as corrupted V2 data', async () => {
  const encrypted = await encryptSyncItem(SAMPLE_ITEM, 'security-password-123', { rememberDevice: false });
  encrypted.crypto.verifier = 'AAAAAAAAAAAAAAAAAAAAAA==';
  await assert.rejects(
    () => decryptSyncItem(encrypted, 'security-password-123'),
    (error) => error instanceof SecureVaultError && error.code === SECURE_VAULT_ERROR_CODES.CORRUPTED
  );
});
