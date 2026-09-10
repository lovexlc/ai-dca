import { descriptorForKey } from './accountResources.js';

const SESSION_KEY = 'aiDcaCloudSyncSession';
const runtimeRawByKey = new Map();
let nativeGetItem = null;
let nativeSetItem = null;
let nativeRemoveItem = null;
let nativeClear = null;
let guardInstalled = false;

function hasWindowStorage() {
  return typeof window !== 'undefined' && window.localStorage && typeof window.Storage !== 'undefined';
}

function persistentGetItem(key) {
  if (!hasWindowStorage()) return null;
  const getter = nativeGetItem || window.Storage.prototype.getItem;
  try {
    return getter.call(window.localStorage, key);
  } catch {
    return null;
  }
}

export function isRemoteAccountSessionActive() {
  const raw = persistentGetItem(SESSION_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.accessToken && parsed?.username);
  } catch {
    return false;
  }
}

export function isAccountBusinessStorageKey(key = '') {
  const descriptor = descriptorForKey(String(key || ''));
  return Boolean(descriptor && descriptor.runtimeRead !== false);
}

export function setAccountRuntimeStorageRaw(key = '', raw = null) {
  const normalizedKey = String(key || '');
  if (!isAccountBusinessStorageKey(normalizedKey)) return false;
  if (raw === null || raw === undefined) runtimeRawByKey.delete(normalizedKey);
  else runtimeRawByKey.set(normalizedKey, String(raw));
  return true;
}

export function removeAccountRuntimeStorageKey(key = '') {
  return setAccountRuntimeStorageRaw(key, null);
}

export function clearAccountRuntimeStore() {
  runtimeRawByKey.clear();
}

export function readAccountRuntimeStorageRaw(key = '') {
  const normalizedKey = String(key || '');
  if (!isAccountBusinessStorageKey(normalizedKey)) return undefined;
  return runtimeRawByKey.has(normalizedKey) ? runtimeRawByKey.get(normalizedKey) : null;
}

export function installAccountRemoteReadGuard() {
  if (!hasWindowStorage()) return false;
  if (guardInstalled) return true;

  const proto = window.Storage.prototype;
  nativeGetItem = proto.getItem;
  nativeSetItem = proto.setItem;
  nativeRemoveItem = proto.removeItem;
  nativeClear = proto.clear;
  const originalGetItem = nativeGetItem;
  const originalSetItem = nativeSetItem;
  const originalRemoveItem = nativeRemoveItem;
  const originalClear = nativeClear;

  proto.getItem = function accountRemoteGetItem(key) {
    const normalizedKey = String(key || '');
    if (this === window.localStorage && isRemoteAccountSessionActive() && isAccountBusinessStorageKey(normalizedKey)) {
      return runtimeRawByKey.has(normalizedKey) ? runtimeRawByKey.get(normalizedKey) : null;
    }
    return originalGetItem.call(this, key);
  };

  proto.setItem = function accountRemoteSetItem(key, value) {
    const normalizedKey = String(key || '');
    if (this === window.localStorage && isRemoteAccountSessionActive() && isAccountBusinessStorageKey(normalizedKey)) {
      runtimeRawByKey.set(normalizedKey, String(value));
      return undefined;
    }
    return originalSetItem.call(this, key, value);
  };

  proto.removeItem = function accountRemoteRemoveItem(key) {
    const normalizedKey = String(key || '');
    if (this === window.localStorage && isRemoteAccountSessionActive() && isAccountBusinessStorageKey(normalizedKey)) {
      runtimeRawByKey.delete(normalizedKey);
      return undefined;
    }
    return originalRemoveItem.call(this, key);
  };

  proto.clear = function accountRemoteClear() {
    runtimeRawByKey.clear();
    return originalClear.call(this);
  };

  guardInstalled = true;
  return true;
}
