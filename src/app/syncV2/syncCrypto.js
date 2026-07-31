import {
  decryptBackupEnvelope,
  deriveRawKeyForEncryptedEnvelope,
  encryptBackupEnvelope,
  loadRememberedKey,
  saveRememberedKey
} from '../secureVault.js';

const SESSION_CRYPTO_KEY = 'aiDcaCloudSyncV2SessionKey';

function sessionStorageSafe() {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  return window.sessionStorage;
}

function sessionKey(session) {
  return `${SESSION_CRYPTO_KEY}:${String(session?.userId || session?.username || 'anonymous')}`;
}

function loadSessionContext(session) {
  const storage = sessionStorageSafe();
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(sessionKey(session)) || 'null');
    return parsed?.rawKey && parsed?.cryptoMeta ? parsed : null;
  } catch {
    return null;
  }
}

export function persistSyncCryptoContext(context = {}) {
  const storage = sessionStorageSafe();
  if (!storage || !context.rawKey || !context.cryptoMeta) return;
  try {
    storage.setItem(sessionKey(context.session), JSON.stringify({
      rawKey: context.rawKey,
      cryptoMeta: context.cryptoMeta,
      savedAt: new Date().toISOString()
    }));
  } catch {
    // Session storage can be unavailable in strict privacy mode.
  }
}

export function clearSyncCryptoContext(session) {
  sessionStorageSafe()?.removeItem(sessionKey(session));
}

export function hasStoredSyncCryptoContext(session) {
  return Boolean(loadSessionContext(session)?.rawKey || (() => {
    const remembered = loadRememberedKey();
    return rememberedMatchesSession(remembered, session) && remembered?.crypto?.wrappedDek;
  })());
}

function rememberedMatchesSession(remembered, session) {
  if (!remembered?.rawKey) return false;
  if (remembered.userId && session?.userId && String(remembered.userId) !== String(session.userId)) return false;
  if (remembered.username && session?.username && String(remembered.username).toLowerCase() !== String(session.username).toLowerCase()) return false;
  return true;
}

export function createSyncCryptoContext({ session = null, securityPassword = '', rememberDevice = true } = {}) {
  const remembered = loadRememberedKey();
  if (rememberedMatchesSession(remembered, session) && remembered.crypto?.wrappedDek) {
    return {
      session,
      securityPassword: '',
      rememberDevice,
      rawKey: remembered.rawKey,
      cryptoMeta: remembered.crypto
    };
  }
  const sessionContext = loadSessionContext(session);
  if (sessionContext?.rawKey && sessionContext.cryptoMeta?.wrappedDek) {
    return {
      session,
      securityPassword: '',
      rememberDevice,
      rawKey: sessionContext.rawKey,
      cryptoMeta: sessionContext.cryptoMeta
    };
  }
  return {
    session,
    securityPassword: String(securityPassword || ''),
    rememberDevice,
    rawKey: '',
    cryptoMeta: null
  };
}

function documentEnvelope(syncKey, value) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: 'ai-dca',
    keyCount: 1,
    keys: [syncKey],
    payload: { [syncKey]: value }
  };
}

export async function encryptSyncDocument(syncKey, value, context = {}) {
  const encrypted = await encryptBackupEnvelope(documentEnvelope(syncKey, value), context.securityPassword, {
    // Always ask the vault to return the DEK to this function. It stays in the
    // in-memory context when rememberDevice is false, and is persisted only
    // when the user explicitly opted into remembering this device.
    rememberDevice: true,
    rawKey: context.rawKey || '',
    cryptoMeta: context.cryptoMeta || null
  });
  const nextContext = {
    ...context,
    rawKey: encrypted.rememberedKey || context.rawKey || '',
    cryptoMeta: encrypted.crypto || context.cryptoMeta || null
  };
  if (context.rememberDevice && nextContext.rawKey && nextContext.cryptoMeta) {
    saveRememberedKey(nextContext.rawKey, {
      userId: context.session?.userId || '',
      username: context.session?.username || '',
      crypto: nextContext.cryptoMeta,
      version: encrypted.version
    });
  }
  persistSyncCryptoContext(nextContext);
  return {
    context: nextContext,
    encryptedPayload: {
      version: encrypted.version,
      source: encrypted.source,
      crypto: encrypted.crypto,
      meta: encrypted.meta,
      ciphertext: encrypted.ciphertext
    }
  };
}

export async function decryptSyncDocument(syncKey, encryptedPayload, context = {}) {
  const secret = context.rawKey ? `raw:${context.rawKey}` : context.securityPassword;
  const envelope = await decryptBackupEnvelope(encryptedPayload, secret);
  const value = envelope?.payload?.[syncKey];
  const nextContext = { ...context };
  if (!nextContext.rawKey && context.securityPassword) {
    nextContext.rawKey = await deriveRawKeyForEncryptedEnvelope(encryptedPayload, context.securityPassword);
    nextContext.cryptoMeta = encryptedPayload.crypto || null;
    if (context.rememberDevice && nextContext.rawKey) {
      saveRememberedKey(nextContext.rawKey, {
        userId: context.session?.userId || '',
        username: context.session?.username || '',
        crypto: nextContext.cryptoMeta,
        version: encryptedPayload.version
      });
    }
    persistSyncCryptoContext(nextContext);
  }
  return { value, context: nextContext };
}

export const __internals = { documentEnvelope, rememberedMatchesSession };
