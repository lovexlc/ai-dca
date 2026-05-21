import { applyBackupEnvelope, buildBackupEnvelope } from './webdavBackup.js';
import { fetchCloudSyncMeta, fetchLatestCloudBackup, loadCloudSession, uploadLatestCloudBackup } from './authClient.js';
import { decryptBackupEnvelope, encryptBackupEnvelope, loadRememberedKey, saveRememberedKey } from './secureVault.js';

export const CLOUD_SYNC_META_KEY = 'aiDcaCloudSyncMeta';

function storage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

export function loadCloudSyncMeta() {
  const ls = storage();
  if (!ls) return null;
  try { return JSON.parse(ls.getItem(CLOUD_SYNC_META_KEY) || 'null'); } catch { return null; }
}

export function saveCloudSyncMeta(meta = {}) {
  const ls = storage();
  if (!ls) return null;
  const payload = { ...meta, savedAt: new Date().toISOString() };
  ls.setItem(CLOUD_SYNC_META_KEY, JSON.stringify(payload));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cloud-sync:meta-changed', { detail: { meta: payload } }));
  }
  return payload;
}

export async function uploadEncryptedCloudBackup({ securityPassword, rememberDevice = true, force = false, useRemembered = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const localMeta = loadCloudSyncMeta();
  const envelope = buildBackupEnvelope();
  const remembered = useRemembered ? loadRememberedKey() : null;
  const encrypted = await encryptBackupEnvelope(envelope, securityPassword, {
    rememberDevice,
    rawKey: remembered?.rawKey || '',
    cryptoMeta: remembered?.crypto || null
  });
  const payload = {
    baseVersion: force ? null : (localMeta?.version ?? null),
    clientUpdatedAt: envelope.exportedAt,
    encryptedEnvelope: {
      version: encrypted.version,
      source: encrypted.source,
      crypto: encrypted.crypto,
      meta: encrypted.meta,
      ciphertext: encrypted.ciphertext
    }
  };
  const result = await uploadLatestCloudBackup(payload, session);
  if (rememberDevice && encrypted.rememberedKey) {
    saveRememberedKey(encrypted.rememberedKey, { username: session.username, version: result.version, crypto: encrypted.crypto });
  }
  saveCloudSyncMeta({ version: result.version, updatedAt: result.updatedAt, keyCount: envelope.keyCount, direction: 'upload' });
  return result;
}

export async function restoreEncryptedCloudBackup({ securityPassword = '', useRemembered = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const remote = await fetchLatestCloudBackup(session);
  const encryptedEnvelope = remote?.encryptedEnvelope;
  if (!encryptedEnvelope?.ciphertext) throw new Error('云端暂无可恢复数据');
  const remembered = useRemembered ? loadRememberedKey() : null;
  const secret = remembered?.rawKey ? `raw:${remembered.rawKey}` : securityPassword;
  const envelope = await decryptBackupEnvelope(encryptedEnvelope, secret);
  const applied = applyBackupEnvelope(envelope, { wipePrefix: true });
  saveCloudSyncMeta({ version: remote.version, updatedAt: remote.updatedAt, keyCount: applied.restoredKeyCount, direction: 'restore' });
  return { ...applied, version: remote.version, updatedAt: remote.updatedAt };
}

export async function refreshRemoteCloudMeta() {
  const meta = await fetchCloudSyncMeta(loadCloudSession());
  if (meta?.version != null) saveCloudSyncMeta({ version: meta.version, updatedAt: meta.updatedAt, direction: 'remote' });
  return meta;
}


let autoSyncStarted = false;
let autoSyncTimer = null;
let originalSetItem = null;
let originalRemoveItem = null;
let originalClear = null;
let autoUploadInFlight = false;

function isSyncableKey(key = '') {
  const value = String(key || '');
  return value.startsWith('aiDca') && !['aiDcaPendingToasts', 'aiDcaCloudSyncMeta', 'aiDcaCloudSyncSession', 'aiDcaSecureSyncRememberedKey'].includes(value);
}

export function scheduleCloudAutoUpload({ delay = 2500 } = {}) {
  const session = loadCloudSession();
  const remembered = loadRememberedKey();
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

export function startCloudAutoSync() {
  if (typeof window === 'undefined' || !window.localStorage || !window.Storage || autoSyncStarted) return;
  autoSyncStarted = true;
  const proto = window.Storage.prototype;
  originalSetItem = proto.setItem;
  originalRemoveItem = proto.removeItem;
  originalClear = proto.clear;
  proto.setItem = function patchedSetItem(key, value) {
    const result = originalSetItem.call(this, key, value);
    if (this === window.localStorage && isSyncableKey(key)) scheduleCloudAutoUpload();
    return result;
  };
  proto.removeItem = function patchedRemoveItem(key) {
    const result = originalRemoveItem.call(this, key);
    if (this === window.localStorage && isSyncableKey(key)) scheduleCloudAutoUpload();
    return result;
  };
  proto.clear = function patchedClear() {
    const result = originalClear.call(this);
    if (this === window.localStorage) scheduleCloudAutoUpload();
    return result;
  };
  window.addEventListener('storage', (event) => {
    if (isSyncableKey(event.key)) scheduleCloudAutoUpload();
  });
  scheduleCloudAutoUpload({ delay: 5000 });
}
