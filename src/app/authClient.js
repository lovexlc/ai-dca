const DEFAULT_SYNC_BASE = 'https://tools.freebacktrack.tech/api/sync';
const SESSION_KEY = 'aiDcaCloudSyncSession';
const SESSION_EVENT = 'cloud-sync:session-changed';

function notifyCloudSessionChanged(session) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { session: session || null } }));
}

function getSyncBase() {
  if (typeof window !== 'undefined' && window.__AI_DCA_SYNC_BASE__) {
    return String(window.__AI_DCA_SYNC_BASE__).replace(/\/$/, '');
  }
  return DEFAULT_SYNC_BASE;
}

function safeStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function passwordHash(username, password) {
  return sha256Hex(`${String(username || '').trim().toLowerCase()}:${String(password || '')}`);
}

export function loadCloudSession() {
  const ls = safeStorage();
  if (!ls) return null;
  try {
    const parsed = JSON.parse(ls.getItem(SESSION_KEY) || 'null');
    if (!parsed?.accessToken || !parsed?.username) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCloudSession(session) {
  const ls = safeStorage();
  if (!ls) return null;
  const payload = {
    userId: String(session?.userId || ''),
    username: String(session?.username || ''),
    accessToken: String(session?.accessToken || ''),
    refreshToken: String(session?.refreshToken || ''),
    savedAt: new Date().toISOString()
  };
  ls.setItem(SESSION_KEY, JSON.stringify(payload));
  notifyCloudSessionChanged(payload);
  return payload;
}

export function clearCloudSession() {
  const ls = safeStorage();
  if (!ls) return;
  ls.removeItem(SESSION_KEY);
  notifyCloudSessionChanged(null);
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { message: text }; }
}

async function requestSync(path, { token = '', ...init } = {}) {
  const headers = { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${getSyncBase()}${path}`, { ...init, headers });
  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `请求失败：HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    error.response = response;
    throw error;
  }
  return data;
}

export async function registerCloudAccount({ username, password }) {
  const normalized = String(username || '').trim().toLowerCase();
  if (normalized.length < 3) throw new Error('用户名至少 3 位');
  if (String(password || '').length < 8) throw new Error('登录密码至少 8 位');
  const data = await requestSync('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: normalized, passwordHash: await passwordHash(normalized, password) })
  });
  return saveCloudSession(data);
}

export async function loginCloudAccount({ username, password }) {
  const normalized = String(username || '').trim().toLowerCase();
  const data = await requestSync('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: normalized, passwordHash: await passwordHash(normalized, password) })
  });
  return saveCloudSession(data);
}

export async function fetchCloudSyncMeta(session = loadCloudSession()) {
  if (!session?.accessToken) return null;
  return requestSync('/meta', { method: 'GET', token: session.accessToken });
}

export async function fetchLatestCloudBackup(session = loadCloudSession()) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  return requestSync('/latest', { method: 'GET', token: session.accessToken });
}

export async function uploadLatestCloudBackup(payload, session = loadCloudSession()) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  return requestSync('/latest', {
    method: 'PUT',
    token: session.accessToken,
    body: JSON.stringify(payload || {})
  });
}

export const CLOUD_SYNC_SESSION_KEY = SESSION_KEY;
export const CLOUD_SYNC_SESSION_EVENT = SESSION_EVENT;
