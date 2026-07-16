import {
  DERIVED_HOLDINGS_KEYS,
  SYNC_REGISTRY,
  SYNCABLE_STORAGE_KEYS,
  getMergeStrategy,
  isDomainMergeKey,
  serializeSyncResourceValue
} from './syncRegistry.js';
import {
  deleteUserDataResource,
  fetchUserDataManifest,
  fetchUserDataResource,
  fetchSyncV2Snapshot,
  putUserDataResource,
  updateUserDataMigration
} from './authClient.js';
import {
  computeBackupContentHash,
  decryptBackupEnvelope,
  encryptBackupEnvelope,
  loadRememberedKey,
  saveRememberedKey
} from './secureVault.js';
import { getClientId } from './syncClient.js';

export const USER_DATA_CHANGED_EVENT = 'user-data:changed';
export const USER_DATA_MODE_EVENT = 'user-data:mode-changed';
export const USER_DATA_HYDRATION_EVENT = 'user-data:hydration';

const registryByKey = new Map(SYNC_REGISTRY.map((descriptor) => [descriptor.key, descriptor]));
const remoteKeys = new Set(SYNCABLE_STORAGE_KEYS);
const legacyBusinessKeys = new Set(['aiDcaAccountAssignments']);
const USER_DATA_CACHE_VERSION = 1;
const USER_DATA_CACHE_SOURCE = 'ai-dca-user-data-resource-cache';
const USER_DATA_CACHE_KEY_PREFIX = 'aiDcaUserDataCache:';
const USER_DATA_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOGOUT_FLUSH_TIMEOUT_MS = 5000;

function nativeStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch { /* storage is unavailable */ }
  return null;
}

function sessionStorageSafe() {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
    if (globalThis.sessionStorage) return globalThis.sessionStorage;
  } catch { /* session storage is unavailable */ }
  return null;
}

