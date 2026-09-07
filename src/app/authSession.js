const SESSION_KEY = 'aiDcaCloudSyncSession';
const SESSION_EVENT = 'cloud-sync:session-changed';
let memorySession = null;

function safeStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function notifyCloudSessionChanged(session) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { session: session || null } }));
}

function normalizeSession(session = {}) {
  return {
    userId: String(session?.userId || session?.id || ''),
    username: String(session?.username || ''),
    accessToken: String(session?.accessToken || ''),
    refreshToken: String(session?.refreshToken || ''),
    isAdmin: Boolean(session?.isAdmin),
    cookieSession: Boolean(session?.cookieSession),
    savedAt: session?.savedAt || new Date().toISOString()
  };
}

export function loadCloudSession() {
  if (memorySession?.username && (memorySession.accessToken || memorySession.cookieSession)) {
    return memorySession;
  }
  const ls = safeStorage();
  if (!ls) return null;
  try {
    const parsed = JSON.parse(ls.getItem(SESSION_KEY) || 'null');
    if (!parsed?.username || (!parsed?.accessToken && !parsed?.cookieSession)) return null;
    memorySession = normalizeSession(parsed);
    return memorySession;
  } catch {
    return null;
  }
}

/**
 * Hydrate an HttpOnly-cookie session discovered by the shared user-data API.
 * The cookie is the authority; only non-sensitive display metadata is kept in memory.
 */
export function hydrateCloudSession(session) {
  const payload = normalizeSession({ ...session, cookieSession: true, accessToken: session?.accessToken || '' });
  if (!payload.username || !payload.userId) return null;
  memorySession = payload;
  notifyCloudSessionChanged(payload);
  return payload;
}

export function saveCloudSession(session) {
  const ls = safeStorage();
  const payload = normalizeSession(session);
  if (!payload.username || (!payload.accessToken && !payload.cookieSession)) return null;
  memorySession = payload;
  // 保留旧 Bearer token 仅用于迁移期的 /api/sync 兼容；业务数据不从这个 key 读取。
  if (ls) ls.setItem(SESSION_KEY, JSON.stringify(payload));
  notifyCloudSessionChanged(payload);
  return payload;
}

export function clearCloudSession() {
  const ls = safeStorage();
  memorySession = null;
  if (ls) ls.removeItem(SESSION_KEY);
  notifyCloudSessionChanged(null);
}

export const CLOUD_SYNC_SESSION_KEY = SESSION_KEY;
export const CLOUD_SYNC_SESSION_EVENT = SESSION_EVENT;
