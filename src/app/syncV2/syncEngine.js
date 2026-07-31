import { fetchLatestCloudBackup, loadCloudSession } from '../authClient.js';
import { decryptBackupEnvelope, deriveRawKeyForEncryptedEnvelope, loadRememberedKey, saveRememberedKey } from '../secureVault.js';
import { ACCOUNT_SYNC_REGISTRY, isAccountSyncKey } from '../syncRegistry.js';
import { fetchChanges, fetchManifest, readDocuments, writeDocument } from './syncApi.js';
import { clearSyncCryptoContext, createSyncCryptoContext, decryptSyncDocument, encryptSyncDocument, hasStoredSyncCryptoContext, persistSyncCryptoContext } from './syncCrypto.js';
import {
  applyLocalSyncValue,
  contentHash,
  mergeSyncValues,
  normalizeForSync,
  readLocalSyncValue
} from './syncAdapters.js';
import { loadManifest, saveManifest, setManifestDocument } from './syncManifest.js';
import { loadOutbox, removeOutboxEntry, upsertOutboxEntry } from './syncOutbox.js';

const AUTO_UPLOAD_DELAY = 1200;
const AUTO_PULL_INTERVAL = 45000;

let runtime = null;
let storagePatched = false;
let previousSetItem = null;
let previousRemoveItem = null;
let previousClear = null;

function nowIso() {
  return new Date().toISOString();
}

