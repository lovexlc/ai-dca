import {
  REMOTE_DATA_KEYS,
  exchangeRemoteSession,
  importLegacyRemoteRecords,
  loadRemoteBootstrap,
  loadRemoteSession,
  logoutRemoteSession,
  writeRemoteRecords
} from './remoteUserData.js';
import { CLOUD_SYNC_SESSION_EVENT, hydrateCloudSession, loadCloudSession } from './authSession.js';

const REMOTE_KEY_SET = new Set(REMOTE_DATA_KEYS);
const localStorageRef = typeof window !== 'undefined' ? window.localStorage : null;
const nativeStorage = typeof Storage !== 'undefined'
  ? {
      getItem: Storage.prototype.getItem,
      setItem: Storage.prototype.setItem,
      removeItem: Storage.prototype.removeItem,
      clear: Storage.prototype.clear,
      key: Storage.prototype.key
    }
  : null;

let installed = false;
let ready = false;
let authenticated = false;
let remoteUserId = '';
let remoteToken = '';
let revisions = new Map();
let remoteValues = new Map();
let pending = new Map();
let flushTimer = null;
let flushPromise = null;
let lastBootstrapPromise = null;

function isRemoteKey(key) {
  return REMOTE_KEY_SET.has(String(key || ''));
}

function isLocalStorageTarget(target) {
  return Boolean(localStorageRef && target === localStorageRef);
}

function dispatch(name, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function nativeGet(key) {
  if (!nativeStorage || !localStorageRef) return null;
  try {
    return nativeStorage.getItem.call(localStorageRef, key);
  } catch {
    return null;
  }
}

function collectLegacyRecords() {
  return REMOTE_DATA_KEYS
    .map((key) => ({ key, value: nativeGet(key), baseRevision: 0 }))
    .filter((record) => record.value !== null && record.value !== '');
}

function installStorageAdapter() {
  if (installed || !localStorageRef || !nativeStorage || typeof Storage === 'undefined') return;
  installed = true;

  Storage.prototype.getItem = function getItem(key) {
    if (isLocalStorageTarget(this) && isRemoteKey(key) && ready) {
      return remoteValues.has(String(key)) ? remoteValues.get(String(key)) : null;
    }
    return nativeStorage.getItem.call(this, key);
  };

  Storage.prototype.setItem = function setItem(key, value) {
    if (!(isLocalStorageTarget(this) && isRemoteKey(key) && ready)) {
      return nativeStorage.setItem.call(this, key, value);
    }
    const normalizedKey = String(key);
    const normalizedValue = String(value);
    remoteValues.set(normalizedKey, normalizedValue);
    const baseRevision = pending.get(normalizedKey)?.baseRevision ?? revisions.get(normalizedKey) ?? 0;
    pending.set(normalizedKey, { key: normalizedKey, value: normalizedValue, baseRevision });
    dispatch('ai-dca:data-changed', { key: normalizedKey, remote: true });
    dispatch('remote-data:pending', { key: normalizedKey });
    scheduleFlush();
  };

  Storage.prototype.removeItem = function removeItem(key) {
    if (!(isLocalStorageTarget(this) && isRemoteKey(key) && ready)) {
      return nativeStorage.removeItem.call(this, key);
    }
    const normalizedKey = String(key);
    remoteValues.delete(normalizedKey);
    const baseRevision = pending.get(normalizedKey)?.baseRevision ?? revisions.get(normalizedKey) ?? 0;
    pending.set(normalizedKey, { key: normalizedKey, value: null, baseRevision });
    dispatch('ai-dca:data-changed', { key: normalizedKey, remote: true });
    dispatch('remote-data:pending', { key: normalizedKey });
    scheduleFlush();
  };

  Storage.prototype.clear = function clear() {
    if (!(isLocalStorageTarget(this) && ready)) {
      return nativeStorage.clear.call(this);
    }
    for (const key of REMOTE_DATA_KEYS) {
      if (remoteValues.has(key)) this.removeItem(key);
    }
  };

  Storage.prototype.key = function key(index) {
    if (!(isLocalStorageTarget(this) && ready)) return nativeStorage.key.call(this, index);
    const nativeKeys = [];
    for (let i = 0; i < nativeStorage.length; i += 1) {
      const nativeKey = nativeStorage.key.call(this, i);
      if (nativeKey && !isRemoteKey(nativeKey)) nativeKeys.push(nativeKey);
    }
    const allKeys = nativeKeys.concat(Array.from(remoteValues.keys()));
    return allKeys[Number(index)] || null;
  };

  try {
    Object.defineProperty(Storage.prototype, 'length', {
      configurable: true,
      get() {
        if (!(isLocalStorageTarget(this) && ready)) return nativeStorage.length;
        let count = 0;
        for (let i = 0; i < nativeStorage.length; i += 1) {
          const key = nativeStorage.key.call(this, i);
          if (key && !isRemoteKey(key)) count += 1;
        }
        return count + remoteValues.size;
      }
    });
  } catch {
    // 某些浏览器将 Storage.length 标记为不可配置；核心读写适配仍然有效。
  }

  window.addEventListener(CLOUD_SYNC_SESSION_EVENT, (event) => {
    const session = event?.detail?.session;
    if (!session) {
      const hadRemoteSession = authenticated;
      resetRemoteStorage();
      if (hadRemoteSession) void logoutRemoteSession();
      return;
    }
    if (session.accessToken && !authenticated) {
      void bootstrapRemoteStorage({ token: session.accessToken, reloadAfterHydration: true }).catch((error) => {
        dispatch('remote-data:error', { error });
      });
    }
  });

  window.addEventListener('pagehide', () => {
    void flushRemoteUserData();
  });
}

function hydrateRecords(records = []) {
  remoteValues = new Map();
  revisions = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const key = String(record?.key || '');
    if (!isRemoteKey(key) || record?.value == null) continue;
    remoteValues.set(key, String(record.value));
    revisions.set(key, Number(record.revision) || 0);
  }
  ready = true;
  dispatch('remote-data:hydrated', {
    userId: remoteUserId,
    keys: Array.from(remoteValues.keys())
  });
}

