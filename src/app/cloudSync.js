import { applyBackupEnvelope, buildBackupEnvelope, isBackupPayloadKey } from './webdavBackup.js';
import { fetchCloudSyncMeta, fetchLatestCloudBackup, loadCloudSession, uploadLatestCloudBackup } from './authClient.js';
import { decryptBackupEnvelope, encryptBackupEnvelope, loadRememberedKey, rememberKeyForEncryptedEnvelope, saveRememberedKey } from './secureVault.js';

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

function normalizeEnvelopePayload(envelope = {}) {
  const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const keys = Array.from(new Set([
    ...(Array.isArray(envelope?.keys) ? envelope.keys : []),
    ...Object.keys(payload)
  ].map((key) => String(key || '')).filter(Boolean))).sort();
  return { payload, keys };
}

function previewKeys(keys = [], limit = 6) {
  const list = (Array.isArray(keys) ? keys : []).slice(0, limit);
  const suffix = keys.length > limit ? ` 等 ${keys.length} 项` : '';
  return `${list.join('、')}${suffix}`;
}

export function mergeBackupEnvelopes(remoteEnvelope = {}, localEnvelope = {}) {
  const remote = normalizeEnvelopePayload(remoteEnvelope);
  const local = normalizeEnvelopePayload(localEnvelope);
  const payload = { ...remote.payload, ...local.payload };
  const keys = Object.keys(payload).filter((key) => isBackupPayloadKey(key)).sort();
  return {
    version: Number(localEnvelope?.version || remoteEnvelope?.version || 1) || 1,
    exportedAt: nowIso(),
    source: 'ai-dca',
    keyCount: keys.length,
    keys,
    payload: keys.reduce((acc, key) => {
      acc[key] = payload[key];
      return acc;
    }, {})
  };
}

export function summarizeBackupConflict({ localEnvelope = null, remoteEnvelope = null, remote = null, localMeta = null } = {}) {
  const local = normalizeEnvelopePayload(localEnvelope || buildBackupEnvelope());
  const remoteData = normalizeEnvelopePayload(remoteEnvelope || { payload: {} });
  const localSet = new Set(local.keys);
  const remoteSet = new Set(remoteData.keys);
  const remoteOnlyKeys = remoteData.keys.filter((key) => !localSet.has(key));
  const localOnlyKeys = local.keys.filter((key) => !remoteSet.has(key));
  const changedKeys = remoteData.keys.filter((key) => localSet.has(key) && remoteData.payload[key] !== local.payload[key]);
  const sameKeys = remoteData.keys.filter((key) => localSet.has(key) && remoteData.payload[key] === local.payload[key]);
  const parts = [];
  if (changedKeys.length) parts.push(`${changedKeys.length} 项两端都改过：${previewKeys(changedKeys)}`);
  if (remoteOnlyKeys.length) parts.push(`${remoteOnlyKeys.length} 项只在云端存在：${previewKeys(remoteOnlyKeys)}`);
  if (localOnlyKeys.length) parts.push(`${localOnlyKeys.length} 项只在本机存在：${previewKeys(localOnlyKeys)}`);
  if (!parts.length) parts.push('两端数据内容一致，仅版本元数据不同');
  return {
    hasConflict: changedKeys.length > 0 || remoteOnlyKeys.length > 0 || localOnlyKeys.length > 0,
    remoteVersion: remote?.version ?? null,
    remoteUpdatedAt: remote?.updatedAt || remote?.encryptedEnvelope?.meta?.localUpdatedAt || '',
    remoteKeyCount: remoteData.keys.length,
    localVersion: localMeta?.version ?? null,
    localUpdatedAt: localMeta?.localUpdatedAt || '',
    localKeyCount: local.keys.length,
    changedKeys,
    remoteOnlyKeys,
    localOnlyKeys,
    sameKeyCount: sameKeys.length,
    summaryText: parts.join('；')
  };
}

function createCloudSyncConflictError(conflict, cause = null) {
  const error = new Error('云端数据已更新，请选择合并本机数据或拉取云端覆盖本地');
  error.status = 409;
  error.isCloudSyncConflict = true;
  error.conflict = conflict || null;
  error.cause = cause || undefined;
  return error;
}

async function readRemoteBackupWithEnvelope({ securityPassword = '', useRemembered = false } = {}) {
  const remote = await fetchLatestCloudBackup(loadCloudSession());
  const encryptedEnvelope = remote?.encryptedEnvelope;
  if (!encryptedEnvelope?.ciphertext) return { remote, envelope: null };
  const remembered = useRemembered ? loadRememberedKey() : null;
  const secret = remembered?.rawKey ? `raw:${remembered.rawKey}` : securityPassword;
  const envelope = await decryptBackupEnvelope(encryptedEnvelope, secret);
  return { remote, envelope };
}

