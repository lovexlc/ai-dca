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
  return payload;
}

export async function uploadEncryptedCloudBackup({ securityPassword, rememberDevice = true, force = false, useRemembered = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const localMeta = loadCloudSyncMeta();
  const envelope = buildBackupEnvelope();
  if (!envelope.keyCount) throw new Error('当前没有可同步的数据');
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

function isSyncableKey(key = '') {
  const value = String(key || '');
  return value.startsWith('aiDca') && !['aiDcaPendingToasts', 'aiDcaCloudSyncMeta', 'aiDcaCloudSyncSession', 'aiDcaSecureSyncRememberedKey'].includes(value);
}

function scheduleAutoUpload() {
  const session = loadCloudSession();
  const remembered = loadRememberedKey();
  if (!session?.accessToken || !remembered?.rawKey) return;
  window.clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(async () => {
    try {
      await uploadEncryptedCloudBackup({ useRemembered: true, rememberDevice: true });
      window.dispatchEvent(new CustomEvent('cloud-sync:auto-uploaded'));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('cloud-sync:auto-error', { detail: { message: err?.message || String(err) } }));
    }
  }, 2500);
}

export function startCloudAutoSync() {
  if (typeof window === 'undefined' || !window.localStorage || autoSyncStarted) return;
  autoSyncStarted = true;
  const storage = window.localStorage;
  originalSetItem = storage.setItem.bind(storage);
  originalRemoveItem = storage.removeItem.bind(storage);
  originalClear = storage.clear.bind(storage);
  storage.setItem = (key, value) => {
    originalSetItem(key, value);
    if (isSyncableKey(key)) scheduleAutoUpload();
  };
  storage.removeItem = (key) => {
    originalRemoveItem(key);
    if (isSyncableKey(key)) scheduleAutoUpload();
  };
  storage.clear = () => {
    originalClear();
    scheduleAutoUpload();
  };
  window.addEventListener('storage', (event) => {
    if (isSyncableKey(event.key)) scheduleAutoUpload();
  });
}
