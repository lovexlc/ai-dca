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
  const rememberedRawKey0 = String(options.rawKey || '').trim();
  const rememberedCrypto0 = options.cryptoMeta || {};
  const isV3Remembered = Boolean(rememberedRawKey0 && rememberedCrypto0 && rememberedCrypto0.wrappedDek);
  // 旧版「记住本设备」只存了派生 AES key（无 wrappedDek）→ 过渡期继续产出 v2 RAW 信封，避免破坏该设备。
  if (options.legacyVersion === 2 || (rememberedRawKey0 && !isV3Remembered)) {
    return encryptBackupEnvelopeV2(envelope, securityPassword, options);
  }
  return encryptBackupEnvelopeV3(envelope, securityPassword, options);
}

async function encryptBackupEnvelopeV3(envelope, securityPassword, options = {}) {
  const rememberedRawKey = String(options.rawKey || '').trim();
  const rememberedCrypto = options.cryptoMeta || {};
  const reuse = Boolean(rememberedRawKey && rememberedCrypto.wrappedDek);
  const iv = randomBytes(IV_BYTES);
  let dekKey;
  let cryptoBlock;
  let exportedDek;
  if (reuse) {
    // 复用既有 KEK 包裹块（密码仍可派生），仅用同一 DEK 重新加密数据，换新 IV。
    dekKey = await importRawKey(rememberedRawKey);
    cryptoBlock = {
      alg: CIPHER_NAME,
      kdf: rememberedCrypto.kdf || `${KDF_NAME}-${HASH_NAME}`,
      iterations: normalizeIterations(rememberedCrypto.iterations),
      salt: rememberedCrypto.salt || '',
      wrapIv: rememberedCrypto.wrapIv || '',
      wrappedDek: rememberedCrypto.wrappedDek || '',
      verifierIv: rememberedCrypto.verifierIv || '',
      verifier: rememberedCrypto.verifier || '',
      iv: bytesToBase64(iv)
    };
    exportedDek = rememberedRawKey;
  } else {
    const salt = randomBytes(SALT_BYTES);
    const iterations = Number(options.iterations) || DEFAULT_ITERATIONS;
    const kek = await deriveKey(securityPassword, salt, iterations);
    const dekBytes = randomBytes(KEY_LENGTH / 8);
    const dekBase64 = bytesToBase64(dekBytes);
    dekKey = await importRawKey(dekBase64);
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
    exportedDek = options.rememberDevice ? dekBase64 : '';
  }
  const plaintext = TEXT_ENCODER.encode(JSON.stringify(envelope || {}));
  const contentHash = await computeBackupContentHash(envelope);
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
    rememberedKey: exportedDek
  };
}

async function encryptBackupEnvelopeV2(envelope, securityPassword, options = {}) {
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
  if (Number.isFinite(version) && version > 3) {
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

  // v3：KEK/DEK + verifier。优先走 v3 解密路径。
  if (Number(payload.version) === 3 && cryptoMeta.wrappedDek) {
    return decryptBackupEnvelopeV3(cryptoMeta, cipherBytes, iv, String(securityPasswordOrKey || ''));
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

async function verifyV3Verifier(dekKey, cryptoMeta) {
  if (!cryptoMeta.verifier || !cryptoMeta.verifierIv) return null;
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
  const salt = base64ToBytes(cryptoMeta.salt || '');
  const iterations = normalizeIterations(cryptoMeta.iterations);
  const kek = await deriveKey(securityPassword, salt, iterations);
  const wrapIv = base64ToBytes(cryptoMeta.wrapIv || '');
  const wrapped = base64ToBytes(cryptoMeta.wrappedDek || '');
  return new Uint8Array(await ensureCrypto().subtle.decrypt({ name: CIPHER_NAME, iv: wrapIv }, kek, wrapped));
}

async function decryptBackupEnvelopeV3(cryptoMeta, cipherBytes, iv, provided) {
  const isRawKeyInput = provided.startsWith('raw:');
  let dekKey;
  if (isRawKeyInput) {
    try {
      dekKey = await importRawKey(provided.slice(4));
    } catch {
      throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY, '本设备密钥无效');
    }
    if ((await verifyV3Verifier(dekKey, cryptoMeta)) === false) {
      throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY);
    }
  } else {
    let dekBytes;
    try {
      dekBytes = await unwrapDekBytesWithPassword(provided, cryptoMeta);
    } catch {
      // KEK 解包 DEK 失败：密码错（GCM 校验失败）或密码格式不合法。
      throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD);
    }
    try {
      dekKey = await importRawKey(bytesToBase64(dekBytes));
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
    throw new SecureVaultError(isRawKeyInput ? SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY : SECURE_VAULT_ERROR_CODES.CORRUPTED);
  }
  try {
    return JSON.parse(TEXT_DECODER.decode(decrypted));
  } catch {
    throw new SecureVaultError(SECURE_VAULT_ERROR_CODES.CORRUPTED, '解密成功但备份内容无法解析');
  }
}

export async function rememberKeyForEncryptedEnvelope(encryptedEnvelope, securityPassword, meta = {}) {
  const cryptoMeta = encryptedEnvelope?.crypto || {};
  // v3：记住本设备 = 存 DEK（而非某次派生的 AES key），envelope 仍保留密码可派生的 wrappedDek。
  if (Number(encryptedEnvelope?.version) === 3 && cryptoMeta.wrappedDek) {
    const dekBytes = await unwrapDekBytesWithPassword(securityPassword, cryptoMeta);
    const rawKey = bytesToBase64(dekBytes);
    saveRememberedKey(rawKey, { ...meta, crypto: cryptoMeta });
    return rawKey;
  }
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
