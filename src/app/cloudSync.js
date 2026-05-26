import { applyBackupEnvelope, buildBackupEnvelope } from './webdavBackup.js';
import { fetchCloudSyncMeta, fetchLatestCloudBackup, loadCloudSession, uploadLatestCloudBackup } from './authClient.js';
import { decryptBackupEnvelope, encryptBackupEnvelope, loadRememberedKey, saveRememberedKey } from './secureVault.js';

export const CLOUD_SYNC_META_KEY = 'aiDcaCloudSyncMeta';

const TRANSIENT_SYNC_KEYS = new Set([
  'aiDcaPendingToasts',
  'aiDcaCloudSyncMeta',
  'aiDcaCloudSyncSession',
  'aiDcaSecureSyncRememberedKey'
]);

function storage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function nowIso() {
  return new Date().toISOString();
}

function parseTime(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashString(input = '') {
  let hash = 0x811c9dc5;
  const text = String(input || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

export function createLocalDataSnapshot(envelope = buildBackupEnvelope()) {
  const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const keys = Object.keys(payload).sort();
  return {
    signature: hashString(stableStringify(payload)),
    keyCount: keys.length,
    keys
  };
}

function snapshotFromEnvelope(envelope) {
  return createLocalDataSnapshot(envelope || { payload: {} });
}

export function loadCloudSyncMeta() {
  const ls = storage();
  if (!ls) return null;
  try { return JSON.parse(ls.getItem(CLOUD_SYNC_META_KEY) || 'null'); } catch { return null; }
}

export function saveCloudSyncMeta(meta = {}) {
  const ls = storage();
  if (!ls) return null;
  const payload = { ...meta, savedAt: nowIso() };
  ls.setItem(CLOUD_SYNC_META_KEY, JSON.stringify(payload));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cloud-sync:meta-changed', { detail: { meta: payload } }));
  }
  return payload;
}

export function ensureLocalChangeBaseline({ localSnapshot, localUpdatedAt } = {}) {
  const currentMeta = loadCloudSyncMeta() || {};
  const envelope = localSnapshot ? null : buildBackupEnvelope();
  const snapshot = localSnapshot || createLocalDataSnapshot(envelope);
  const fallbackUpdatedAt = localUpdatedAt || currentMeta.localUpdatedAt || currentMeta.updatedAt || (snapshot.keyCount ? nowIso() : '');
  const next = {
    ...currentMeta,
    localSignature: currentMeta.localSignature || snapshot.signature,
    localKeyCount: currentMeta.localKeyCount ?? snapshot.keyCount,
    localUpdatedAt: fallbackUpdatedAt || currentMeta.localUpdatedAt || ''
  };
  if (next.localSignature !== currentMeta.localSignature || next.localUpdatedAt !== currentMeta.localUpdatedAt || next.localKeyCount !== currentMeta.localKeyCount) {
    return saveCloudSyncMeta(next);
  }
  return currentMeta;
}

function markLocalChanged({ signature, keyCount } = {}) {
  const currentMeta = loadCloudSyncMeta() || {};
  const changedAt = nowIso();
  return saveCloudSyncMeta({
    ...currentMeta,
    localSignature: signature,
    localKeyCount: keyCount,
    localUpdatedAt: changedAt,
    direction: 'local-change'
  });
}

function isSyncableKey(key = '') {
  const value = String(key || '');
  return value.startsWith('aiDca') && !TRANSIENT_SYNC_KEYS.has(value);
}

function shouldUploadSnapshot(snapshot, meta, { force = false } = {}) {
  if (force) return true;
  if (!snapshot?.keyCount) return false;
  return snapshot.signature !== meta?.uploadedSignature;
}

export async function uploadEncryptedCloudBackup({ securityPassword, rememberDevice = true, force = false, useRemembered = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const localMeta = ensureLocalChangeBaseline();
  const envelope = buildBackupEnvelope();
  const snapshot = createLocalDataSnapshot(envelope);
  if (!shouldUploadSnapshot(snapshot, localMeta, { force })) {
    return {
      skipped: true,
      reason: 'unchanged-local-data',
      version: localMeta?.version ?? null,
      updatedAt: localMeta?.updatedAt || '',
      keyCount: snapshot.keyCount
    };
  }
  const remembered = useRemembered ? loadRememberedKey() : null;
  const encrypted = await encryptBackupEnvelope(envelope, securityPassword, {
    rememberDevice,
    rawKey: remembered?.rawKey || '',
    cryptoMeta: remembered?.crypto || null
  });
  const clientUpdatedAt = localMeta?.localUpdatedAt || envelope.exportedAt;
  const payload = {
    baseVersion: force ? null : (localMeta?.version ?? null),
    clientUpdatedAt,
    encryptedEnvelope: {
      version: encrypted.version,
      source: encrypted.source,
      crypto: encrypted.crypto,
      meta: {
        ...encrypted.meta,
        localSignature: snapshot.signature,
        localUpdatedAt: clientUpdatedAt
      },
      ciphertext: encrypted.ciphertext
    }
  };
  let result;
  try {
    result = await uploadLatestCloudBackup(payload, session);
  } catch (err) {
    const currentVersion = Number(err?.data?.currentVersion);
    if (!force && err?.status === 409 && Number.isFinite(currentVersion) && currentVersion >= 0) {
      result = await uploadLatestCloudBackup({
        ...payload,
        baseVersion: currentVersion,
        conflictResolution: 'retry-with-current-version'
      }, session);
      result.conflictResolved = true;
      result.previousBaseVersion = localMeta?.version ?? null;
    } else {
      throw err;
    }
  }
  if (rememberDevice && encrypted.rememberedKey) {
    saveRememberedKey(encrypted.rememberedKey, { username: session.username, version: result.version, crypto: encrypted.crypto });
  }
  saveCloudSyncMeta({
    ...localMeta,
    version: result.version,
    updatedAt: result.updatedAt,
    keyCount: envelope.keyCount,
    localSignature: snapshot.signature,
    localKeyCount: snapshot.keyCount,
    localUpdatedAt: clientUpdatedAt,
    uploadedSignature: snapshot.signature,
    uploadedAt: result.updatedAt,
    direction: 'upload'
  });
  return result;
}

export async function restoreEncryptedCloudBackup({ securityPassword = '', useRemembered = false, onlyIfRemoteNewer = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const remote = await fetchLatestCloudBackup(session);
  const encryptedEnvelope = remote?.encryptedEnvelope;
  if (!encryptedEnvelope?.ciphertext) throw new Error('云端暂无可恢复数据');
  const remembered = useRemembered ? loadRememberedKey() : null;
  const secret = remembered?.rawKey ? `raw:${remembered.rawKey}` : securityPassword;
  const envelope = await decryptBackupEnvelope(encryptedEnvelope, secret);
  const remoteSnapshot = snapshotFromEnvelope(envelope);
  const currentEnvelope = buildBackupEnvelope();
  const currentSnapshot = createLocalDataSnapshot(currentEnvelope);
  const currentMeta = ensureLocalChangeBaseline({ localSnapshot: currentSnapshot });
  const remoteUpdatedAt = remote.updatedAt || encryptedEnvelope?.meta?.localUpdatedAt || '';
  const localUpdatedAt = currentMeta?.localUpdatedAt || '';
  const sameData = remoteSnapshot.signature === currentSnapshot.signature;
  const remoteIsNewer = parseTime(remoteUpdatedAt) > parseTime(localUpdatedAt);

  if (onlyIfRemoteNewer && (sameData || !remoteIsNewer)) {
    saveCloudSyncMeta({
      ...currentMeta,
      version: remote.version,
      updatedAt: remote.updatedAt,
      remoteSignature: remoteSnapshot.signature,
      remoteUpdatedAt,
      localSignature: currentSnapshot.signature,
      localKeyCount: currentSnapshot.keyCount,
      direction: sameData ? 'restore-skip-same' : 'restore-skip-local-newer'
    });
    return {
      skipped: true,
      reason: sameData ? 'same-data' : 'local-newer-or-equal',
      version: remote.version,
      updatedAt: remote.updatedAt,
      localUpdatedAt,
      remoteUpdatedAt
    };
  }

  suppressAutoUpload = true;
  let applied;
  try {
    applied = applyBackupEnvelope(envelope, { wipePrefix: true });
  } finally {
    if (typeof window !== 'undefined') {
      window.setTimeout(() => { suppressAutoUpload = false; }, 0);
    } else {
      suppressAutoUpload = false;
    }
  }
  lastObservedSignature = remoteSnapshot.signature;
  saveCloudSyncMeta({
    ...currentMeta,
    version: remote.version,
    updatedAt: remote.updatedAt,
    keyCount: applied.restoredKeyCount,
    localSignature: remoteSnapshot.signature,
    localKeyCount: remoteSnapshot.keyCount,
    localUpdatedAt: remoteUpdatedAt,
    uploadedSignature: remoteSnapshot.signature,
    uploadedAt: remote.updatedAt,
    remoteSignature: remoteSnapshot.signature,
    remoteUpdatedAt,
    direction: 'restore'
  });
  return { ...applied, version: remote.version, updatedAt: remote.updatedAt, localUpdatedAt: remoteUpdatedAt };
}

export async function refreshRemoteCloudMeta() {
  const meta = await fetchCloudSyncMeta(loadCloudSession());
  if (meta?.version != null) {
    const currentMeta = ensureLocalChangeBaseline();
    saveCloudSyncMeta({
      ...currentMeta,
      version: meta.version,
      updatedAt: meta.updatedAt,
      remoteUpdatedAt: meta.updatedAt,
      direction: 'remote'
    });
  }
  return meta;
}

let autoSyncStarted = false;
let autoSyncTimer = null;
let originalSetItem = null;
let originalRemoveItem = null;
let originalClear = null;
let autoUploadInFlight = false;
let suppressAutoUpload = false;
let lastObservedSignature = '';

function observeLocalChange() {
  if (suppressAutoUpload) return false;
  const envelope = buildBackupEnvelope();
  const snapshot = createLocalDataSnapshot(envelope);
  const meta = ensureLocalChangeBaseline({ localSnapshot: snapshot });
  const previousSignature = lastObservedSignature || meta?.localSignature || '';
  lastObservedSignature = snapshot.signature;
  if (snapshot.signature === previousSignature) return false;
  markLocalChanged(snapshot);
  return true;
}

export function scheduleCloudAutoUpload({ delay = 2500, changed = false } = {}) {
  const session = loadCloudSession();
  const remembered = loadRememberedKey();
  if (!changed) return false;
  if (!session?.accessToken || !remembered?.rawKey || typeof window === 'undefined') return false;
  window.clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(async () => {
    if (autoUploadInFlight) return;
    autoUploadInFlight = true;
    window.dispatchEvent(new CustomEvent('cloud-sync:auto-upload-started'));
    try {
      const result = await uploadEncryptedCloudBackup({ useRemembered: true, rememberDevice: true });
      window.dispatchEvent(new CustomEvent('cloud-sync:auto-uploaded', { detail: { result } }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('cloud-sync:auto-error', { detail: { message: err?.message || String(err) } }));
    } finally {
      autoUploadInFlight = false;
    }
  }, delay);
  return true;
}

function maybeScheduleAfterStorageMutation() {
  const changed = observeLocalChange();
  if (changed) scheduleCloudAutoUpload({ changed });
}

export function startCloudAutoSync() {
  if (typeof window === 'undefined' || !window.localStorage || !window.Storage || autoSyncStarted) return;
  autoSyncStarted = true;
  const initialSnapshot = createLocalDataSnapshot(buildBackupEnvelope());
  lastObservedSignature = initialSnapshot.signature;
  ensureLocalChangeBaseline({ localSnapshot: initialSnapshot });
  const proto = window.Storage.prototype;
  originalSetItem = proto.setItem;
  originalRemoveItem = proto.removeItem;
  originalClear = proto.clear;
  proto.setItem = function patchedSetItem(key, value) {
    const before = this === window.localStorage && isSyncableKey(key) ? this.getItem(key) : null;
    const result = originalSetItem.call(this, key, value);
    if (this === window.localStorage && isSyncableKey(key) && before !== String(value)) maybeScheduleAfterStorageMutation();
    return result;
  };
  proto.removeItem = function patchedRemoveItem(key) {
    const hadValue = this === window.localStorage && isSyncableKey(key) && this.getItem(key) !== null;
    const result = originalRemoveItem.call(this, key);
    if (hadValue) maybeScheduleAfterStorageMutation();
    return result;
  };
  proto.clear = function patchedClear() {
    const before = this === window.localStorage ? createLocalDataSnapshot(buildBackupEnvelope()).signature : '';
    const result = originalClear.call(this);
    if (this === window.localStorage) {
      const after = createLocalDataSnapshot(buildBackupEnvelope()).signature;
      if (before !== after) maybeScheduleAfterStorageMutation();
    }
    return result;
  };
  window.addEventListener('storage', (event) => {
    if (isSyncableKey(event.key)) maybeScheduleAfterStorageMutation();
  });
}
