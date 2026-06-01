// Client-side encryption helpers for account sync.
// 明文数据只在浏览器内存在；上传到 Worker 前统一转成 AES-GCM 密文。

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const KDF_NAME = 'PBKDF2';
const HASH_NAME = 'SHA-256';
const CIPHER_NAME = 'AES-GCM';
const KEY_LENGTH = 256;
const DEFAULT_ITERATIONS = 310000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const REMEMBERED_KEY = 'aiDcaSecureSyncRememberedKey';

function ensureCrypto() {
  if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.getRandomValues) {
    throw new Error('当前浏览器不支持安全加密能力');
  }
  return crypto;
}

function randomBytes(length) {
  const c = ensureCrypto();
  const bytes = new Uint8Array(length);
  c.getRandomValues(bytes);
  return bytes;
}

export function bytesToBase64(bytes) {
  let binary = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

export function base64ToBytes(value = '') {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function generateSecurityPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(24);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('').replace(/(.{4})/g, '$1-').replace(/-$/, '');
}

async function deriveKey(securityPassword, salt, iterations = DEFAULT_ITERATIONS) {
  const c = ensureCrypto();
  const password = String(securityPassword || '');
  if (password.length < 8) throw new Error('安全密码至少 8 位');
  const material = await c.subtle.importKey('raw', TEXT_ENCODER.encode(password), KDF_NAME, false, ['deriveKey']);
  return c.subtle.deriveKey(
    { name: KDF_NAME, salt, iterations, hash: HASH_NAME },
    material,
    { name: CIPHER_NAME, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

async function exportRawKey(key) {
  const raw = await ensureCrypto().subtle.exportKey('raw', key);
  return bytesToBase64(new Uint8Array(raw));
}

async function importRawKey(rawBase64) {
  const raw = base64ToBytes(rawBase64);
  return ensureCrypto().subtle.importKey('raw', raw, { name: CIPHER_NAME, length: KEY_LENGTH }, true, ['encrypt', 'decrypt']);
}

// 计算备份明文的确定性 hash，仅依赖内容（keys + entries + schemaVersion），排除 exportedAt 等随机量。
// 服务端以此判断是否跳过版本升级。
export async function computeBackupContentHash(envelope) {
  const env = envelope || {};
  const payload = env.payload && typeof env.payload === 'object' ? env.payload : {};
  const keys = Array.isArray(env.keys) && env.keys.length ? [...env.keys] : Object.keys(payload);
  keys.sort();
  const orderedEntries = keys.reduce((acc, key) => { acc[key] = payload[key]; return acc; }, {});
  const canonical = JSON.stringify({
    schemaVersion: Number(env.version) || 1,
    keyCount: Number(env.keyCount) || keys.length,
    keys,
    entries: orderedEntries
  });
  const digest = await ensureCrypto().subtle.digest('SHA-256', TEXT_ENCODER.encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function encryptBackupEnvelope(envelope, securityPassword, options = {}) {
  const rememberedRawKey = String(options.rawKey || '').trim();
  const rememberedCrypto = options.cryptoMeta || {};
  const hasRememberedKdf = rememberedRawKey && rememberedCrypto.salt && rememberedCrypto.iterations;
  const salt = hasRememberedKdf ? base64ToBytes(rememberedCrypto.salt) : rememberedRawKey ? new Uint8Array(0) : randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const iterations = hasRememberedKdf ? Number(rememberedCrypto.iterations) : rememberedRawKey ? 0 : Number(options.iterations) || DEFAULT_ITERATIONS;
  const key = rememberedRawKey ? await importRawKey(rememberedRawKey) : await deriveKey(securityPassword, salt, iterations);
  const plaintext = TEXT_ENCODER.encode(JSON.stringify(envelope || {}));
  const contentHash = await computeBackupContentHash(envelope);
  const encrypted = await ensureCrypto().subtle.encrypt({ name: CIPHER_NAME, iv }, key, plaintext);
  const exportedKey = options.rememberDevice && !rememberedRawKey ? await exportRawKey(key) : rememberedRawKey;
  return {
    version: 2,
    source: 'ai-dca-secure-sync',
    crypto: {
      alg: CIPHER_NAME,
      kdf: rememberedRawKey && !hasRememberedKdf ? 'RAW-AES-GCM' : `${KDF_NAME}-${HASH_NAME}`,
      iterations,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv)
    },
    meta: {
      keyCount: Number(envelope?.keyCount) || 0,
      exportedAt: envelope?.exportedAt || new Date().toISOString(),
      schemaVersion: Number(envelope?.version) || 1,
      contentHash
    },
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    rememberedKey: exportedKey
  };
}

export async function decryptBackupEnvelope(encryptedEnvelope, securityPasswordOrKey) {
  const payload = encryptedEnvelope || {};
  const cryptoMeta = payload.crypto || {};
  const salt = base64ToBytes(cryptoMeta.salt || '');
  const iv = base64ToBytes(cryptoMeta.iv || '');
  const iterations = Number(cryptoMeta.iterations) || DEFAULT_ITERATIONS;
  const key = String(securityPasswordOrKey || '').startsWith('raw:')
    ? await importRawKey(String(securityPasswordOrKey).slice(4))
    : await deriveKey(securityPasswordOrKey, salt, iterations);
  let decrypted;
  try {
    decrypted = await ensureCrypto().subtle.decrypt({ name: CIPHER_NAME, iv }, key, base64ToBytes(payload.ciphertext || ''));
  } catch {
    throw new Error('安全密码不正确或云端数据已损坏');
  }
  return JSON.parse(TEXT_DECODER.decode(decrypted));
}

export async function rememberKeyForEncryptedEnvelope(encryptedEnvelope, securityPassword, meta = {}) {
  const cryptoMeta = encryptedEnvelope?.crypto || {};
  const salt = base64ToBytes(cryptoMeta.salt || '');
  const iterations = Number(cryptoMeta.iterations) || DEFAULT_ITERATIONS;
  const key = await deriveKey(securityPassword, salt, iterations);
  const rawKey = await exportRawKey(key);
  saveRememberedKey(rawKey, { ...meta, crypto: cryptoMeta });
  return rawKey;
}

export function saveRememberedKey(rawKeyBase64, meta = {}) {
  if (typeof window === 'undefined' || !window.localStorage || !rawKeyBase64) return;
  window.localStorage.setItem(REMEMBERED_KEY, JSON.stringify({ rawKey: rawKeyBase64, savedAt: new Date().toISOString(), ...meta }));
}

export function loadRememberedKey() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REMEMBERED_KEY) || 'null');
    return parsed?.rawKey ? parsed : null;
  } catch {
    return null;
  }
}

export function clearRememberedKey() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.removeItem(REMEMBERED_KEY);
}

export const SECURE_SYNC_REMEMBERED_KEY = REMEMBERED_KEY;
