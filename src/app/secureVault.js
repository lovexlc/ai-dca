// Client-side encryption helpers for account sync.
// 明文数据只在浏览器内存在；上传到 Worker 前统一转成 AES-GCM 密文。

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const KDF_NAME = 'PBKDF2';
const HASH_NAME = 'SHA-256';
const CIPHER_NAME = 'AES-GCM';
const KEY_LENGTH = 256;
const DEFAULT_ITERATIONS = 600000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
// v3：用 DEK 加密的固定常量，作为「密码/设备密钥正确性」验证块。
const VERIFIER_CONSTANT = new TextEncoder().encode('ai-dca-secure-sync/v3-verifier');

export const SECURE_VAULT_ERROR_CODES = {
  WRONG_PASSWORD: 'ERR_WRONG_PASSWORD',
  NEED_DEVICE_KEY: 'ERR_NEED_DEVICE_KEY',
  CORRUPTED: 'ERR_CORRUPTED',
  FORMAT: 'ERR_FORMAT'
};

const SECURE_VAULT_ERROR_MESSAGES = {
  [SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD]: '安全密码不正确，请重新输入',
  [SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY]: '本设备保存的设备密钥无法解密当前云端备份，请输入安全密码解锁',
  [SECURE_VAULT_ERROR_CODES.CORRUPTED]: '云端备份数据已损坏，无法解密',
  [SECURE_VAULT_ERROR_CODES.FORMAT]: '备份格式不受支持，请升级到最新版本后重试'
};

export class SecureVaultError extends Error {
  constructor(code, message) {
    super(message || SECURE_VAULT_ERROR_MESSAGES[code] || '安全同步出错');
    this.name = 'SecureVaultError';
    this.code = code;
  }
}

function requireIterations(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.FORMAT, '同步密文迭代参数不合法');
  }
  return n;
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
    false,
    ['encrypt', 'decrypt']
  );
}

function isCryptoKey(value) {
  return Boolean(value && typeof value === 'object' && typeof value.type === 'string' && value.algorithm);
}

async function importRawKey(rawBase64) {
  const raw = base64ToBytes(rawBase64);
  return ensureCrypto().subtle.importKey('raw', raw, { name: CIPHER_NAME, length: KEY_LENGTH }, false, ['encrypt', 'decrypt']);
}

// 计算同步项明文的确定性 hash，仅依赖内容（keys + entries + schemaVersion）。
export async function computeSyncItemContentHash(envelope) {
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

export async function encryptSyncItem(envelope, securityPassword, options = {}) {
  const deviceKey = isCryptoKey(options.deviceKey) ? options.deviceKey : null;
  const rememberedCrypto = options.cryptoMeta || {};
  const reuse = Boolean(deviceKey && rememberedCrypto.wrappedDek);
  const iv = randomBytes(IV_BYTES);
  let dekKey;
  let cryptoBlock;
  let rememberedDeviceKey;
  if (reuse) {
    // 复用既有 KEK 包裹块（密码仍可派生），仅用同一 DEK 重新加密数据，换新 IV。
    dekKey = deviceKey;
    rememberedDeviceKey = deviceKey;
    cryptoBlock = {
      alg: CIPHER_NAME,
      kdf: rememberedCrypto.kdf,
      iterations: requireIterations(rememberedCrypto.iterations),
      salt: rememberedCrypto.salt || '',
      wrapIv: rememberedCrypto.wrapIv || '',
      wrappedDek: rememberedCrypto.wrappedDek || '',
      verifierIv: rememberedCrypto.verifierIv || '',
      verifier: rememberedCrypto.verifier || '',
      iv: bytesToBase64(iv)
    };
  } else {
    const salt = randomBytes(SALT_BYTES);
    const iterations = Number(options.iterations) || DEFAULT_ITERATIONS;
    const kek = await deriveKey(securityPassword, salt, iterations);
    const dekBytes = randomBytes(KEY_LENGTH / 8);
    const dekBase64 = bytesToBase64(dekBytes);
    dekKey = await importRawKey(dekBase64);
    rememberedDeviceKey = dekKey;
    const wrapIv = randomBytes(IV_BYTES);
    const wrappedDek = new Uint8Array(await ensureCrypto().subtle.encrypt({ name: CIPHER_NAME, iv: wrapIv }, kek, dekBytes));
    const verifierIv = randomBytes(IV_BYTES);
    const verifier = new Uint8Array(await ensureCrypto().subtle.encrypt({ name: CIPHER_NAME, iv: verifierIv }, dekKey, VERIFIER_CONSTANT));
    cryptoBlock = {
      alg: CIPHER_NAME,
      kdf: `${KDF_NAME}-${HASH_NAME}`,
      iterations,
      salt: bytesToBase64(salt),
      wrapIv: bytesToBase64(wrapIv),
      wrappedDek: bytesToBase64(wrappedDek),
      verifierIv: bytesToBase64(verifierIv),
      verifier: bytesToBase64(verifier),
      iv: bytesToBase64(iv)
    };
  }
  const plaintext = TEXT_ENCODER.encode(JSON.stringify(envelope || {}));
  const contentHash = await computeSyncItemContentHash(envelope);
  const encrypted = await ensureCrypto().subtle.encrypt({ name: CIPHER_NAME, iv }, dekKey, plaintext);
  return {
    version: 3,
    source: 'ai-dca-secure-sync',
    crypto: cryptoBlock,
    meta: {
      keyCount: Number(envelope?.keyCount) || 0,
      exportedAt: envelope?.exportedAt || new Date().toISOString(),
      schemaVersion: Number(envelope?.version) || 1,
      contentHash
    },
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    deviceKey: rememberedDeviceKey
  };
}

export async function decryptSyncItem(encryptedEnvelope, securityPasswordOrKey) {
  const payload = encryptedEnvelope || {};
  const cryptoMeta = payload.crypto || {};

  if (!payload.ciphertext) {
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.CORRUPTED, '云端密文为空或缺失');
  }
  const version = Number(payload.version);
  if (version !== 3 || !cryptoMeta.wrappedDek) {
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.FORMAT, '同步密文格式不受支持');
  }
  const hasRequiredCryptoFields = ['alg', 'kdf', 'iterations', 'salt', 'wrapIv', 'wrappedDek', 'verifierIv', 'verifier', 'iv']
    .every((field) => cryptoMeta[field] !== undefined && cryptoMeta[field] !== null && cryptoMeta[field] !== '');
  const alg = String(cryptoMeta.alg || '');
  if (!hasRequiredCryptoFields || alg !== CIPHER_NAME) {
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
    iv = base64ToBytes(cryptoMeta.iv);
  } catch {
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.CORRUPTED, '云端密文 IV 异常');
  }

  return decryptSyncItemV3(cryptoMeta, cipherBytes, iv, securityPasswordOrKey);
}

