import {
  fetchCloudSyncV2Items,
  fetchCloudSyncV2Meta,
  uploadCloudSyncV2Item
} from '../authClient.js';
import { CLOUD_SYNC_SESSION_EVENT, loadCloudSession } from '../authSession.js';
import {
  decryptSyncItem,
  deriveDeviceKeyForSyncItem,
  encryptSyncItem,
  SECURE_VAULT_ERROR_CODES
} from '../secureVault.js';
import {
  clearRememberedSyncKeys,
  loadRememberedSyncKey,
  saveRememberedSyncKey
} from '../rememberedSyncKeyStore.js';
import {
  SYNC_REGISTRY,
  V2_ACCOUNT_SYNC_DESCRIPTORS,
  isV2AccountSyncKey
} from '../syncRegistry.js';
import { mergeSyncValues } from './merge.js';

export const SYNC_V2_META_KEY = 'aiDcaCloudSyncV2Meta';
export const SYNC_V2_REMEMBERED_KEY = 'aiDcaSecureSyncV2RememberedKey';
export const SYNC_V2_SECURITY_PASSWORD_REQUIRED = 'ERR_SYNC_V2_SECURITY_PASSWORD_REQUIRED';

const SYNC_V2_SCHEMA_VERSION = 2;
const MAX_CAS_RETRIES = 4;
const SYNC_DESCRIPTOR_LABELS = new Map(SYNC_REGISTRY.map((descriptor) => [descriptor.key, descriptor.label]));

function formatSyncKeyNames(keys = []) {
  return (Array.isArray(keys) ? keys : [])
    .map((key) => SYNC_DESCRIPTOR_LABELS.get(key) || '其他同步数据')
    .join('、');
}

const runtime = {
  userId: '',
  securityPassword: '',
  deviceKey: null,
  cryptoMeta: null,
  persistKey: false,
  dirtyKeys: new Set(),
  inFlight: null,
  queue: Promise.resolve(),
  autoStarted: false,
  autoTimer: null,
  autoInterval: null,
  cleanups: [],
  originalStorage: null,
  suppressStorageObservation: false
};

function storage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function nowIso() {
  return new Date().toISOString();
}

function safeJson(value, fallback = null) {
  try { return JSON.parse(String(value || '')); } catch { return fallback; }
}

function clearLocalAccountSyncState() {
  const ls = storage();
  if (!ls) return;

  runtime.suppressStorageObservation = true;
  try {
    for (const descriptor of SYNC_REGISTRY) {
      if (descriptor.scope === 'account') ls.removeItem(descriptor.key);
    }
    ls.removeItem(SYNC_V2_META_KEY);
    // Remove the pre-IDB raw-key slot. V2 never reads it back.
    ls.removeItem(SYNC_V2_REMEMBERED_KEY);
  } finally {
    runtime.suppressStorageObservation = false;
  }
}

