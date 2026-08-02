import {
  fetchCloudSyncV2Items,
  fetchCloudSyncV2Meta,
  uploadCloudSyncV2Item
} from '../authClient.js';
import { CLOUD_SYNC_SESSION_EVENT, loadCloudSession } from '../authSession.js';
import {
  decryptSyncItem,
  deriveRawKeyForSyncItem,
  encryptSyncItem,
  SECURE_VAULT_ERROR_CODES
} from '../secureVault.js';
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

const runtime = {
  userId: '',
  securityPassword: '',
  rawKey: '',
  cryptoMeta: null,
  persistKey: false,
  dirtyKeys: new Set(),
  inFlight: null,
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

function rememberedKeyForUser(userId) {
  const parsed = safeJson(storage()?.getItem(SYNC_V2_REMEMBERED_KEY), null);
  if (!parsed?.rawKey || !parsed?.crypto || String(parsed.userId || '') !== String(userId || '')) return null;
  return parsed;
}

function saveRememberedV2Key(userId, rawKey, cryptoMeta) {
  const ls = storage();
  if (!ls || !userId || !rawKey || !cryptoMeta) return;
  ls.setItem(SYNC_V2_REMEMBERED_KEY, JSON.stringify({
    userId,
    rawKey,
    crypto: cryptoMeta,
    savedAt: nowIso()
  }));
}

function clearRememberedV2Key() {
  storage()?.removeItem(SYNC_V2_REMEMBERED_KEY);
}

function setRuntimeCrypto({ userId, securityPassword = '', rawKey = '', cryptoMeta = null, rememberDevice = false } = {}) {
  if (userId) runtime.userId = String(userId);
  if (securityPassword) runtime.securityPassword = String(securityPassword);
  if (rawKey && cryptoMeta) {
    runtime.rawKey = String(rawKey);
    runtime.cryptoMeta = cryptoMeta;
    if (rememberDevice) saveRememberedV2Key(runtime.userId, runtime.rawKey, runtime.cryptoMeta);
    else clearRememberedV2Key();
  }
}

function ensureRuntimeSession(session = loadCloudSession(), securityPassword = '') {
  const userId = sessionUserId(session);
  if (!userId) throw new Error('登录会话缺少 userId，请重新登录');
  if (runtime.userId !== userId) {
    const persistedMeta = safeJson(storage()?.getItem(SYNC_V2_META_KEY), null);
    const previousUserId = String(runtime.userId || persistedMeta?.userId || '').trim();
    if (previousUserId && previousUserId !== userId) clearLocalAccountSyncState();

    runtime.userId = userId;
    runtime.securityPassword = '';
    runtime.rawKey = '';
    runtime.cryptoMeta = null;
    runtime.persistKey = false;
    runtime.dirtyKeys.clear();
    const remembered = rememberedKeyForUser(userId);
    if (remembered) {
      runtime.rawKey = String(remembered.rawKey);
      runtime.cryptoMeta = remembered.crypto;
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
  const remembered = rememberedKeyForUser(userId);
  const sameUser = Boolean(userId && runtime.userId === userId);
  return {
    userId,
    unlocked: Boolean(remembered?.rawKey || (sameUser && (runtime.rawKey || runtime.securityPassword))),
    remembered: Boolean(remembered?.rawKey),
    inMemory: Boolean(sameUser && (runtime.rawKey || runtime.securityPassword))
  };
}

export function clearV2SyncSession({ clearRemembered = true } = {}) {
  clearLocalAccountSyncState();
  runtime.userId = '';
  runtime.securityPassword = '';
  runtime.rawKey = '';
  runtime.cryptoMeta = null;
  runtime.persistKey = false;
  runtime.dirtyKeys.clear();
  if (clearRemembered) clearRememberedV2Key();
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
  ensureRuntimeSession(session, securityPassword);
  if (securityPassword) runtime.persistKey = Boolean(rememberDevice);
  const password = securityPassword || runtime.securityPassword;
  if (!runtime.rawKey && !password) throw securityPasswordRequired();
  const encrypted = await encryptSyncItem(buildItemEnvelope(syncKey, rawValue), password, {
    // Always request the returned DEK for the in-memory session. Persistence is
    // controlled separately by rememberDevice and never sends rememberedKey.
    rememberDevice: true,
    rawKey: runtime.rawKey,
    cryptoMeta: runtime.cryptoMeta || null
  });
  const publicPayload = publicEncryptedPayload(encrypted);
  if (!runtime.rawKey && encrypted.rememberedKey) {
    setRuntimeCrypto({ userId: runtime.userId, rawKey: encrypted.rememberedKey, cryptoMeta: encrypted.crypto, rememberDevice: runtime.persistKey });
  } else if (runtime.rawKey && runtime.cryptoMeta == null) {
    setRuntimeCrypto({ userId: runtime.userId, rawKey: encrypted.rememberedKey || runtime.rawKey, cryptoMeta: encrypted.crypto, rememberDevice: runtime.persistKey });
  } else if (runtime.persistKey && runtime.rawKey && runtime.cryptoMeta) {
    saveRememberedV2Key(runtime.userId, runtime.rawKey, runtime.cryptoMeta);
  }
  return { encryptedPayload: publicPayload, contentHash: String(publicPayload.meta?.contentHash || '') };
}

async function decryptItem(item, { session, securityPassword = '', rememberDevice = true } = {}) {
  if (!item?.encryptedPayload || item.deletedAt) return { rawValue: null, encryptedEnvelope: null };
  ensureRuntimeSession(session, securityPassword);
  if (securityPassword) runtime.persistKey = Boolean(rememberDevice);
  const password = securityPassword || runtime.securityPassword;
  const candidates = [];
  if (runtime.rawKey) candidates.push(`raw:${runtime.rawKey}`);
  if (password) candidates.push(password);
  if (!candidates.length) throw securityPasswordRequired();
  let lastError = null;
  for (const secret of candidates) {
    try {
      const envelope = await decryptSyncItem(item.encryptedPayload, secret);
      if (envelope?.source !== 'ai-dca-sync-v2-item' || !Array.isArray(envelope.keys) || !envelope.keys.includes(item.syncKey)) {
        throw new Error('V2 密文与同步 key 不匹配');
      }
      if (secret !== `raw:${runtime.rawKey}` && password) {
        const rawKey = await deriveRawKeyForSyncItem(item.encryptedPayload, password);
        setRuntimeCrypto({ userId: runtime.userId, securityPassword: password, rawKey, cryptoMeta: item.encryptedPayload.crypto, rememberDevice: runtime.persistKey });
      }
      return { rawValue: Object.prototype.hasOwnProperty.call(envelope.payload || {}, item.syncKey) ? envelope.payload[item.syncKey] : null, encryptedEnvelope: item.encryptedPayload };
    } catch (error) {
      lastError = error;
      if (secret === `raw:${runtime.rawKey}` && error?.code === SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY) {
        // A remembered key is only a hint. Once it fails verification, stop
        // advertising this session as unlocked and let the password path take
        // over (or surface the password dialog when no password was supplied).
        runtime.rawKey = '';
        runtime.cryptoMeta = null;
        runtime.persistKey = false;
        clearRememberedV2Key();
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

function mergeLocalAndRemoteValue(key, remoteValue, localValue) {
  if (localValue === remoteValue) return localValue;
  // A local tombstone is an intentional edit. Preserve it when the same key
  // races with a remote value; a remote tombstone is handled symmetrically.
  if (localValue == null || remoteValue == null) return localValue;
  return mergeSyncValues(key, remoteValue, localValue);
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

async function putItemWithCas(key, desiredValue, baseItem, { session, securityPassword = '', rememberDevice = true } = {}) {
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
      if (error?.status !== 409 || attempt >= MAX_CAS_RETRIES - 1) throw error;
      let latest = error?.data?.item || null;
      if (!latest) latest = (await fetchItems([key], session)).get(key) || null;
      if (!latest) {
        current = null;
        continue;
      }
      const remoteValue = (await decryptItem(latest, { session, securityPassword, rememberDevice })).rawValue;
      value = mergeLocalAndRemoteValue(key, remoteValue, value);
      current = latest;
    }
  }
  throw new Error(`同步 key ${key} 的并发重试次数已用尽`);
}

async function processKey(key, { remoteMeta, remoteItems, meta, session, securityPassword, rememberDevice, mode, result }) {
  const localValue = readLocalValue(key);
  const dirty = mode === 'local' || localIsDirty(key, meta, localValue);
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
    const saved = await putItemWithCas(key, localValue, null, { session, securityPassword, rememberDevice });
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

  const mergedValue = mergeLocalAndRemoteValue(key, remoteValue, localValue);
  if (mergedValue === remoteValue) {
    writeLocalValue(key, mergedValue);
    localRecord(meta, key, remote, mergedValue);
    runtime.dirtyKeys.delete(key);
    result.mergedKeys.push(key);
    return;
  }
  const saved = await putItemWithCas(key, mergedValue, remote, { session, securityPassword, rememberDevice });
  writeLocalValue(key, mergedValue);
  localRecord(meta, key, saved.item, mergedValue);
  runtime.dirtyKeys.delete(key);
  result.uploadedKeys.push(key);
  result.mergedKeys.push(key);
}

function finalizeMeta(meta, remoteMeta, result) {
  const currentItems = Object.values(meta.items || {});
  const summary = remoteSummary(currentItems.map((item, index) => ({
    revision: item.revision,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt,
    syncKey: Object.keys(meta.items || {})[index]
  })));
  const direction = result.uploadedKeys.length && result.pulledKeys.length
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

async function runSync({ session = loadCloudSession(), securityPassword = '', rememberDevice = true, mode = 'merge' } = {}) {
  const userId = ensureRuntimeSession(session, securityPassword);
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
  const result = { version: remote.version, updatedAt: remote.updatedAt, uploadedKeys: [], pulledKeys: [], mergedKeys: [] };
  runtime.suppressStorageObservation = true;
  try {
    for (const key of descriptorKeys()) {
      await processKey(key, { remoteMeta, remoteItems, meta, session, securityPassword, rememberDevice, mode, result });
    }
  } finally {
    runtime.suppressStorageObservation = false;
  }
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
    skipped: !result.uploadedKeys.length && !result.pulledKeys.length
  };
}

export async function syncV2Now(options = {}) {
  if (runtime.inFlight) return runtime.inFlight;
  runtime.inFlight = runSync(options).finally(() => { runtime.inFlight = null; });
  return runtime.inFlight;
}

export async function prepareCloudSyncConflict({ securityPassword = '', rememberDevice = true, session = loadCloudSession() } = {}) {
  const userId = ensureRuntimeSession(session, securityPassword);
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
  if (changedKeys.length) parts.push(`${changedKeys.length} 项同一 key 有本地改动：${changedKeys.join('、')}`);
  if (localOnlyKeys.length) parts.push(`${localOnlyKeys.length} 项仅本机存在：${localOnlyKeys.join('、')}`);
  if (remoteOnlyKeys.length) parts.push(`${remoteOnlyKeys.length} 项仅云端存在：${remoteOnlyKeys.join('、')}`);
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
    autoMergeChangedKeys: changedKeys.slice(),
    unresolvedChangedKeys: [],
    autoMergeKeys: [...new Set([...changedKeys, ...localOnlyKeys, ...remoteOnlyKeys])].sort(),
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
    syncV2Now({ session, rememberDevice: true })
      .then((result) => dispatch(result.uploaded ? 'cloud-sync-v2:auto-uploaded' : 'cloud-sync-v2:auto-pulled', { result }))
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
    try {
      ensureRuntimeSession(next);
      scheduleAutoSync(300);
    } catch {
      // The account menu will surface a malformed session; auto sync stays idle.
    }
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