export async function prepareCloudSyncConflict({ securityPassword = '', useRemembered = false } = {}) {
  const localEnvelope = buildBackupEnvelope();
  const currentMeta = ensureLocalChangeBaseline({ localSnapshot: createLocalDataSnapshot(localEnvelope) });
  const { remote, envelope: remoteEnvelope } = await readRemoteBackupWithEnvelope({ securityPassword, useRemembered });
  if (!remoteEnvelope) return null;
  return summarizeBackupConflict({ localEnvelope, remoteEnvelope, remote, localMeta: currentMeta });
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
  return isBackupPayloadKey(value) && !TRANSIENT_SYNC_KEYS.has(value);
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
      let conflict = null;
      try {
        conflict = await prepareCloudSyncConflict({ securityPassword, useRemembered });
      } catch (_conflictError) {
        conflict = {
          hasConflict: true,
          remoteVersion: currentVersion,
          localVersion: localMeta?.version ?? null,
          summaryText: '云端版本已变化，但当前设备暂时无法解密云端数据生成明细。'
        };
      }
      throw createCloudSyncConflictError(conflict, err);
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

export async function mergeLocalIntoCloudBackup({ securityPassword = '', rememberDevice = true, useRemembered = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const localEnvelope = buildBackupEnvelope();
  const localSnapshot = createLocalDataSnapshot(localEnvelope);
  const localMeta = ensureLocalChangeBaseline({ localSnapshot });
  const { remote, envelope: remoteEnvelope } = await readRemoteBackupWithEnvelope({ securityPassword, useRemembered });
  if (!remoteEnvelope) {
    return uploadEncryptedCloudBackup({ securityPassword, rememberDevice, force: true, useRemembered });
  }
  const mergedEnvelope = mergeBackupEnvelopes(remoteEnvelope, localEnvelope);
  const remembered = useRemembered ? loadRememberedKey() : null;
  const encrypted = await encryptBackupEnvelope(mergedEnvelope, securityPassword, {
    rememberDevice,
    rawKey: remembered?.rawKey || '',
    cryptoMeta: remembered?.crypto || null
  });
  const result = await uploadLatestCloudBackup({
    baseVersion: remote.version ?? null,
    clientUpdatedAt: localMeta?.localUpdatedAt || mergedEnvelope.exportedAt,
    conflictResolution: 'merge-local-over-remote',
    encryptedEnvelope: {
      version: encrypted.version,
      source: encrypted.source,
      crypto: encrypted.crypto,
      meta: {
        ...encrypted.meta,
        localSignature: createLocalDataSnapshot(mergedEnvelope).signature,
        localUpdatedAt: localMeta?.localUpdatedAt || mergedEnvelope.exportedAt
      },
      ciphertext: encrypted.ciphertext
    }
  }, session);
  if (rememberDevice && encrypted.rememberedKey) {
    saveRememberedKey(encrypted.rememberedKey, { username: session.username, version: result.version, crypto: encrypted.crypto });
  }
  suppressAutoUpload = true;
  try {
    applyBackupEnvelope(mergedEnvelope, { wipePrefix: true });
  } finally {
    if (typeof window !== 'undefined') {
      window.setTimeout(() => { suppressAutoUpload = false; }, 0);
    } else {
      suppressAutoUpload = false;
    }
  }
  const mergedSnapshot = createLocalDataSnapshot(mergedEnvelope);
  lastObservedSignature = mergedSnapshot.signature;
  saveCloudSyncMeta({
    ...localMeta,
    version: result.version,
    updatedAt: result.updatedAt,
    keyCount: mergedEnvelope.keyCount,
    localSignature: mergedSnapshot.signature,
    localKeyCount: mergedSnapshot.keyCount,
    localUpdatedAt: localMeta?.localUpdatedAt || mergedEnvelope.exportedAt,
    uploadedSignature: mergedSnapshot.signature,
    uploadedAt: result.updatedAt,
    remoteSignature: mergedSnapshot.signature,
    remoteUpdatedAt: result.updatedAt,
    direction: 'merge'
  });
  return { ...result, mergedKeyCount: mergedEnvelope.keyCount, conflictResolution: 'merge-local-over-remote' };
}

export async function restoreEncryptedCloudBackup({ securityPassword = '', useRemembered = false, rememberDevice = true, onlyIfRemoteNewer = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const remote = await fetchLatestCloudBackup(session);
  const encryptedEnvelope = remote?.encryptedEnvelope;
  if (!encryptedEnvelope?.ciphertext) throw new Error('云端暂无可恢复数据');
  const remembered = useRemembered ? loadRememberedKey() : null;
  const secret = remembered?.rawKey ? `raw:${remembered.rawKey}` : securityPassword;
  const envelope = await decryptBackupEnvelope(encryptedEnvelope, secret);
  if (rememberDevice && !remembered?.rawKey && securityPassword) {
    await rememberKeyForEncryptedEnvelope(encryptedEnvelope, securityPassword, {
      username: session.username,
      version: remote.version
    });
  }
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
      window.dispatchEvent(new CustomEvent('cloud-sync:auto-error', {
        detail: {
          message: err?.message || String(err),
          conflict: err?.isCloudSyncConflict ? err.conflict : null
        }
      }));
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