function fingerprint(value) {
  const text = value == null ? '[missing]' : String(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

function readLocalValue(key) {
  const ls = storage();
  return ls ? ls.getItem(key) : null;
}

function writeLocalValue(key, value) {
  const ls = storage();
  if (!ls) return;
  runtime.suppressStorageObservation = true;
  try {
    if (value == null) ls.removeItem(key);
    else ls.setItem(key, String(value));
  } finally {
    runtime.suppressStorageObservation = false;
  }
}

function sessionUserId(session = loadCloudSession()) {
  return String(session?.userId || '').trim();
}

function securityPasswordRequired() {
  const error = new Error('当前会话没有可用的同步密钥，请输入安全密码解锁');
  error.code = SYNC_V2_SECURITY_PASSWORD_REQUIRED;
  return error;
}

function syncConflictError(key, remoteItem = null, meta = {}, reason = '同一同步 key 在本机和云端都被修改') {
  const error = new Error(reason);
  error.code = 'SYNC_V2_CONFLICT';
  error.isCloudSyncConflict = true;
  error.conflict = {
    key,
    remoteRevision: Number(remoteItem?.revision) || 0,
    localRevision: Number(meta?.items?.[key]?.revision) || 0,
    reason
  };
  return error;
}

async function rememberedKeyForUser(userId) {
  const record = await loadRememberedSyncKey(userId);
  if (!record?.key || !record?.cryptoMeta || String(record.userId || '') !== String(userId || '')) return null;
  return record;
}

async function saveRememberedV2Key(userId, deviceKey, cryptoMeta) {
  if (!userId || !deviceKey || !cryptoMeta) return;
  await saveRememberedSyncKey(userId, deviceKey, cryptoMeta);
}

async function clearRememberedV2Key() {
  storage()?.removeItem(SYNC_V2_REMEMBERED_KEY);
  await clearRememberedSyncKeys();
}

async function setRuntimeCrypto({ userId, securityPassword = '', deviceKey = null, cryptoMeta = null, rememberDevice = false } = {}) {
  if (userId) runtime.userId = String(userId);
  if (securityPassword) runtime.securityPassword = String(securityPassword);
  if (deviceKey && cryptoMeta) {
    runtime.deviceKey = deviceKey;
    runtime.cryptoMeta = cryptoMeta;
    if (rememberDevice) await saveRememberedV2Key(runtime.userId, runtime.deviceKey, runtime.cryptoMeta);
    else await clearRememberedV2Key();
  }
}

async function ensureRuntimeSession(session = loadCloudSession(), securityPassword = '') {
  const userId = sessionUserId(session);
  if (!userId) throw new Error('登录会话缺少 userId，请重新登录');
  if (runtime.userId !== userId) {
    const persistedMeta = safeJson(storage()?.getItem(SYNC_V2_META_KEY), null);
    const previousUserId = String(runtime.userId || persistedMeta?.userId || '').trim();
    if (previousUserId && previousUserId !== userId) clearLocalAccountSyncState();

    runtime.userId = userId;
    runtime.securityPassword = '';
    runtime.deviceKey = null;
    runtime.cryptoMeta = null;
    runtime.persistKey = false;
    runtime.dirtyKeys.clear();
    const remembered = await rememberedKeyForUser(userId);
    if (remembered) {
      runtime.deviceKey = remembered.key;
      runtime.cryptoMeta = remembered.cryptoMeta;
      runtime.persistKey = true;
    }
  }
  if (securityPassword) runtime.securityPassword = String(securityPassword);
  return userId;
}

function loadLocalMeta(userId) {
  const parsed = safeJson(storage()?.getItem(SYNC_V2_META_KEY), null);
  if (!parsed || Number(parsed.syncSchemaVersion) !== SYNC_V2_SCHEMA_VERSION || String(parsed.userId || '') !== String(userId || '')) {
    return { syncSchemaVersion: SYNC_V2_SCHEMA_VERSION, userId, items: {} };
  }
  return { ...parsed, items: parsed.items && typeof parsed.items === 'object' ? parsed.items : {} };
}

export function loadV2SyncMeta(session = loadCloudSession()) {
  const userId = sessionUserId(session);
  return userId ? loadLocalMeta(userId) : null;
}

function saveMeta(meta, { version = 0, updatedAt = '', keyCount = 0, direction = 'idle' } = {}) {
  const payload = {
    ...meta,
    syncSchemaVersion: SYNC_V2_SCHEMA_VERSION,
    version,
    updatedAt,
    keyCount,
    direction
  };
  const ls = storage();
  if (ls) ls.setItem(SYNC_V2_META_KEY, JSON.stringify(payload));
  dispatch('cloud-sync-v2:meta-changed', { meta: payload });
  return payload;
}

function descriptorKeys() {
  return V2_ACCOUNT_SYNC_DESCRIPTORS.map((descriptor) => descriptor.key);
}

export function getV2AccountSyncKeys() {
  return descriptorKeys();
}

export function collectV2BackupPayload() {
  const entries = {};
  const keys = [];
  for (const key of descriptorKeys()) {
    const value = readLocalValue(key);
    if (value == null) continue;
    keys.push(key);
    entries[key] = value;
  }
  return { entries, keys: keys.sort(), keyCount: keys.length };
}

export function getV2SyncSessionStatus(session = loadCloudSession()) {
  const userId = sessionUserId(session);
  const sameUser = Boolean(userId && runtime.userId === userId);
  return {
    userId,
    unlocked: Boolean(sameUser && (runtime.deviceKey || runtime.securityPassword)),
    remembered: Boolean(sameUser && runtime.deviceKey && runtime.persistKey),
    inMemory: Boolean(sameUser && (runtime.deviceKey || runtime.securityPassword))
  };
}

export function clearV2SyncSession({ clearRemembered = true } = {}) {
  clearLocalAccountSyncState();
  runtime.userId = '';
  runtime.securityPassword = '';
  runtime.deviceKey = null;
  runtime.cryptoMeta = null;
  runtime.persistKey = false;
  runtime.dirtyKeys.clear();
  if (clearRemembered) void clearRememberedV2Key();
}

function publicEncryptedPayload(encrypted) {
  return {
    version: encrypted.version,
    source: 'ai-dca-secure-sync-v2',
    crypto: encrypted.crypto,
    meta: encrypted.meta,
    ciphertext: encrypted.ciphertext
  };
}

function buildItemEnvelope(syncKey, rawValue) {
  return {
    version: 1,
    source: 'ai-dca-sync-v2-item',
    keyCount: 1,
    keys: [syncKey],
    payload: { [syncKey]: rawValue }
  };
}

async function encryptItem(syncKey, rawValue, { session, securityPassword = '', rememberDevice = true } = {}) {
  await ensureRuntimeSession(session, securityPassword);
  if (securityPassword) runtime.persistKey = Boolean(rememberDevice);
  const password = securityPassword || runtime.securityPassword;
  if (!runtime.deviceKey && !password) throw securityPasswordRequired();
  const encrypted = await encryptSyncItem(buildItemEnvelope(syncKey, rawValue), password, {
    // Always obtain a non-exportable key for the in-memory session. Persistence
    // is controlled separately by rememberDevice and uses IndexedDB.
    deviceKey: runtime.deviceKey,
    cryptoMeta: runtime.cryptoMeta || null
  });
  const publicPayload = publicEncryptedPayload(encrypted);
  if (encrypted.deviceKey) {
    await setRuntimeCrypto({ userId: runtime.userId, deviceKey: encrypted.deviceKey, cryptoMeta: encrypted.crypto, rememberDevice: runtime.persistKey });
  }
  return { encryptedPayload: publicPayload, contentHash: String(publicPayload.meta?.contentHash || '') };
}

async function decryptItem(item, { session, securityPassword = '', rememberDevice = true } = {}) {
  if (!item?.encryptedPayload || item.deletedAt) return { rawValue: null, encryptedEnvelope: null };
  await ensureRuntimeSession(session, securityPassword);
  if (securityPassword) runtime.persistKey = Boolean(rememberDevice);
  const password = securityPassword || runtime.securityPassword;
  const candidates = [];
  if (runtime.deviceKey) candidates.push({ value: runtime.deviceKey, isDeviceKey: true });
  if (password) candidates.push({ value: password, isDeviceKey: false });
  if (!candidates.length) throw securityPasswordRequired();
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const envelope = await decryptSyncItem(item.encryptedPayload, candidate.value);
      if (envelope?.source !== 'ai-dca-sync-v2-item' || !Array.isArray(envelope.keys) || !envelope.keys.includes(item.syncKey)) {
        throw new Error('V2 密文与同步 key 不匹配');
      }
      if (!candidate.isDeviceKey && password) {
        const deviceKey = await deriveDeviceKeyForSyncItem(item.encryptedPayload, password);
        await setRuntimeCrypto({ userId: runtime.userId, securityPassword: password, deviceKey, cryptoMeta: item.encryptedPayload.crypto, rememberDevice: runtime.persistKey });
      }
      return { rawValue: Object.prototype.hasOwnProperty.call(envelope.payload || {}, item.syncKey) ? envelope.payload[item.syncKey] : null, encryptedEnvelope: item.encryptedPayload };
    } catch (error) {
      lastError = error;
      if (candidate.isDeviceKey && error?.code === SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY) {
        // A remembered key is only a hint. Once it fails verification, stop
        // advertising this session as unlocked and let the password path take
        // over (or surface the password dialog when no password was supplied).
        runtime.deviceKey = null;
        runtime.cryptoMeta = null;
        runtime.persistKey = false;
        void clearRememberedV2Key();
      }
    }
  }
  throw lastError || securityPasswordRequired();
}