async function verifyV3Verifier(dekKey, cryptoMeta) {
  try {
    const iv = base64ToBytes(cryptoMeta.verifierIv);
    const out = new Uint8Array(await ensureCrypto().subtle.decrypt({ name: CIPHER_NAME, iv }, dekKey, base64ToBytes(cryptoMeta.verifier)));
    if (out.length !== VERIFIER_CONSTANT.length) return false;
    for (let i = 0; i < out.length; i += 1) {
      if (out[i] !== VERIFIER_CONSTANT[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function unwrapDekBytesWithPassword(securityPassword, cryptoMeta) {
  const salt = base64ToBytes(cryptoMeta.salt);
  const iterations = requireIterations(cryptoMeta.iterations);
  const kek = await deriveKey(securityPassword, salt, iterations);
  const wrapIv = base64ToBytes(cryptoMeta.wrapIv);
  const wrapped = base64ToBytes(cryptoMeta.wrappedDek);
  return new Uint8Array(await ensureCrypto().subtle.decrypt({ name: CIPHER_NAME, iv: wrapIv }, kek, wrapped));
}

// Derive a non-exportable reusable data-encryption key for this login.
export async function deriveDeviceKeyForSyncItem(encryptedEnvelope, securityPassword) {
  const cryptoMeta = encryptedEnvelope?.crypto || {};
  if (Number(encryptedEnvelope?.version) !== 3 || !cryptoMeta.wrappedDek) {
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.FORMAT, '同步密文格式不受支持');
  }
  const dekBytes = await unwrapDekBytesWithPassword(securityPassword, cryptoMeta);
  return ensureCrypto().subtle.importKey('raw', dekBytes, { name: CIPHER_NAME, length: KEY_LENGTH }, false, ['encrypt', 'decrypt']);
}

async function decryptSyncItemV3(cryptoMeta, cipherBytes, iv, provided) {
  const isDeviceKeyInput = isCryptoKey(provided);
  let dekKey;
  if (isDeviceKeyInput) {
    try {
      dekKey = provided;
    } catch {
      throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY, '本设备密钥无效');
    }
    if ((await verifyV3Verifier(dekKey, cryptoMeta)) === false) {
      throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY);
    }
  } else {
    const securityPassword = String(provided || '');
    let dekBytes;
    try {
      dekBytes = await unwrapDekBytesWithPassword(securityPassword, cryptoMeta);
    } catch {
      // KEK 解包 DEK 失败：密码错（GCM 校验失败）或密码格式不合法。
      throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD);
    }
    try {
      dekKey = await ensureCrypto().subtle.importKey('raw', dekBytes, { name: CIPHER_NAME, length: KEY_LENGTH }, false, ['encrypt', 'decrypt']);
    } catch {
      throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.CORRUPTED, 'DEK 无法导入');
    }
    if ((await verifyV3Verifier(dekKey, cryptoMeta)) === false) {
      throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.CORRUPTED, '验证块校验失败');
    }
  }
  let decrypted;
  try {
    decrypted = await ensureCrypto().subtle.decrypt({ name: CIPHER_NAME, iv }, dekKey, cipherBytes);
  } catch {
    throw new SecureVaultError(isDeviceKeyInput ? SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY : SECURE_VAULT_ERROR_CODES.CORRUPTED);
  }
  try {
    return JSON.parse(TEXT_DECODER.decode(decrypted));
  } catch {
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.CORRUPTED, '解密成功但备份内容无法解析');
  }
}
