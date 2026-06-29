const WORKSPACE_RETURN_KEY = 'aiDcaWorkspaceReturn_v1';
const MAX_AGE_MS = 30 * 60 * 1000;

function safeSessionStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage || null;
  } catch {
    return null;
  }
}

function normalizeSnapshot(value = {}) {
  const tab = String(value.tab || '').trim();
  const targetTab = String(value.targetTab || '').trim();
  if (!tab || !targetTab) return null;
  return {
    tab,
    targetTab,
    hash: String(value.hash || '').slice(0, 120),
    search: String(value.search || '').slice(0, 400),
    label: String(value.label || '上一页').slice(0, 40),
    createdAt: Number(value.createdAt) || Date.now(),
  };
}

export function saveWorkspaceReturn(snapshot) {
  const storage = safeSessionStorage();
  if (!storage) return;
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) return;
  try {
    storage.setItem(WORKSPACE_RETURN_KEY, JSON.stringify(normalized));
  } catch {
    // ignore
  }
}

export function readWorkspaceReturn(currentTab = '') {
  const storage = safeSessionStorage();
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(WORKSPACE_RETURN_KEY) || 'null');
    const normalized = normalizeSnapshot(parsed || {});
    if (!normalized) return null;
    if (Date.now() - normalized.createdAt > MAX_AGE_MS) {
      storage.removeItem(WORKSPACE_RETURN_KEY);
      return null;
    }
    if (currentTab && normalized.targetTab !== currentTab) return null;
    return normalized;
  } catch {
    return null;
  }
}

export function clearWorkspaceReturn() {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(WORKSPACE_RETURN_KEY);
  } catch {
    // ignore
  }
}