function localIsDirty(key, meta, localValue) {
  if (runtime.dirtyKeys.has(key)) return true;
  const record = meta.items?.[key];
  if (!record) return localValue != null;
  return String(record.appliedHash || '') !== fingerprint(localValue);
}

function localRecord(meta, key, item, localValue) {
  if (!item) {
    delete meta.items[key];
    return;
  }
  meta.items[key] = {
    revision: Number(item.revision) || 0,
    contentHash: String(item.contentHash || ''),
    updatedAt: String(item.updatedAt || ''),
    clientUpdatedAt: String(item.clientUpdatedAt || ''),
    deletedAt: String(item.deletedAt || ''),
    appliedHash: fingerprint(localValue)
  };
}

function mergeLocalAndRemoteValue(key, remoteValue, localValue, context = {}) {
  if (localValue === remoteValue) return localValue;
  // A delete is an explicit value in V2. During an explicit merge, keep the
  // tombstone instead of resurrecting the other side's stale document.
  if (localValue == null || remoteValue == null) return null;
  try {
    return mergeSyncValues(key, remoteValue, localValue);
  } catch (error) {
    if (error?.code !== 'SYNC_V2_AMBIGUOUS_CONFLICT') throw error;
    throw syncConflictError(
      key,
      context.remoteItem,
      context.meta,
      '该项数据缺少可靠版本信息，无法自动合并，请选择使用本机或云端数据'
    );
  }
}