function dispatch(type, detail = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

function reportHydrationProgress(userId, detail = {}) {
  const progress = Number(detail.progress);
  dispatch(USER_DATA_HYDRATION_EVENT, {
    complete: false,
    userId: String(userId || ''),
    ...detail,
    ...(Number.isFinite(progress) ? { progress: Math.min(Math.max(progress, 0), 99) } : {})
  });
}

function stringify(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function parse(value) {
  if (value == null) return null;
  try { return JSON.parse(value); } catch { return value; }
}

function idFor(value = '') {
  return String(value || '').trim();
}

function recordsById(remote = [], local = []) {
  const map = new Map();
  for (const item of Array.isArray(remote) ? remote : []) {
    if (item && typeof item === 'object' && item.id != null) map.set(String(item.id), item);
  }
  for (const item of Array.isArray(local) ? local : []) {
    if (item && typeof item === 'object' && item.id != null && !map.has(String(item.id))) map.set(String(item.id), item);
  }
  return [...map.values()];
}

function mergeValue(key, remoteRaw, localRaw) {
  if (localRaw == null) return remoteRaw;
  if (remoteRaw == null) return localRaw;
  const strategy = getMergeStrategy(key);
  if (strategy === 'lww') return remoteRaw;
  const remote = parse(remoteRaw);
  const local = parse(localRaw);
  if (strategy === 'arrayById' && Array.isArray(remote) && Array.isArray(local)) return JSON.stringify(recordsById(remote, local));
  if ((strategy === 'planStore' || strategy === 'dcaStore') && remote && local && typeof remote === 'object' && typeof local === 'object') {
    const activeKey = strategy === 'dcaStore' ? 'activeDcaId' : 'activePlanId';
    const plans = recordsById(remote.plans, local.plans);
    const activeId = plans.some((item) => String(item.id) === String(remote[activeKey] || ''))
      ? remote[activeKey]
      : (plans[0]?.id || '');
    return JSON.stringify({ ...remote, plans, [activeKey]: activeId });
  }
  if (strategy === 'holdingsLedger' && remote && local && typeof remote === 'object' && typeof local === 'object') {
    return serializeSyncResourceValue(key, JSON.stringify({
      transactions: recordsById(remote.transactions, local.transactions)
    }));
  }
  if (strategy === 'watchlist' && remote && local && typeof remote === 'object' && typeof local === 'object') {
    const remoteLists = Array.isArray(remote.lists) ? remote.lists : [];
    const localLists = Array.isArray(local.lists) ? local.lists : [];
    const lists = recordsById(remoteLists, localLists).map((list) => {
      const other = localLists.find((item) => String(item?.id) === String(list?.id));
      return other ? {
        ...list,
        us: [...new Set([...(list.us || []), ...(other.us || [])])],
        cn: [...new Set([...(list.cn || []), ...(other.cn || [])])]
      } : list;
    });
    return JSON.stringify({ ...remote, lists });
  }
  if (strategy === 'objectMerge' && remote && local && typeof remote === 'object' && typeof local === 'object') {
    return JSON.stringify({ ...remote, ...local });
  }
  return remoteRaw;
}

function resourceEnvelope(key, raw) {
  const serialized = serializeSyncResourceValue(key, raw);
  return {
    version: 1,
    source: 'ai-dca-secure-sync',
    exportedAt: new Date().toISOString(),
    keyCount: 1,
    keys: [key],
    payload: { [key]: serialized }
  };
}

function localSnapshot() {
  const storage = nativeStorage();
  const entries = {};
  if (!storage) return { entries, keys: [] };
  for (const key of remoteKeys) {
    const value = storage.getItem(key);
    if (value === null) continue;
    // 通知后台启动时会为 WebSocket 生成 clientId/secret，但没有配置任何
    // 通知渠道。这类设备身份不是用户业务数据，不应阻塞登录合并选择。
    if (key === 'aiDcaNotifyClientConfig') {
      try {
        const config = JSON.parse(value);
        if (!config?.barkDeviceKey && !config?.serverChan3Uid && !config?.serverChan3SendKey) continue;
      } catch { /* malformed local data remains visible for explicit handling */ }
    }
    entries[key] = serializeSyncResourceValue(key, value);
  }
  return { entries, keys: Object.keys(entries).sort() };
}

function userDataCacheKey(userId) {
  return `${USER_DATA_CACHE_KEY_PREFIX}${encodeURIComponent(String(userId || ''))}`;
}

function normalizedManifestRows(manifest = {}) {
  return (Array.isArray(manifest.resources) ? manifest.resources : [])
    .map((row) => {
      const resourceId = idFor(row?.resourceId || row?.resource);
      if (!remoteKeys.has(resourceId)) return null;
      const contentHash = String(row?.contentHash || '');
      return {
        resourceId,
        revision: Number(row?.revision) || 0,
        schemaVersion: Number(row?.schemaVersion) || 1,
        contentHash,
        updatedAt: contentHash ? '' : String(row?.updatedAt || ''),
        deleted: Boolean(row?.deleted),
        bytes: contentHash ? 0 : Number(row?.bytes) || 0
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.resourceId.localeCompare(right.resourceId));
}

function legacyManifestSignature(manifest = {}) {
  const meta = manifest.legacySnapshotMeta || {};
  return manifest.legacySnapshot ? {
    present: true,
    version: Number(meta.version) || 0,
    updatedAt: String(meta.updatedAt || ''),
    contentHash: String(meta.contentHash || ''),
    keyCount: Number(meta.keyCount) || 0,
    bytes: Number(meta.bytes) || 0
  } : { present: false };
}

function manifestRowIdentity(row = {}) {
  const normalized = {
    resourceId: idFor(row?.resourceId || row?.resource),
    schemaVersion: Number(row?.schemaVersion) || 1,
    contentHash: String(row?.contentHash || ''),
    deleted: Boolean(row?.deleted)
  };
  if (normalized.contentHash) return normalized;
  return {
    ...normalized,
    revision: Number(row?.revision) || 0,
    updatedAt: String(row?.updatedAt || ''),
    bytes: Number(row?.bytes) || 0
  };
}

async function computeUserDataManifestHash(manifest = {}) {
  const signature = {
    // revision is a CAS cursor, not content identity. A revision can advance
    // without changing the resource bytes, so keep it out when contentHash is
    // available.
    resources: normalizedManifestRows(manifest).map(manifestRowIdentity),
    legacy: legacyManifestSignature(manifest),
    migration: {
      status: String(manifest.migration?.status || ''),
      sourceHash: String(manifest.migration?.sourceHash || '')
    }
  };
  return computeBackupContentHash({
    version: USER_DATA_CACHE_VERSION,
    keyCount: 1,
    keys: ['manifest'],
    payload: { manifest: JSON.stringify(signature) }
  });
}

function isEncryptedResource(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.source === 'ai-dca-secure-sync'
    && typeof value.ciphertext === 'string'
    && value.ciphertext
    && value.crypto
    && typeof value.crypto === 'object'
  );
}

function readUserDataCache(userId, manifestHash, manifest) {
  const storage = sessionStorageSafe();
  if (!storage) return null;
  try {
    const cache = JSON.parse(storage.getItem(userDataCacheKey(userId)) || 'null');
    if (!cache || cache.version !== USER_DATA_CACHE_VERSION || cache.source !== USER_DATA_CACHE_SOURCE) return null;
    if (String(cache.userId || '') !== String(userId || '') || String(cache.manifestHash || '') !== String(manifestHash || '')) return null;
    const savedAt = Date.parse(String(cache.savedAt || ''));
    if (!Number.isFinite(savedAt) || savedAt > Date.now() || Date.now() - savedAt > USER_DATA_CACHE_MAX_AGE_MS) return null;
    const rows = normalizedManifestRows(manifest);
    if (!Array.isArray(cache.resources) || cache.resources.length !== rows.length) return null;
    const cachedByKey = new Map(cache.resources.map((row) => [String(row?.resourceId || ''), row]));
    if (cachedByKey.size !== rows.length || [...cachedByKey.keys()].some((key) => !remoteKeys.has(key))) return null;
    for (const row of rows) {
      const cached = cachedByKey.get(row.resourceId);
      if (!cached || JSON.stringify(manifestRowIdentity(cached)) !== JSON.stringify(manifestRowIdentity(row))) return null;
      if (!row.deleted && !isEncryptedResource(cached.encrypted)) return null;
      if (row.deleted && cached.encrypted != null) return null;
    }
    if (manifest.legacySnapshot && !isEncryptedResource(cache.legacy?.encryptedEnvelope)) return null;
    if (!manifest.legacySnapshot && cache.legacy != null) return null;
    return cache;
  } catch {
    return null;
  }
}

function writeUserDataCache(userId, manifestHash, resources, legacyEncryptedEnvelope = null) {
  const storage = sessionStorageSafe();
  if (!storage) return;
  try {
    storage.setItem(userDataCacheKey(userId), JSON.stringify({
      version: USER_DATA_CACHE_VERSION,
      source: USER_DATA_CACHE_SOURCE,
      userId: String(userId || ''),
      manifestHash: String(manifestHash || ''),
      savedAt: new Date().toISOString(),
      resources,
      legacy: legacyEncryptedEnvelope ? { encryptedEnvelope: legacyEncryptedEnvelope } : null
    }));
  } catch { /* quota/private mode: remote fetch remains the source of truth */ }
}

function clearUserDataCache(userId) {
  if (!userId) return;
  try { sessionStorageSafe()?.removeItem(userDataCacheKey(userId)); } catch { /* ignore storage failures */ }
}

async function decryptLegacyEnvelope(encrypted, { securityPassword = '', remembered = null, cryptoState, decrypt }) {
  let envelope;
  try {
    const rememberedRawKey = remembered?.rawKey || cryptoState.rawKey || '';
    const legacyRawKey = Number(encrypted.version) < 3 ? rememberedRawKey : (securityPassword ? '' : rememberedRawKey);
    try {
      envelope = await decrypt(encrypted, securityPassword, legacyRawKey);
    } catch (firstError) {
      if (Number(encrypted.version) < 3 && securityPassword && legacyRawKey) {
        envelope = await decrypt(encrypted, securityPassword, '');
      } else {
        throw firstError;
      }
    }
  } catch (error) {
    if (!securityPassword && Number(encrypted.version) < 3) {
      throw Object.assign(new Error('旧设备备份需要安全密码重新加密后才能迁移'), { code: 'SECURITY_PASSWORD_REQUIRED' });
    }
    throw error;
  }
  if (!cryptoState.rawKey && encrypted.rememberedKey) cryptoState.rawKey = encrypted.rememberedKey;
  if (encrypted.crypto) cryptoState.cryptoMeta = encrypted.crypto;
  const canReuseV3Key = Number(encrypted.version) === 3 && Boolean(encrypted.crypto?.wrappedDek);
  if (!canReuseV3Key) {
    cryptoState.rawKey = '';
    cryptoState.cryptoMeta = {};
  }
  return { envelope, legacyNeedsUpgradePassword: !canReuseV3Key };
}

function localDataOwnerId() {
  try {
    const raw = nativeStorage()?.getItem('aiDcaCloudSyncMeta');
    const parsed = raw ? JSON.parse(raw) : null;
    return String(parsed?.userId || '').trim();
  } catch {
    return '';
  }
}

function normalizeRemoteResourceValue(key, raw) {
  return serializeSyncResourceValue(key, raw);
}

function rememberLocalDataOwner(userId) {
  const storage = nativeStorage();
  if (!storage) return;
  try {
    const previous = JSON.parse(storage.getItem('aiDcaCloudSyncMeta') || '{}');
    storage.setItem('aiDcaCloudSyncMeta', JSON.stringify({ ...previous, userId: String(userId || ''), syncMode: 'resource', updatedAt: new Date().toISOString() }));
  } catch { /* metadata is advisory; business data remains authoritative */ }
}

export class UserDataStore {
  constructor() {
    this.mode = 'anonymous';
    this.userId = '';
    this.session = null;
    this.values = new Map();
    this.revisions = new Map();
    this.pending = new Map();
    this.inflight = new Map();
    this.commitQueues = new Map();
    this.hydrated = true;
    this.crypto = { securityPassword: '', rawKey: '', cryptoMeta: {}, rememberDevice: true };
  }

  isAuthenticated() { return this.mode === 'remote' && Boolean(this.session?.accessToken); }

  getItem(key) {
    const id = idFor(key);
    if (this.mode === 'remote' && remoteKeys.has(id)) return this.values.has(id) ? this.values.get(id) : null;
    return nativeStorage()?.getItem(id) ?? null;
  }

  setItem(key, value, options = {}) {
    const id = idFor(key);
    const next = String(value);
    if (this.mode === 'remote' && remoteKeys.has(id)) {
      const previous = this.values.get(id);
      if (previous === next) return;
      this.values.set(id, next);
      const previousSyncValue = serializeSyncResourceValue(id, previous);
      const nextSyncValue = serializeSyncResourceValue(id, next);
      if (previousSyncValue === nextSyncValue) {
        dispatch(USER_DATA_CHANGED_EVENT, { key: id, value: next, previous, remote: true, derivedOnly: true });
        return;
      }
      dispatch(USER_DATA_CHANGED_EVENT, { key: id, value: next, previous, remote: true });
      if (options.persist !== false) this.scheduleCommit(id, { ...options, previous });
      return;
    }
    nativeStorage()?.setItem(id, next);
    dispatch(USER_DATA_CHANGED_EVENT, { key: id, value: next, remote: false });
  }

  removeItem(key, options = {}) {
    const id = idFor(key);
    if (this.mode === 'remote' && remoteKeys.has(id)) {
      if (!this.values.has(id)) return;
      const previous = this.values.get(id);
      this.values.delete(id);
      dispatch(USER_DATA_CHANGED_EVENT, { key: id, previous, removed: true, remote: true });
      if (options.persist !== false) this.scheduleCommit(id, { ...options, deleted: true, previous });
      return;
    }
    nativeStorage()?.removeItem(id);
    dispatch(USER_DATA_CHANGED_EVENT, { key: id, removed: true, remote: false });
  }

  key(index) {
    const storage = nativeStorage();
    const keys = this.mode === 'remote'
      ? [...this.values.keys(), ...(storage ? Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key) => !remoteKeys.has(key)) : [])]
      : (storage ? Array.from({ length: storage.length }, (_, i) => storage.key(i)) : []);
    return keys[index] || null;
  }

  get length() { return this.mode === 'remote' ? this.values.size : (nativeStorage()?.length || 0); }

  captureAnonymousSnapshot() { return localSnapshot(); }

  snapshot() {
    const entries = Object.fromEntries(this.values.entries());
    return { entries, keys: Object.keys(entries).sort() };
  }

  clearLocalBusinessData() {
    const storage = nativeStorage();
    if (!storage) return [];
    const failedKeys = [];
    for (const key of [...remoteKeys, ...DERIVED_HOLDINGS_KEYS, ...legacyBusinessKeys]) {
      try {
        storage.removeItem(key);
        if (storage.getItem(key) !== null) failedKeys.push(key);
      } catch {
        failedKeys.push(key);
      }
    }
    return failedKeys;
  }

  setAnonymous() {
    const previousUserId = this.userId;
    this.flushPending({ rejectOnError: false }).catch(() => {});
    clearUserDataCache(previousUserId);
    this.mode = 'anonymous';
    this.userId = '';
    this.session = null;
    this.values.clear();
    this.revisions.clear();
    this.pending.clear();
    this.hydrated = true;
    dispatch(USER_DATA_MODE_EVENT, { mode: 'anonymous' });
  }

  async decryptResource(encrypted, securityPassword, rawKey) {
    return decryptBackupEnvelope(encrypted, rawKey ? `raw:${rawKey}` : securityPassword);
  }

  async fetchRemote(session, securityPassword = '', remembered = null) {
    const userId = String(session?.userId || '');
    reportHydrationProgress(userId, {
      stage: 'manifest',
      progress: 10,
      message: '正在读取云端数据清单…'
    });
    const manifest = await fetchUserDataManifest(session, getClientId());
    const values = new Map();
    const revisions = new Map();
    const legacyKeys = new Set();
    let legacyNeedsUpgradePassword = false;
    const cryptoState = { securityPassword, rawKey: remembered?.rawKey || '', cryptoMeta: remembered?.crypto || {}, rememberDevice: true };
    const rows = Array.isArray(manifest?.resources) ? manifest.resources : [];
    const validRows = rows.filter((row) => remoteKeys.has(idFor(row?.resourceId || row?.resource)));
    const hasLegacySnapshot = Boolean(manifest?.legacySnapshot);
    const manifestHash = await computeUserDataManifestHash(manifest);
    const cached = readUserDataCache(userId, manifestHash, manifest);
    const manifestRows = new Map(normalizedManifestRows(manifest).map((row) => [row.resourceId, row]));
    const totalResources = validRows.length + (hasLegacySnapshot ? 1 : 0);
    let completedResources = 0;
    const fetchedResources = [];
    let legacyEncryptedEnvelope = null;
    const resourceProgress = () => hasLegacySnapshot
      ? 15 + Math.round((completedResources / Math.max(totalResources, 1)) * 50)
      : 15 + Math.round((completedResources / Math.max(totalResources, 1)) * 55);
    reportHydrationProgress(userId, {
      stage: 'resources',
      progress: totalResources ? 15 : 70,
      current: completedResources,
      total: totalResources,
      message: totalResources ? `发现 ${totalResources} 项云端数据，准备逐项恢复…` : '云端暂无业务数据，正在完成初始化…'
    });
    const applyLegacy = async (encrypted) => {
      const decoded = await decryptLegacyEnvelope(encrypted, {
        securityPassword,
        remembered,
        cryptoState,
        decrypt: (value, password, rawKey) => this.decryptResource(value, password, rawKey)
      });
      for (const [key, raw] of Object.entries(decoded.envelope?.payload || {})) {
        if (!remoteKeys.has(key) || values.has(key) || raw == null) continue;
        values.set(key, normalizeRemoteResourceValue(key, raw));
        legacyKeys.add(key);
        revisions.set(key, Number(revisions.get(key)) || 0);
      }
      if (decoded.legacyNeedsUpgradePassword) legacyNeedsUpgradePassword = true;
    };
    if (cached) {
      try {
        reportHydrationProgress(userId, {
          stage: 'resources',
          progress: totalResources ? 15 : 70,
          current: completedResources,
          total: totalResources,
          message: '云端 hash 未变化，正在使用本地加密缓存…'
        });
        const cachedByKey = new Map(cached.resources.map((row) => [String(row.resourceId), row]));
        for (const row of validRows) {
          const key = idFor(row?.resourceId || row?.resource);
          const cachedResource = cachedByKey.get(key);
          revisions.set(key, Number(row.revision) || 0);
          if (!row.deleted) {
            const envelope = await this.decryptResource(cachedResource.encrypted, securityPassword, cryptoState.rawKey);
            const value = envelope?.payload?.[key];
            if (value !== undefined && value !== null) values.set(key, normalizeRemoteResourceValue(key, value));
            if (!cryptoState.rawKey && cachedResource.encrypted.rememberedKey) cryptoState.rawKey = cachedResource.encrypted.rememberedKey;
            if (cachedResource.encrypted.crypto) cryptoState.cryptoMeta = cachedResource.encrypted.crypto;
          }
          completedResources += 1;
          reportHydrationProgress(userId, {
            stage: 'resources',
            progress: resourceProgress(),
            current: completedResources,
            total: totalResources,
            message: `正在恢复云端数据（${completedResources}/${totalResources}）`
          });
        }
        if (hasLegacySnapshot) {
          reportHydrationProgress(userId, {
            stage: 'legacy',
            progress: 72,
            current: completedResources,
            total: totalResources,
            message: '云端 hash 未变化，正在使用本地旧版备份缓存…'
          });
          await applyLegacy(cached.legacy.encryptedEnvelope);
          completedResources += 1;
          reportHydrationProgress(userId, {
            stage: 'resources',
            progress: 75,
            current: completedResources,
            total: totalResources,
            message: `正在恢复云端数据（${completedResources}/${totalResources}）`
          });
        }
        return { manifest, values, revisions, cryptoState, legacyKeys: [...legacyKeys], legacyNeedsUpgradePassword, cacheHit: true };
      } catch {
        clearUserDataCache(userId);
      }
    }
    for (const row of rows) {
      const key = idFor(row?.resourceId || row?.resource);
      if (!remoteKeys.has(key)) continue;
      revisions.set(key, Number(row.revision) || 0);
      if (row.deleted) {
        fetchedResources.push({ ...manifestRows.get(key), encrypted: null });
        completedResources += 1;
        reportHydrationProgress(userId, {
          stage: 'resources',
          progress: resourceProgress(),
          current: completedResources,
          total: totalResources,
          message: `正在恢复云端数据（${completedResources}/${totalResources}）`
        });
        continue;
      }
      const resource = await fetchUserDataResource(key, session);
      if (resource?.code === 'RESOURCE_NOT_PROPAGATED') throw Object.assign(new Error(resource.message || '云端资源正在传播，请稍后重试'), { code: resource.code, retryable: true });
      if (!resource?.encrypted) {
        fetchedResources.push({ ...manifestRows.get(key), encrypted: null });
        completedResources += 1;
        reportHydrationProgress(userId, {
          stage: 'resources',
          progress: resourceProgress(),
          current: completedResources,
          total: totalResources,
          message: `正在恢复云端数据（${completedResources}/${totalResources}）`
        });
        continue;
      }
      const envelope = await this.decryptResource(resource.encrypted, securityPassword, cryptoState.rawKey);
      fetchedResources.push({ ...manifestRows.get(key), encrypted: resource.encrypted });
      const value = envelope?.payload?.[key];
      if (value !== undefined && value !== null) values.set(key, normalizeRemoteResourceValue(key, value));
      if (!cryptoState.rawKey && resource.encrypted.rememberedKey) cryptoState.rawKey = resource.encrypted.rememberedKey;
      if (resource.encrypted.crypto) cryptoState.cryptoMeta = resource.encrypted.crypto;
      completedResources += 1;
      reportHydrationProgress(userId, {
        stage: 'resources',
        progress: resourceProgress(),
        current: completedResources,
        total: totalResources,
        message: `正在恢复云端数据（${completedResources}/${totalResources}）`
      });
    }
    if (manifest?.legacySnapshot) {
      reportHydrationProgress(userId, {
        stage: 'legacy',
        progress: 72,
        current: completedResources,
        total: totalResources,
        message: '正在读取兼容的旧版云端备份…'
      });
      const legacy = await fetchSyncV2Snapshot({ deviceId: getClientId() }, session);
      const encrypted = legacy?.encryptedEnvelope;
      if (!encrypted) {
        throw Object.assign(new Error('旧云端备份暂时读取不到，请稍后重试；不会按空数据处理'), { code: 'LEGACY_SNAPSHOT_UNAVAILABLE', retryable: true });
      }
      legacyEncryptedEnvelope = encrypted;
      await applyLegacy(encrypted);
      completedResources += 1;
      reportHydrationProgress(userId, {
        stage: 'resources',
        progress: 75,
        current: completedResources,
        total: totalResources,
        message: `正在恢复云端数据（${completedResources}/${totalResources}）`
      });
    }
    if (fetchedResources.length === validRows.length && fetchedResources.every((row) => row.deleted || isEncryptedResource(row.encrypted))) {
      writeUserDataCache(userId, manifestHash, fetchedResources, legacyEncryptedEnvelope);
    }
    return { manifest, values, revisions, cryptoState, legacyKeys: [...legacyKeys], legacyNeedsUpgradePassword, cacheHit: false };
  }

  async encryptResource(key, raw, cryptoState) {
    const encrypted = await encryptBackupEnvelope(resourceEnvelope(key, raw), cryptoState.securityPassword, {
      rawKey: cryptoState.rawKey,
      cryptoMeta: cryptoState.cryptoMeta,
      rememberDevice: cryptoState.rememberDevice
    });
    if (!cryptoState.rawKey && encrypted.rememberedKey) {
      cryptoState.rawKey = encrypted.rememberedKey;
      cryptoState.cryptoMeta = encrypted.crypto;
      if (cryptoState.rememberDevice) saveRememberedKey(encrypted.rememberedKey, {
        userId: this.userId,
        username: this.session?.username || '',
        crypto: encrypted.crypto
      });
    }
    return encrypted;
  }

  async putRemote(key, raw, { deleted = false, retries = 0 } = {}) {
    const id = idFor(key);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw Object.assign(new Error('当前处于离线状态，登录用户数据不会提交'), { code: 'OFFLINE', retryable: true });
    }
    const baseRevision = Number(this.revisions.get(id)) || 0;
    const cryptoLike = globalThis.crypto;
    const randomPart = typeof cryptoLike?.randomUUID === 'function'
      ? cryptoLike.randomUUID()
      : Array.from(cryptoLike.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const mutationId = `${getClientId()}:${Date.now().toString(36)}:${randomPart}`;
    const encrypted = deleted ? null : await this.encryptResource(id, raw, this.crypto);
    try {
      const result = deleted
        ? await deleteUserDataResource(id, { baseRevision, mutationId, schemaVersion: 1 }, this.session)
        : await putUserDataResource(id, { baseRevision, mutationId, schemaVersion: 1, contentHash: await computeBackupContentHash(resourceEnvelope(id, raw)), encrypted }, this.session);
      this.revisions.set(id, Number(result.revision) || baseRevision + 1);
      return result;
    } catch (error) {
      if ((error?.status === 409 || error?.data?.code === 'RESOURCE_REVISION_MISMATCH') && retries < 3) {
        const remote = await this.fetchRemote(this.session, this.crypto.securityPassword, this.crypto.rawKey ? { rawKey: this.crypto.rawKey, crypto: this.crypto.cryptoMeta } : null);
        const remoteRaw = remote.values.get(id);
        const merged = deleted ? remoteRaw : mergeValue(id, remoteRaw, raw);
        this.revisions = remote.revisions;
        if (merged == null) {
          this.values.delete(id);
          return remote;
        }
        this.values.set(id, merged);
        return this.putRemote(id, merged, { retries: retries + 1 });
      }
      throw error;
    }
  }

  scheduleCommit(key, options = {}) {
    const previous = this.pending.get(key);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.commit(key, options).catch((error) => dispatch(USER_DATA_CHANGED_EVENT, { key, error, saveFailed: true }));
    }, options.delay ?? 600);
    this.pending.set(key, { timer, options });
  }

  commit(key, options = {}) {
    const id = idFor(key);
    const previousCommit = this.commitQueues.get(id) || Promise.resolve();
    const queued = previousCommit
      .catch(() => {})
      .then(() => this.commitNow(id, options));
    const tracked = queued.finally(() => {
      if (this.commitQueues.get(id) === tracked) this.commitQueues.delete(id);
      if (this.inflight.get(id) === tracked) this.inflight.delete(id);
    });
    this.commitQueues.set(id, tracked);
    this.inflight.set(id, tracked);
    return tracked;
  }

  async commitNow(key, options = {}) {
    if (!this.isAuthenticated()) return { skipped: true };
    const value = this.values.get(key);
    const request = this.putRemote(key, value, { deleted: options.deleted || value == null });
    try {
      const result = await request;
      dispatch(USER_DATA_CHANGED_EVENT, { key, saved: true, result });
      return result;
    } catch (error) {
      // A newer local edit may already be queued while this request was in
      // flight. Only roll back the value that this commit actually sent.
      if (this.values.get(key) === value) {
        if (options.previous === undefined) this.values.delete(key);
        else this.values.set(key, options.previous);
      }
      dispatch(USER_DATA_CHANGED_EVENT, { key, error, saveFailed: true, rolledBack: true });
      throw error;
    }
  }

  async flushPending({ rejectOnError = true } = {}) {
    const errors = [];
    const pending = [...this.pending.entries()];
    for (const [key, item] of pending) {
      clearTimeout(item.timer);
      this.pending.delete(key);
      try {
        await this.commit(key, item.options);
      } catch (error) {
        if (rejectOnError) throw error;
        errors.push({ key, error });
      }
    }
    const inflight = [...this.inflight.entries()];
    if (inflight.length) {
      if (rejectOnError) {
        await Promise.all(inflight.map(([, request]) => request));
      } else {
        const results = await Promise.allSettled(inflight.map(([, request]) => request));
        results.forEach((result, index) => {
          if (result.status === 'rejected') errors.push({ key: inflight[index][0], error: result.reason });
        });
      }
    }
    return errors;
  }

  async startSession(session, { action = 'login', securityPassword = '', rememberDevice = true, decision = '' } = {}) {
    if (!session?.accessToken) throw Object.assign(new Error('请先登录账户'), { code: 'AUTH_REQUIRED' });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw Object.assign(new Error('登录用户需要联网完成数据水合'), { code: 'OFFLINE' });
    this.hydrated = false;
    const userId = String(session.userId || '');
    reportHydrationProgress(userId, {
      stage: 'connecting',
      progress: 5,
      message: '正在确认账号并连接云端…'
    });
    const local = this.captureAnonymousSnapshot();
    const localOwnerId = localDataOwnerId();
    const foreignLocalData = Boolean(localOwnerId && String(localOwnerId) !== String(session.userId || ''));
    const remembered = loadRememberedKey({ userId: session.userId, username: session.username });
    const remote = await this.fetchRemote(session, securityPassword, remembered);
    const hasLocal = local.keys.length > 0;
    const hasRemote = remote.values.size > 0;
    const hasRemoteHead = Boolean(normalizedManifestRows(remote.manifest).some((row) => Number(row?.revision) > 0));
    const remoteHasData = hasRemote || hasRemoteHead;
    // 同一设备迁移中断后，服务端会保留 collecting 状态；允许按断点继续，
    // 其它设备仍保持显式选择，避免把另一台匿名设备的数据静默覆盖到账号。
    const effectiveDecision = decision || (action === 'login' && hasLocal && remoteHasData && !foreignLocalData && remote.manifest?.migration?.status === 'collecting' ? 'merge' : '');
    if ((action === 'login' || action === 'register') && hasLocal && (remoteHasData || foreignLocalData) && !effectiveDecision) {
      const error = new Error('发现本机未归属数据，请选择合并或仅使用云端');
      error.code = 'LOCAL_DATA_DECISION_REQUIRED';
      error.summary = { localKeys: local.keys, remoteKeys: [...remote.values.keys()], foreignOwner: foreignLocalData, ownerId: localOwnerId };
      throw error;
    }
    if (foreignLocalData && effectiveDecision === 'merge') {
      throw Object.assign(new Error('本机数据属于其它账号，不能自动合并；请选择仅使用云端或取消登录'), { code: 'FOREIGN_LOCAL_DATA', ownerId: localOwnerId });
    }
    let values = remote.values;
    if (action === 'register' || effectiveDecision === 'merge' || (hasLocal && !remoteHasData)) {
      values = new Map(remote.values);
      for (const key of local.keys) values.set(key, mergeValue(key, remote.values.get(key), local.entries[key]));
    }
    values = new Map([...values.entries()].map(([key, value]) => [key, normalizeRemoteResourceValue(key, value)]));
    const legacyKeys = new Set(remote.legacyKeys || []);
    if (remote.legacyNeedsUpgradePassword && legacyKeys.size > 0 && !String(securityPassword || '')) {
      throw Object.assign(new Error('旧设备备份需要安全密码重新加密后才能迁移'), { code: 'SECURITY_PASSWORD_REQUIRED' });
    }
    const shouldMigrate = action === 'register' || effectiveDecision === 'merge' || effectiveDecision === 'cloud' || (hasLocal && !remoteHasData) || legacyKeys.size > 0;
    const sourceEnvelope = { version: 1, keyCount: local.keys.length, keys: local.keys, payload: local.entries };
    const sourceHash = await computeBackupContentHash(sourceEnvelope);
    this.mode = 'remote';
    this.userId = String(session.userId || '');
    this.session = session;
    this.values = values;
    this.revisions = remote.revisions;
    this.crypto = { ...remote.cryptoState, securityPassword, rememberDevice };
    try {
      if (shouldMigrate) {
        const migrationTotal = values.size;
        let migrationCurrent = 0;
        reportHydrationProgress(userId, {
          stage: 'migration',
          progress: 80,
          current: migrationCurrent,
          total: migrationTotal,
          message: migrationTotal ? '正在合并并保存本机数据…' : '正在完成云端数据接入…'
        });
        await updateUserDataMigration({ deviceId: getClientId(), action: 'begin', sourceHash, localSignature: sourceHash }, session);
        for (const key of values.keys()) {
          const shouldUpload = legacyKeys.has(key) || action === 'register' || effectiveDecision === 'merge' || (!remoteHasData && local.entries[key] != null);
          if (!shouldUpload || (local.entries[key] == null && !legacyKeys.has(key)) || (values.get(key) === remote.values.get(key) && !legacyKeys.has(key))) {
            migrationCurrent += 1;
            reportHydrationProgress(userId, {
              stage: 'migration',
              progress: 80 + Math.round((migrationCurrent / Math.max(migrationTotal, 1)) * 18),
              current: migrationCurrent,
              total: migrationTotal,
              message: `正在处理本机数据（${migrationCurrent}/${migrationTotal}）`
            });
            continue;
          }
          const result = await this.putRemote(key, values.get(key));
          const manifest = await fetchUserDataManifest(session, getClientId());
          const row = (manifest?.resources || []).find((item) => String(item.resourceId) === key);
          if (!row || Number(row.revision) !== Number(result.revision) || String(row.contentHash || '') !== String(result.contentHash || '')) {
            throw Object.assign(new Error(`资源 ${key} 迁移校验失败，请重试`), { code: 'MIGRATION_VERIFY_FAILED', resourceId: key, retryable: true });
          }
          await updateUserDataMigration({ deviceId: getClientId(), action: 'checkpoint', resourceId: key, revision: result.revision, contentHash: result.contentHash, sourceHash, localSignature: sourceHash }, session);
          migrationCurrent += 1;
          reportHydrationProgress(userId, {
            stage: 'migration',
            progress: 80 + Math.round((migrationCurrent / Math.max(migrationTotal, 1)) * 18),
            current: migrationCurrent,
            total: migrationTotal,
            message: `正在保存本机数据（${migrationCurrent}/${migrationTotal}）`
          });
        }
        await updateUserDataMigration({ deviceId: getClientId(), action: 'complete', sourceHash, localSignature: sourceHash }, session);
        this.clearLocalBusinessData();
      }
    } catch (error) {
      // 迁移未完成时保留原生 LocalStorage，下一次登录可从断点继续；同时不留下半登录内存态。
      this.setAnonymous();
      dispatch(USER_DATA_HYDRATION_EVENT, { complete: false, error, userId, stage: 'error', message: error?.message || '云端数据恢复失败' });
      throw error;
    }
    reportHydrationProgress(userId, {
      stage: 'finalizing',
      progress: 98,
      message: `正在挂载 ${values.size} 项云端数据…`
    });
    this.hydrated = true;
    rememberLocalDataOwner(this.userId);
    dispatch(USER_DATA_MODE_EVENT, { mode: 'remote', userId: this.userId });
    dispatch(USER_DATA_HYDRATION_EVENT, {
      complete: true,
      userId: this.userId,
      stage: 'complete',
      progress: 100,
      message: '云端数据恢复完成'
    });
    return { local, remote, values, migrated: shouldMigrate };
  }

  async logout({ flush = true } = {}) {
    // 退出必须始终生效。云端保存失败时不再把用户卡在登录态，
    // 调用方可通过 flushErrors 提示“本机已清除但最后修改未上传”。
    let flushErrors = [];
    if (flush) {
      const pendingFlush = this.flushPending({ rejectOnError: false }).catch((error) => [{ key: '', error }]);
      let timeoutId;
      const timeout = new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve([{
          key: '',
          error: Object.assign(new Error('退出时等待云端保存超时'), { code: 'LOGOUT_FLUSH_TIMEOUT' })
        }]), LOGOUT_FLUSH_TIMEOUT_MS);
      });
      flushErrors = await Promise.race([pendingFlush, timeout]);
      clearTimeout(timeoutId);
    }
    // 不让退出后的匿名页面继续触发已经排队的保存计时器。
    for (const item of this.pending.values()) clearTimeout(item.timer);
    this.pending.clear();
    const localClearErrors = this.clearLocalBusinessData();
    clearUserDataCache(this.userId);
    this.values.clear();
    this.revisions.clear();
    this.mode = 'anonymous';
    this.userId = '';
    this.session = null;
    const storage = nativeStorage();
    for (const key of ['aiDcaCloudSyncMeta', 'aiDcaCloudSyncV2Meta']) {
      try {
        storage?.removeItem(key);
        if (storage && storage.getItem(key) !== null) localClearErrors.push(key);
      } catch {
        localClearErrors.push(key);
      }
    }
    this.crypto = { securityPassword: '', rawKey: '', cryptoMeta: {}, rememberDevice: true };
    this.hydrated = true;
    dispatch(USER_DATA_MODE_EVENT, { mode: 'anonymous' });
    return { flushed: flushErrors.length === 0, flushErrors, localClearErrors };
  }
}

export const userDataStore = new UserDataStore();

export function getUserDataStorage() { return userDataStore; }
export function getUserDataMode() { return userDataStore.mode; }
export function captureAnonymousUserData() { return userDataStore.captureAnonymousSnapshot(); }
export function clearLocalUserData() { return userDataStore.clearLocalBusinessData(); }
export function isRemoteUserDataKey(key) { return remoteKeys.has(idFor(key)); }
export function isRegisteredUserDataKey(key) { return registryByKey.has(idFor(key)); }
export function mergeUserDataValue(key, remoteRaw, localRaw) { return mergeValue(key, remoteRaw, localRaw); }
export { registryByKey as USER_DATA_REGISTRY_BY_KEY, isDomainMergeKey };
