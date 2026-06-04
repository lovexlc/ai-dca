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

export const SECURE_VAULT_ERROR_CODES = {
  WRONG_PASSWORD: 'ERR_WRONG_PASSWORD',
  NEED_DEVICE_KEY: 'ERR_NEED_DEVICE_KEY',
  CORRUPTED: 'ERR_CORRUPTED',
  FORMAT: 'ERR_FORMAT'
};

const SECURE_VAULT_ERROR_MESSAGES = {
  [SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD]: '安全密码不正确，请重新输入',
  [SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY]: '该备份由「记住本设备」生成，需在原设备解密，或用安全密码重新上传一份',
  [SECURE_VAULT_ERROR_CODES.CORRUPTED]: '云端备份数据已损坏，请用其它设备重新上传覆盖',
  [SECURE_VAULT_ERROR_CODES.FORMAT]: '备份格式不受支持，请升级到最新版本后重试'
};

export class SecureVaultError extends Error {
  constructor(code, message) {
    super(message || SECURE_VAULT_ERROR_MESSAGES[code] || '安全同步出错');
    this.name = 'SecureVaultError';
    this.code = code;
  }
}

// 判定信封是否为「记住本设备」用 raw key 直接加密（无 KDF，密码端无法派生）。
function isRawKeyEnvelope(cryptoMeta = {}) {
  if (String(cryptoMeta.kdf || '') === 'RAW-AES-GCM') return true;
  if (!cryptoMeta.salt) return true; // 兼容历史：salt 为空说明没走 KDF。
  return false;
}

function normalizeIterations(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ITERATIONS;
}
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

  // 0.4 解密前的格式/版本协商：明确区分「格式不兼容」与「密码错/损坏」。
  if (!payload.ciphertext) {
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.CORRUPTED, '云端密文为空或缺失');
  }
  const version = Number(payload.version);
  if (Number.isFinite(version) && version > 2) {
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.FORMAT, `不支持的备份版本 v${version}，请升级后重试`);
  }
  const alg = String(cryptoMeta.alg || CIPHER_NAME);
  if (alg !== CIPHER_NAME) {
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.FORMAT, `不支持的加密算法 ${alg}`);
  }

  let cipherBytes;
  try {
    cipherBytes = base64ToBytes(payload.ciphertext);
  } catch {
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.CORRUPTED, '云端密文编码异常');
  }
  let iv;
  try {
    iv = base64ToBytes(cryptoMeta.iv || '');
  } catch {
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.CORRUPTED, '云端密文 IV 异常');
  }

  const provided = String(securityPasswordOrKey || '');
  const isRawKeyInput = provided.startsWith('raw:');
  const rawEnvelope = isRawKeyEnvelope(cryptoMeta);

  let key;
  if (rawEnvelope && !isRawKeyInput) {
    // 0.2 RAW-AES-GCM 信封无法用密码派生，必须用本设备 raw key。
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY);
  }
  if (isRawKeyInput) {
    try {
      key = await importRawKey(provided.slice(4));
    } catch {
      throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY, '本设备密钥无效');
    }
  } else {
    const salt = base64ToBytes(cryptoMeta.salt || '');
    const iterations = normalizeIterations(cryptoMeta.iterations);
    try {
      key = await deriveKey(securityPasswordOrKey, salt, iterations);
    } catch (err) {
      // deriveKey 的输入校验（如「安全密码至少 8 位」）归类为密码问题。
      throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD, err?.message);
    }
  }

  let decrypted;
  try {
    decrypted = await ensureCrypto().subtle.decrypt({ name: CIPHER_NAME, iv }, key, cipherBytes);
  } catch {
    // GCM 校验失败：raw-key 路径多半设备密钥不对/密文坏；密码路径多半密码错。
    if (isRawKeyInput || rawEnvelope) {
      throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY);
    }
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD);
  }
  try {
    return JSON.parse(TEXT_DECODER.decode(decrypted));
  } catch {
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.CORRUPTED, '解密成功但备份内容无法解析');
  }
}

export async function rememberKeyForEncryptedEnvelope(encryptedEnvelope, securityPassword, meta = {}) {
  const cryptoMeta = encryptedEnvelope?.crypto || {};
  const salt = base64ToBytes(cryptoMeta.salt || '');
  const iterations = normalizeIterations(cryptoMeta.iterations);
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