async function fetchItems(keys, session) {
  if (!keys.length) return new Map();
  const result = await fetchCloudSyncV2Items(keys, session);
  return new Map((Array.isArray(result?.items) ? result.items : [])
    .filter((item) => isV2AccountSyncKey(item?.syncKey))
    .map((item) => [item.syncKey, item]));
}

function remoteSummary(items = []) {
  const list = Array.isArray(items) ? items : [];
  let version = 0;
  let updatedAt = '';
  let keyCount = 0;
  for (const item of list) {
    version = Math.max(version, Number(item?.revision) || 0);
    if (item?.updatedAt && item.updatedAt > updatedAt) updatedAt = item.updatedAt;
    if (!item?.deletedAt) keyCount += 1;
  }
  return { version, updatedAt, keyCount };
}

export async function refreshRemoteCloudMeta(session = loadCloudSession()) {
  const result = await fetchCloudSyncV2Meta(session);
  const items = Array.isArray(result?.items) ? result.items : [];
  return { schemaVersion: SYNC_V2_SCHEMA_VERSION, ...remoteSummary(items), items };
}

export function syncV2EventName(result = {}) {
  if (result?.conflict?.hasConflict || (Array.isArray(result?.conflicts) && result.conflicts.length)) {
    return 'cloud-sync-v2:conflict';
  }
  if (Number(result?.uploaded) > 0) return 'cloud-sync-v2:auto-uploaded';
  if (Number(result?.pulled) > 0 || Number(result?.merged) > 0) return 'cloud-sync-v2:auto-pulled';
  return 'cloud-sync-v2:auto-unchanged';
}

async function putItemWithCas(key, desiredValue, baseItem, { session, securityPassword = '', rememberDevice = true, mode = 'auto', meta = {} } = {}) {
  let value = desiredValue;
  let current = baseItem || null;
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt += 1) {
    const encrypted = await encryptItem(key, value, { session, securityPassword, rememberDevice });
    try {
      const result = await uploadCloudSyncV2Item(key, {
        baseRevision: Number(current?.revision) || 0,
        contentHash: encrypted.contentHash,
        encryptedPayload: encrypted.encryptedPayload,
        clientUpdatedAt: nowIso(),
        deletedAt: value == null ? nowIso() : ''
      }, session);
      return { item: result?.item || current, value, merged: attempt > 0 };
    } catch (error) {
      if (error?.status !== 409) throw error;
      let latest = error?.data?.item || null;
      if (!latest) latest = (await fetchItems([key], session)).get(key) || null;
      if (mode === 'auto') throw syncConflictError(key, latest, meta, '同步期间云端先更新了同一项数据，请选择处理方式');
      if (attempt >= MAX_CAS_RETRIES - 1) throw error;
      if (!latest) {
        if (mode === 'local') {
          current = null;
          continue;
        }
        current = null;
        continue;
      }
      if (mode === 'local') {
        current = latest;
        continue;
      }
      const remoteValue = (await decryptItem(latest, { session, securityPassword, rememberDevice })).rawValue;
      value = mergeLocalAndRemoteValue(key, remoteValue, value, { remoteItem: latest, meta });
      current = latest;
    }
  }
  throw new Error(`同步 key ${key} 的并发重试次数已用尽`);
}

