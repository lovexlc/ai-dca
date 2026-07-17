import { getClientId } from './syncClient.js';

export const ACCOUNT_DATA_SCOPE_KEY = 'aiDcaAccountDataScope';

function safeStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // Private browsing and embedded WebViews may reject storage access.
  }
  return null;
}

function normalizeUsername(value = '') {
  return String(value || '').trim().toLowerCase().slice(0, 48);
}

function normalizeDeviceId(value = '') {
  return String(value || '').trim().slice(0, 160);
}

function readScopes() {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    const value = JSON.parse(storage.getItem(ACCOUNT_DATA_SCOPE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeScopes(scopes) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(ACCOUNT_DATA_SCOPE_KEY, JSON.stringify(scopes || {}));
  } catch {
    // Scope is advisory; a later CloudData visit can recover it from the API.
  }
}

function scopeKey(username, deviceId) {
  return `${normalizeUsername(username)}:${normalizeDeviceId(deviceId)}`;
}

export function getAccountDataScope(session, deviceId = getClientId()) {
  const username = normalizeUsername(session?.username);
  const id = normalizeDeviceId(deviceId);
  if (!username || !id) return null;
  const value = readScopes()[scopeKey(username, id)];
  if (!value || value.scope !== 'account') return null;
  return { ...value, username, deviceId: id };
}

export function isAccountDataScopeReady(session, deviceId = getClientId()) {
  return Boolean(getAccountDataScope(session, deviceId));
}

export function markAccountDataScopeReady(session, deviceId = getClientId(), metadata = {}) {
  const username = normalizeUsername(session?.username);
  const id = normalizeDeviceId(deviceId);
  if (!username || !id) return null;
  const next = {
    scope: 'account',
    username,
    deviceId: id,
    completedAt: String(metadata.completedAt || new Date().toISOString()),
    checkId: String(metadata.checkId || '').slice(0, 160)
  };
  const scopes = readScopes();
  scopes[scopeKey(username, id)] = next;
  writeScopes(scopes);
  return next;
}

export function clearAccountDataScope(session, deviceId = getClientId()) {
  const username = normalizeUsername(session?.username);
  const id = normalizeDeviceId(deviceId);
  if (!username || !id) return;
  const scopes = readScopes();
  delete scopes[scopeKey(username, id)];
  writeScopes(scopes);
}

export function normalizeAccountUsername(value = '') {
  return normalizeUsername(value);
}

export const __internals = {
  normalizeUsername,
  normalizeDeviceId,
  scopeKey,
  readScopes
};