function dispatch(name, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function mutationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `mutation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function currentSession(session = loadCloudSession()) {
  return session?.accessToken ? session : null;
}

function isRuntimeSession(session) {
  return Boolean(runtime && session && runtime.session?.userId === session.userId && runtime.session?.username === session.username);
}

function meaningful(value) {
  return value !== null && value !== undefined && String(value) !== '' && String(value) !== 'null';
}

function applyRemoteValue(key, value) {
  if (!runtime) return applyLocalSyncValue(key, value);
  runtime.applyingRemote = true;
  try {
    return applyLocalSyncValue(key, value);
  } finally {
    runtime.applyingRemote = false;
  }
}

function remoteDocumentMap(documents = []) {
  return new Map((Array.isArray(documents) ? documents : []).filter((doc) => isAccountSyncKey(doc.syncKey)).map((doc) => [doc.syncKey, doc]));
}

async function persistRuntimeManifest() {
  if (runtime) await saveManifest(runtime.session, runtime.manifest);
}

async function rememberRemoteCrypto(encryptedPayload) {
  if (!runtime?.cryptoContext || runtime.cryptoContext.rawKey || !runtime.cryptoContext.securityPassword) return;
  const rawKey = await deriveRawKeyForEncryptedEnvelope(encryptedPayload, runtime.cryptoContext.securityPassword);
  runtime.cryptoContext = {
    ...runtime.cryptoContext,
    rawKey,
    cryptoMeta: encryptedPayload.crypto || null
  };
  persistSyncCryptoContext(runtime.cryptoContext);
  if (runtime.cryptoContext.rememberDevice) {
    saveRememberedKey(rawKey, {
      userId: runtime.session?.userId || '',
      username: runtime.session?.username || '',
      crypto: runtime.cryptoContext.cryptoMeta,
      version: encryptedPayload.version
    });
  }
}

async function decryptLegacyEnvelope(encryptedEnvelope) {
  if (!encryptedEnvelope?.ciphertext) return null;
  const context = runtime.cryptoContext;
  const secret = context.rawKey ? `raw:${context.rawKey}` : context.securityPassword;
  const envelope = await decryptBackupEnvelope(encryptedEnvelope, secret);
  if (!context.rawKey && context.securityPassword && encryptedEnvelope.version === 3 && encryptedEnvelope.crypto?.wrappedDek) {
    await rememberRemoteCrypto(encryptedEnvelope);
  }
  return envelope;
}

async function mergeLegacyPayload(envelope) {
  const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const merged = new Map();
  for (const descriptor of ACCOUNT_SYNC_REGISTRY) {
    const key = descriptor.key;
    const local = normalizeForSync(key, readLocalSyncValue(key));
    let legacyValue = Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : null;
    // The old envelope stored account notification credentials and the device
    // identity together. Extract only account fields while migrating; the
    // device half must remain local to this browser.
    if (legacyValue == null && key === 'aiDcaNotifyAccountConfig' && payload.aiDcaNotifyClientConfig != null) {
      try {
        const combined = JSON.parse(String(payload.aiDcaNotifyClientConfig));
        legacyValue = JSON.stringify({
          barkDeviceKey: combined?.barkDeviceKey || '',
          serverChan3Uid: combined?.serverChan3Uid || '',
          serverChan3SendKey: combined?.serverChan3SendKey || ''
        });
      } catch {
        legacyValue = null;
      }
    }
    const remote = legacyValue == null ? null : normalizeForSync(key, legacyValue);
    const value = meaningful(local) && meaningful(remote)
      ? mergeSyncValues(key, remote, local)
      : (meaningful(local) ? local : remote);
    merged.set(key, value);
    if (value !== local) applyRemoteValue(key, value);
  }
  return merged;
}

async function enqueueCurrentKey(key, { baseRevision = null, encryptedPayload = null, operation = null } = {}) {
  if (!runtime || !isAccountSyncKey(key)) return null;
  const normalized = normalizeForSync(key, readLocalSyncValue(key));
  const hash = await contentHash(normalized);
  const currentDocument = runtime.manifest.documents[key] || {};
  const effectiveBaseRevision = baseRevision == null ? Number(currentDocument.revision) || 0 : Math.max(0, Number(baseRevision) || 0);
  const effectiveOperation = operation || (normalized == null ? 'delete' : 'upsert');
  let encrypted = encryptedPayload;
  if (effectiveOperation !== 'delete' && !encrypted) {
    // Different keys may upload concurrently, but the first encryption must
    // initialize one shared account DEK before the other keys reuse it.
    const previous = runtime.cryptoTail;
    let release;
    runtime.cryptoTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const result = await encryptSyncDocument(key, normalized, runtime.cryptoContext);
      runtime.cryptoContext = result.context;
      encrypted = result.encryptedPayload;
    } finally {
      release();
    }
  }
  const entry = {
    mutationId: mutationId(),
    syncKey: key,
    baseRevision: effectiveBaseRevision,
    contentHash: effectiveOperation === 'delete' ? '' : hash,
    encryptedPayload: effectiveOperation === 'delete' ? null : encrypted,
    operation: effectiveOperation,
    createdAt: nowIso(),
    retryCount: 0,
    status: 'pending'
  };
  await upsertOutboxEntry(runtime.session, entry);
  return entry;
}

async function readRemoteDocument(key) {
  const result = await readDocuments([key], runtime.session);
  return result?.documents?.find((document) => document.syncKey === key) || null;
}

async function mergeRemoteConflict(key, remoteDocument) {
  const localValue = normalizeForSync(key, readLocalSyncValue(key));
  if (!remoteDocument || remoteDocument.deleted) {
    return { value: localValue, revision: Number(remoteDocument?.revision) || 0, remoteHash: String(remoteDocument?.contentHash || '') };
  }
  const decrypted = await decryptSyncDocument(key, remoteDocument.encryptedPayload, runtime.cryptoContext);
  runtime.cryptoContext = decrypted.context;
  const remoteValue = normalizeForSync(key, decrypted.value);
  const value = meaningful(localValue) && meaningful(remoteValue)
    ? mergeSyncValues(key, remoteValue, localValue)
    : (meaningful(localValue) ? localValue : remoteValue);
  if (value !== localValue) applyRemoteValue(key, value);
  return {
    value,
    remoteValue,
    revision: Number(remoteDocument.revision) || 0,
    remoteHash: String(remoteDocument.contentHash || '')
  };
}

async function flushKey(key) {
  if (!runtime || !isAccountSyncKey(key) || runtime.keyLocks.has(key)) return null;
  runtime.keyLocks.add(key);
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const normalized = normalizeForSync(key, readLocalSyncValue(key));
      const current = runtime.manifest.documents[key] || {};
      const hash = await contentHash(normalized);
      if (normalized == null && !current.revision) return null;
      if (normalized != null && current.contentHash === hash && !current.deleted) return current;
      const entry = await enqueueCurrentKey(key, { baseRevision: current.revision || 0 });
      if (!entry) return null;
      try {
        const result = await writeDocument(entry, runtime.session);
        runtime.manifest = setManifestDocument(runtime.manifest, key, result);
        await removeOutboxEntry(runtime.session, entry.mutationId);
        await persistRuntimeManifest();
        dispatch('sync-v2:document-synced', { syncKey: key, result });
        return result;
      } catch (error) {
        if (Number(error?.status) !== 409 || error?.data?.code !== 'DOCUMENT_REVISION_CONFLICT') {
          await upsertOutboxEntry(runtime.session, { ...entry, retryCount: entry.retryCount + 1, status: 'failed' });
          dispatch('sync-v2:document-error', { syncKey: key, error });
          throw error;
        }
        const remote = await readRemoteDocument(key);
        const merged = await mergeRemoteConflict(key, remote);
        runtime.manifest = setManifestDocument(runtime.manifest, key, {
          revision: merged.revision,
          contentHash: merged.remoteHash,
          updatedAt: remote?.updatedAt || '',
          deleted: Boolean(remote?.deleted)
        });
        await persistRuntimeManifest();
        if (merged.value === null && remote?.deleted) {
          await removeOutboxEntry(runtime.session, entry.mutationId);
          return remote;
        }
        if (merged.value === merged.remoteValue) {
          await removeOutboxEntry(runtime.session, entry.mutationId);
          return remote;
        }
      }
    }
    throw new Error(`同步 key ${key} 冲突重试次数过多`);
  } finally {
    runtime.keyLocks.delete(key);
  }
}

async function processRemoteDocument(document) {
  const key = document?.syncKey;
  if (!runtime || !isAccountSyncKey(key) || !document) return;
  const localValue = normalizeForSync(key, readLocalSyncValue(key));
  const localHash = await contentHash(localValue);
  if (!document.deleted && localHash === String(document.contentHash || '')) {
    runtime.manifest = setManifestDocument(runtime.manifest, key, document);
    return;
  }
  const known = runtime.manifest.documents[key];
  if (known && localHash === known.contentHash) {
    if (document.deleted) applyRemoteValue(key, null);
    else {
      const decrypted = await decryptSyncDocument(key, document.encryptedPayload, runtime.cryptoContext);
      runtime.cryptoContext = decrypted.context;
      applyRemoteValue(key, normalizeForSync(key, decrypted.value));
    }
    runtime.manifest = setManifestDocument(runtime.manifest, key, document);
    return;
  }
  if (document.deleted) {
    if (!meaningful(localValue)) applyRemoteValue(key, null);
    else await enqueueCurrentKey(key, { baseRevision: document.revision });
    runtime.manifest = setManifestDocument(runtime.manifest, key, document);
    return;
  }
  const merged = await mergeRemoteConflict(key, document);
  runtime.manifest = setManifestDocument(runtime.manifest, key, {
    ...document,
    deleted: false
  });
  if (merged.value !== merged.remoteValue) {
    await enqueueCurrentKey(key, { baseRevision: document.revision });
  }
}

async function processRemoteDocuments(documents) {
  for (const document of remoteDocumentMap(documents).values()) {
    await processRemoteDocument(document);
  }
  await persistRuntimeManifest();
}

async function pullRemoteChanges({ full = false } = {}) {
  if (!runtime) return null;
  if (full) {
    const manifest = await fetchManifest(runtime.session);
    const docs = await readDocuments((manifest.documents || []).map((document) => document.syncKey), runtime.session);
    await processRemoteDocuments(docs.documents || []);
    runtime.manifest.cursor = Number(manifest.cursor) || runtime.manifest.cursor;
    await persistRuntimeManifest();
    return manifest;
  }
  let cursor = runtime.manifest.cursor || 0;
  let hasMore = true;
  while (hasMore) {
    const page = await fetchChanges({ since: cursor, limit: 100 }, runtime.session);
    const keys = Array.from(new Set((page.changes || []).map((change) => change.syncKey).filter(isAccountSyncKey)));
    if (keys.length) {
      const docs = await readDocuments(keys, runtime.session);
      await processRemoteDocuments(docs.documents || []);
    }
    cursor = Number(page.cursor) || cursor;
    hasMore = Boolean(page.hasMore);
  }
  runtime.manifest.cursor = cursor;
  await persistRuntimeManifest();
  return { cursor };
}

async function flushPending() {
  if (!runtime) return [];
  const outbox = await loadOutbox(runtime.session);
  const keys = new Set([
    ...outbox.map((entry) => entry.syncKey),
    ...ACCOUNT_SYNC_REGISTRY.map((descriptor) => descriptor.key)
  ]);
  const results = await Promise.allSettled(Array.from(keys).map((key) => flushKey(key)));
  return results;
}

function scheduleKey(key) {
  if (!runtime || !isAccountSyncKey(key) || typeof window === 'undefined') return;
  const previous = runtime.keyTimers.get(key);
  if (previous) window.clearTimeout(previous);
  const timer = window.setTimeout(() => {
    runtime.keyTimers.delete(key);
    flushKey(key).catch(() => {});
  }, AUTO_UPLOAD_DELAY);
  runtime.keyTimers.set(key, timer);
}

function patchStorage() {
  if (storagePatched || typeof window === 'undefined' || !window.Storage) return;
  storagePatched = true;
  const proto = window.Storage.prototype;
  previousSetItem = proto.setItem;
  previousRemoveItem = proto.removeItem;
  previousClear = proto.clear;
  proto.setItem = function syncV2SetItem(key, value) {
    const result = previousSetItem.call(this, key, value);
    if (this === window.localStorage && runtime && !runtime.applyingRemote && isAccountSyncKey(key)) scheduleKey(String(key));
    return result;
  };
  proto.removeItem = function syncV2RemoveItem(key) {
    const result = previousRemoveItem.call(this, key);
    if (this === window.localStorage && runtime && !runtime.applyingRemote && isAccountSyncKey(key)) scheduleKey(String(key));
    return result;
  };
  proto.clear = function syncV2Clear() {
    const result = previousClear.call(this);
    if (this === window.localStorage && runtime && !runtime.applyingRemote) {
      for (const descriptor of ACCOUNT_SYNC_REGISTRY) scheduleKey(descriptor.key);
    }
    return result;
  };
  window.addEventListener('storage', (event) => {
    if (runtime && !runtime.applyingRemote && isAccountSyncKey(event.key)) scheduleKey(event.key);
  });
}

function startTimers() {
  if (!runtime || typeof window === 'undefined') return;
  runtime.interval = window.setInterval(() => {
    syncNow().catch(() => {});
  }, AUTO_PULL_INTERVAL);
  window.addEventListener('focus', runtime.onFocus);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', runtime.onVisibility);
}

export async function initializeSyncV2({ session = loadCloudSession(), securityPassword = '', rememberDevice = true } = {}) {
  const current = currentSession(session);
  if (!current) return { skipped: true, reason: 'no-session' };
  if (isRuntimeSession(current) && runtime.started) {
    runtime.session = current;
    runtime.cryptoContext = { ...runtime.cryptoContext, session: current };
    if (securityPassword && !runtime.cryptoContext.securityPassword && !runtime.cryptoContext.rawKey) runtime.cryptoContext.securityPassword = securityPassword;
    return syncNow();
  }
  if (isRuntimeSession(current)) stopSyncV2();
  runtime = {
    session: current,
    cryptoContext: createSyncCryptoContext({ session: current, securityPassword, rememberDevice }),
    manifest: await loadManifest(current),
    keyLocks: new Set(),
    keyTimers: new Map(),
    applyingRemote: false,
    cryptoTail: Promise.resolve(),
    started: false,
    interval: null,
    onFocus: () => syncNow().catch(() => {}),
    onVisibility: () => {
      if (document.visibilityState === 'visible') syncNow().catch(() => {});
    }
  };

  try {
    let remoteManifest;
    try {
      remoteManifest = await fetchManifest(current);
    } catch (error) {
      if (Number(error?.status) === 404) {
        const unavailable = new Error('当前同步 Worker 尚未启用 V2 接口');
        unavailable.code = 'SYNC_V2_UNAVAILABLE';
        throw unavailable;
      }
      throw error;
    }

    const hasV2Documents = Array.isArray(remoteManifest?.documents) && remoteManifest.documents.length > 0;
    if (!hasV2Documents) {
      const legacy = await fetchLatestCloudBackup(current);
      if (legacy?.encryptedEnvelope?.ciphertext) {
        const envelope = await decryptLegacyEnvelope(legacy.encryptedEnvelope);
        await mergeLegacyPayload(envelope);
      }
      await pullRemoteChanges({ full: true });
    } else {
      await pullRemoteChanges({ full: true });
    }
    patchStorage();
    startTimers();
    await flushPending();
    runtime.started = true;
    dispatch('sync-v2:started', { session: current });
    return { mode: 'v2', manifest: runtime.manifest };
  } catch (error) {
    const failedSession = runtime?.session || current;
    runtime = null;
    clearSyncCryptoContext(failedSession);
    throw error;
  }
}

export async function startSyncV2(options = {}) {
  const session = options.session || loadCloudSession();
  if (isRuntimeSession(session) && runtime.started) return syncNow();
  if (!options.securityPassword && !hasStoredSyncCryptoContext(session)) {
    return { skipped: true, reason: 'security-password-required' };
  }
  const remembered = loadRememberedKey();
  return initializeSyncV2({ ...options, session, rememberDevice: options.rememberDevice ?? Boolean(remembered?.rawKey) });
}

export async function syncNow() {
  if (!runtime) return { skipped: true, reason: 'not-started' };
  dispatch('sync-v2:sync-started', {});
  try {
    await pullRemoteChanges();
    const results = await flushPending();
    dispatch('sync-v2:sync-finished', { results });
    return { mode: 'v2', results, manifest: runtime.manifest };
  } catch (error) {
    dispatch('sync-v2:sync-error', { error });
    throw error;
  }
}

export function stopSyncV2() {
  if (!runtime) return;
  const session = runtime.session;
  if (typeof window !== 'undefined') {
    for (const timer of runtime.keyTimers.values()) window.clearTimeout(timer);
    if (runtime.interval) window.clearInterval(runtime.interval);
    window.removeEventListener('focus', runtime.onFocus);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', runtime.onVisibility);
  }
  runtime = null;
  clearSyncCryptoContext(session);
}

export function getSyncV2Runtime() {
  return runtime;
}

export const __internals = {
  meaningful,
  remoteDocumentMap,
  mutationId
};