async function processKey(key, { remoteMeta, remoteItems, meta, session, securityPassword, rememberDevice, mode, result }) {
  const localValue = readLocalValue(key);
  const forceLocal = mode === 'local';
  const explicitMerge = mode === 'merge';
  const dirty = forceLocal || localIsDirty(key, meta, localValue);
  const remote = remoteMeta.get(key) || null;

  if (mode === 'remote') {
    if (remote) {
      const remoteValue = (await decryptItem(remoteItems.get(key) || remote, { session, securityPassword, rememberDevice })).rawValue;
      writeLocalValue(key, remoteValue);
      localRecord(meta, key, remote, remoteValue);
      runtime.dirtyKeys.delete(key);
      result.pulledKeys.push(key);
    } else if (localValue != null) {
      writeLocalValue(key, null);
      delete meta.items[key];
      runtime.dirtyKeys.delete(key);
      result.pulledKeys.push(key);
    }
    return;
  }

  if (!remote) {
    // A physically cleared test V2 table has no tombstone to compare against.
    // If this key was previously applied locally and still has a value, treat
    // the missing remote row as a recoverable local change so a normal merge
    // can rebuild the account without requiring force-reupload mode.
    const wasPreviouslyApplied = Boolean(meta.items?.[key]) && localValue != null;
    if (!dirty && !wasPreviouslyApplied) return;
    const saved = await putItemWithCas(key, localValue, null, { session, securityPassword, rememberDevice, mode, meta });
    localRecord(meta, key, saved.item, localValue);
    runtime.dirtyKeys.delete(key);
    result.uploadedKeys.push(key);
    return;
  }

  const needsRemotePayload = dirty || !meta.items?.[key] || Number(meta.items[key].revision) !== Number(remote.revision);
  const remoteItem = needsRemotePayload ? (remoteItems.get(key) || remote) : remote;
  if (!dirty && !needsRemotePayload) return;
  const remoteValue = (await decryptItem(remoteItem, { session, securityPassword, rememberDevice })).rawValue;
  if (!dirty) {
    writeLocalValue(key, remoteValue);
    localRecord(meta, key, remote, remoteValue);
    runtime.dirtyKeys.delete(key);
    result.pulledKeys.push(key);
    return;
  }

  const remoteRevision = Number(remote.revision) || 0;
  const localRevision = Number(meta.items?.[key]?.revision) || 0;
  if (mode === 'auto' && (!meta.items?.[key] || localRevision !== remoteRevision)) {
    throw syncConflictError(key, remote, meta);
  }

  const nextValue = forceLocal
    ? localValue
    : explicitMerge
    ? mergeLocalAndRemoteValue(key, remoteValue, localValue, { remoteItem: remote, meta })
    : localValue;
  if (nextValue === remoteValue) {
    writeLocalValue(key, nextValue);
    localRecord(meta, key, remote, nextValue);
    runtime.dirtyKeys.delete(key);
    result.mergedKeys.push(key);
    return;
  }
  const saved = await putItemWithCas(key, nextValue, remote, { session, securityPassword, rememberDevice, mode, meta });
  writeLocalValue(key, nextValue);
  localRecord(meta, key, saved.item, nextValue);
  runtime.dirtyKeys.delete(key);
  result.uploadedKeys.push(key);
  if (explicitMerge) result.mergedKeys.push(key);
}

