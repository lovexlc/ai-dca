import { clearAccountRuntimeStore, installAccountRemoteReadGuard } from './accountRuntimeStore.js';

installAccountRemoteReadGuard();

const SESSION_KEY = 'aiDcaCloudSyncSession';
const SESSION_EVENT = 'cloud-sync:session-changed';

function safeStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function notifyCloudSessionChanged(session) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { session: session || null } }));
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
  const previous = loadCloudSession();
  const payload = {
    userId: String(session?.userId || ''),
    username: String(session?.username || ''),
    accessToken: String(session?.accessToken || ''),
    refreshToken: String(session?.refreshToken || ''),
    isAdmin: Boolean(session?.isAdmin),
    savedAt: new Date().toISOString()
  };
  if (previous?.userId !== payload.userId || previous?.username !== payload.username) {
    clearAccountRuntimeStore();
  }
  ls.setItem(SESSION_KEY, JSON.stringify(payload));
  notifyCloudSessionChanged(payload);
  return payload;
}

export function clearCloudSession() {
  const ls = safeStorage();
  if (!ls) return;
  clearAccountRuntimeStore();
  ls.removeItem(SESSION_KEY);
  notifyCloudSessionChanged(null);
}

export const CLOUD_SYNC_SESSION_KEY = SESSION_KEY;
export const CLOUD_SYNC_SESSION_EVENT = SESSION_EVENT;