function scheduleFlush() {
  if (flushTimer || !authenticated) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushRemoteUserData().catch(() => {});
  }, 450);
}

export async function flushRemoteUserData() {
  if (!authenticated || !pending.size) return { skipped: true };
  if (flushPromise) return flushPromise;
  const batch = Array.from(pending.values());
  for (const record of batch) pending.delete(record.key);
  flushPromise = writeRemoteRecords(batch, { token: remoteToken, mutationId: `web:${Date.now()}` })
    .then((result) => {
      for (const record of Array.isArray(result?.records) ? result.records : batch) {
        if (record?.value == null) {
          remoteValues.delete(record.key);
        } else {
          remoteValues.set(record.key, String(record.value));
        }
        revisions.set(record.key, Number(record.revision) || 0);
      }
      dispatch('remote-data:flushed', { records: batch, result });
      return result;
    })
    .catch((error) => {
      for (const record of batch) {
        if (!pending.has(record.key)) pending.set(record.key, record);
      }
      dispatch('remote-data:error', { error });
      throw error;
    })
    .finally(() => {
      flushPromise = null;
      if (pending.size) scheduleFlush();
    });
  return flushPromise;
}

export function resetRemoteStorage() {
  ready = false;
  authenticated = false;
  remoteUserId = '';
  remoteToken = '';
  revisions = new Map();
  remoteValues = new Map();
  pending.clear();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  dispatch('remote-data:reset');
}

export function isRemoteStorageReady() {
  return ready && authenticated;
}

export async function bootstrapRemoteStorage({ token = '', reloadAfterHydration = false } = {}) {
  installStorageAdapter();
  if (lastBootstrapPromise) return lastBootstrapPromise;

  lastBootstrapPromise = (async () => {
    let session = loadCloudSession();
    let bootstrap;
    const accessToken = String(token || session?.accessToken || '').trim();

    if (accessToken) {
      try {
        await exchangeRemoteSession({ accessToken });
      } catch (error) {
        if (error?.status !== 401) throw error;
      }
      try {
        bootstrap = await loadRemoteBootstrap({ token: accessToken });
      } catch (error) {
        if (error?.status !== 401) throw error;
        bootstrap = await loadRemoteBootstrap();
      }
    } else {
      bootstrap = await loadRemoteBootstrap();
    }

    session = bootstrap?.user || session;
    if (!session?.userId && !session?.id) {
      resetRemoteStorage();
      return { authenticated: false, ready: false };
    }

    remoteUserId = String(session.userId || session.id);
    remoteToken = accessToken;
    authenticated = true;
    hydrateCloudSession({
      userId: remoteUserId,
      username: String(session.username || ''),
      accessToken: remoteToken,
      refreshToken: '',
      isAdmin: Boolean(session.isAdmin),
      cookieSession: !remoteToken
    });

    const legacyRecords = collectLegacyRecords();
    if (!bootstrap.initialized && !bootstrap.records?.length && legacyRecords.length) {
      await importLegacyRemoteRecords(legacyRecords, {
        token: remoteToken,
        mutationId: `legacy:${remoteUserId}`
      });
      bootstrap = await loadRemoteBootstrap({ token: remoteToken });
    }

    hydrateRecords(bootstrap?.records || []);
    if (reloadAfterHydration && typeof window !== 'undefined') {
      window.setTimeout(() => window.location.reload(), 0);
    }
    return {
      authenticated: true,
      ready: true,
      user: session,
      keys: Array.from(remoteValues.keys()),
      migratedLegacy: Boolean(legacyRecords.length && !bootstrap.initialized)
    };
  })();

  try {
    return await lastBootstrapPromise;
  } finally {
    lastBootstrapPromise = null;
  }
}

installStorageAdapter();