function finalizeMeta(meta, remoteMeta, result) {
  const currentItems = Object.values(meta.items || {});
  const summary = remoteSummary(currentItems.map((item, index) => ({
    revision: item.revision,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt,
    syncKey: Object.keys(meta.items || {})[index]
  })));
  const direction = result.conflicts?.length
    ? 'conflict'
    : result.uploadedKeys.length && result.pulledKeys.length
    ? 'merge'
    : result.uploadedKeys.length
    ? 'upload'
    : result.pulledKeys.length
    ? 'pull'
    : 'unchanged';
  return saveMeta(meta, {
    version: Math.max(summary.version, Number(remoteMeta?.version) || 0),
    updatedAt: summary.updatedAt || String(remoteMeta?.updatedAt || ''),
    keyCount: summary.keyCount,
    direction
  });
}

function buildConflictSummary(result, remote, meta) {
  const changedKeys = [...new Set((result.conflicts || []).map((item) => item.key).filter(Boolean))].sort();
  if (!changedKeys.length) return null;
  return {
    hasConflict: true,
    hasChanges: true,
    hasLocalChanges: true,
    remoteVersion: remote.version,
    remoteUpdatedAt: remote.updatedAt,
    remoteKeyCount: remote.keyCount,
    localVersion: Math.max(...Object.values(meta.items || {}).map((item) => Number(item.revision) || 0), 0),
    localUpdatedAt: '',
    localKeyCount: collectV2BackupPayload().keys.length,
    changedKeys,
    autoMergeChangedKeys: [],
    unresolvedChangedKeys: changedKeys,
    autoMergeKeys: [],
    remoteOnlyKeys: [],
    localOnlyKeys: [],
    sameKeyCount: changedKeys.length,
    summaryText: `以下 ${changedKeys.length} 项数据在本机和云端都被修改：${formatSyncKeyNames(changedKeys)}`
  };
}

async function runSync({ session = loadCloudSession(), securityPassword = '', rememberDevice = true, mode = 'auto' } = {}) {
  const userId = await ensureRuntimeSession(session, securityPassword);
  const remote = await refreshRemoteCloudMeta(session);
  const remoteMeta = new Map((remote.items || []).filter((item) => isV2AccountSyncKey(item.syncKey)).map((item) => [item.syncKey, item]));
  const meta = loadLocalMeta(userId);
  if (mode === 'local') {
    for (const key of descriptorKeys()) {
      if (readLocalValue(key) != null || remoteMeta.has(key)) runtime.dirtyKeys.add(key);
    }
  }
  const payloadKeys = descriptorKeys().filter((key) => {
    const remoteItem = remoteMeta.get(key);
    if (!remoteItem) return false;
    if (mode === 'remote' || runtime.dirtyKeys.has(key)) return true;
    return !meta.items?.[key] || Number(meta.items[key].revision) !== Number(remoteItem.revision);
  });
  const remoteItems = await fetchItems(payloadKeys, session);
  const result = { version: remote.version, updatedAt: remote.updatedAt, uploadedKeys: [], pulledKeys: [], mergedKeys: [], conflicts: [] };
  runtime.suppressStorageObservation = true;
  try {
    for (const key of descriptorKeys()) {
      try {
        await processKey(key, { remoteMeta, remoteItems, meta, session, securityPassword, rememberDevice, mode, result });
      } catch (error) {
        if (!error?.isCloudSyncConflict) throw error;
        result.conflicts.push(error.conflict || { key });
      }
    }
  } finally {
    runtime.suppressStorageObservation = false;
  }
  const conflict = buildConflictSummary(result, remote, meta);
  result.conflict = conflict;
  const savedMeta = finalizeMeta(meta, remote, result);
  const saved = savedMeta || {};
  return {
    ...result,
    version: saved.version ?? result.version,
    updatedAt: saved.updatedAt || result.updatedAt,
    keyCount: saved.keyCount ?? 0,
    uploaded: result.uploadedKeys.length,
    pulled: result.pulledKeys.length,
    merged: result.mergedKeys.length,
    conflicts: result.conflicts.length,
    skipped: !result.uploadedKeys.length && !result.pulledKeys.length && !result.conflicts.length
  };
}

