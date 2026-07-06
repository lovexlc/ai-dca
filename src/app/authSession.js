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
  const payload = {
    userId: String(session?.userId || ''),
    username: String(session?.username || ''),
    accessToken: String(session?.accessToken || ''),
    refreshToken: String(session?.refreshToken || ''),
    isAdmin: Boolean(session?.isAdmin),
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

export const CLOUD_SYNC_SESSION_KEY = SESSION_KEY;
export const CLOUD_SYNC_SESSION_EVENT = SESSION_EVENT;