export async function syncV2Now(options = {}) {
  const mode = options?.mode || 'auto';
  const explicit = mode === 'local' || mode === 'remote' || mode === 'merge';
  if (!explicit && runtime.inFlight) return runtime.inFlight;
  const scheduled = runtime.queue.catch(() => {}).then(() => runSync({ ...options, mode }));
  runtime.queue = scheduled.catch(() => {});
  if (explicit) return scheduled;
  runtime.inFlight = scheduled.finally(() => {
    if (runtime.inFlight === tracked) runtime.inFlight = null;
  });
  const tracked = runtime.inFlight;
  return tracked;
}

export async function prepareCloudSyncConflict({ securityPassword = '', rememberDevice = true, session = loadCloudSession() } = {}) {
  const userId = await ensureRuntimeSession(session, securityPassword);
  const remote = await refreshRemoteCloudMeta(session);
  const meta = loadLocalMeta(userId);
  const remoteMeta = new Map((remote.items || []).map((item) => [item.syncKey, item]));
  const candidates = descriptorKeys().filter((key) => {
    const localValue = readLocalValue(key);
    const dirty = localIsDirty(key, meta, localValue);
    return dirty || remoteMeta.has(key);
  });
  const remoteItems = await fetchItems(candidates.filter((key) => remoteMeta.has(key)), session);
  const changedKeys = [];
  const localOnlyKeys = [];
  const remoteOnlyKeys = [];
  for (const key of candidates) {
    const localValue = readLocalValue(key);
    const dirty = localIsDirty(key, meta, localValue);
    const remoteItem = remoteMeta.get(key);
    if (!remoteItem) {
      if (dirty) localOnlyKeys.push(key);
      continue;
    }
    const remoteValue = (await decryptItem(remoteItems.get(key) || remoteItem, { session, securityPassword, rememberDevice })).rawValue;
    if (dirty && localValue !== remoteValue) changedKeys.push(key);
    else if (!dirty && localValue === null && remoteValue !== null) remoteOnlyKeys.push(key);
  }
  // A local-only key and a remote-only key are independent edits, not a
  // conflict. Only a key changed on both sides requires the conflict UI.
  const localChanges = changedKeys.slice();
  const parts = [];
  if (changedKeys.length) parts.push(`${changedKeys.length} 项数据在本机和云端都被修改：${formatSyncKeyNames(changedKeys)}`);
  if (localOnlyKeys.length) parts.push(`${localOnlyKeys.length} 项数据仅存在于本机：${formatSyncKeyNames(localOnlyKeys)}`);
  if (remoteOnlyKeys.length) parts.push(`${remoteOnlyKeys.length} 项数据仅存在于云端：${formatSyncKeyNames(remoteOnlyKeys)}`);
  if (!parts.length) parts.push('本机与云端数据一致');
  return {
    hasChanges: Boolean(localChanges.length || remoteOnlyKeys.length),
    hasConflict: Boolean(changedKeys.length),
    hasLocalChanges: Boolean(localChanges.length),
    remoteVersion: remote.version,
    remoteUpdatedAt: remote.updatedAt,
    remoteKeyCount: remote.keyCount,
    localVersion: Math.max(...Object.values(meta.items || {}).map((item) => Number(item.revision) || 0), 0),
    localUpdatedAt: '',
    localKeyCount: collectV2BackupPayload().keys.length,
    changedKeys,
    autoMergeChangedKeys: [],
    unresolvedChangedKeys: changedKeys.slice(),
    autoMergeKeys: [...new Set([...localOnlyKeys, ...remoteOnlyKeys])].sort(),
    remoteOnlyKeys,
    localOnlyKeys,
    sameKeyCount: 0,
    summaryText: parts.join('；')
  };
}

function dispatch(name, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function scheduleAutoSync(delay = 1200) {
  if (typeof window === 'undefined') return;
  window.clearTimeout(runtime.autoTimer);
  runtime.autoTimer = window.setTimeout(() => {
    const session = loadCloudSession();
    if (!session?.accessToken) return;
    dispatch('cloud-sync-v2:auto-upload-started');
    syncV2Now({ session, rememberDevice: true, mode: 'auto' })
      .then((result) => dispatch(syncV2EventName(result), { result }))
      .catch((error) => dispatch('cloud-sync-v2:auto-error', { message: error?.message || String(error), code: error?.code || '' }));
  }, Math.max(0, Number(delay) || 0));
}

export function stopCloudAutoSyncV2() {
  if (runtime.autoTimer != null && typeof window !== 'undefined') window.clearTimeout(runtime.autoTimer);
  if (runtime.autoInterval != null && typeof window !== 'undefined') window.clearInterval(runtime.autoInterval);
  runtime.autoTimer = null;
  runtime.autoInterval = null;
  for (const cleanup of runtime.cleanups.splice(0)) cleanup();
  const original = runtime.originalStorage;
  if (original && typeof window !== 'undefined' && window.Storage?.prototype) {
    const proto = window.Storage.prototype;
    if (proto.setItem === original.patchedSetItem) proto.setItem = original.setItem;
    if (proto.removeItem === original.patchedRemoveItem) proto.removeItem = original.removeItem;
    if (proto.clear === original.patchedClear) proto.clear = original.clear;
  }
  runtime.originalStorage = null;
  runtime.autoStarted = false;
}

export function startCloudAutoSyncV2() {
  if (typeof window === 'undefined' || !window.localStorage || !window.Storage || runtime.autoStarted) return;
  runtime.autoStarted = true;
  const proto = window.Storage.prototype;
  const original = {
    setItem: proto.setItem,
    removeItem: proto.removeItem,
    clear: proto.clear
  };
  function mark(key) {
    if (runtime.suppressStorageObservation || !isV2AccountSyncKey(key)) return;
    runtime.dirtyKeys.add(String(key));
    scheduleAutoSync();
  }
  const patchedSetItem = function patchedSetItem(key, value) {
    const before = this === window.localStorage && isV2AccountSyncKey(key) ? this.getItem(key) : null;
    const result = original.setItem.call(this, key, value);
    if (this === window.localStorage && before !== String(value)) mark(key);
    return result;
  };
  const patchedRemoveItem = function patchedRemoveItem(key) {
    const hadValue = this === window.localStorage && isV2AccountSyncKey(key) && this.getItem(key) != null;
    const result = original.removeItem.call(this, key);
    if (hadValue) mark(key);
    return result;
  };
  const patchedClear = function patchedClear() {
    const hadValues = this === window.localStorage && descriptorKeys().some((key) => this.getItem(key) != null);
    const result = original.clear.call(this);
    if (hadValues) for (const key of descriptorKeys()) mark(key);
    return result;
  };
  proto.setItem = patchedSetItem;
  proto.removeItem = patchedRemoveItem;
  proto.clear = patchedClear;
  runtime.originalStorage = { ...original, patchedSetItem, patchedRemoveItem, patchedClear };

  const onStorage = (event) => {
    if (event?.storageArea && event.storageArea !== window.localStorage) return;
    if (event?.key) mark(event.key);
  };
  const onSession = (event) => {
    const next = event?.detail?.session || loadCloudSession();
    if (!next?.accessToken) {
      clearV2SyncSession();
      return;
    }
    void ensureRuntimeSession(next)
      .then(() => scheduleAutoSync(300))
      .catch(() => {
        // The account menu will surface a malformed session; auto sync stays idle.
      });
  };
  const onVisibility = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') scheduleAutoSync(0);
  };
  const onFocus = () => scheduleAutoSync(0);
  window.addEventListener('storage', onStorage);
  window.addEventListener(CLOUD_SYNC_SESSION_EVENT, onSession);
  window.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  runtime.cleanups.push(
    () => window.removeEventListener('storage', onStorage),
    () => window.removeEventListener(CLOUD_SYNC_SESSION_EVENT, onSession),
    () => window.removeEventListener('visibilitychange', onVisibility),
    () => window.removeEventListener('focus', onFocus)
  );
  runtime.autoInterval = window.setInterval(() => scheduleAutoSync(0), 60000);
  scheduleAutoSync(1500);
}
