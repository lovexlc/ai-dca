import { isWorkspaceGroup } from './screens.js';

export const WORKSPACE_PREFS_KEY = 'aiDcaWorkspacePrefs';

export const DEFAULT_WORKSPACE_PREFS = {
  source: 'react-workspace-prefs',
  version: 3,
  homepageTab: 'markets',
  updatedAt: ''
};

export function normalizeHomepageTab(value = '') {
  const tab = String(value || '').trim();
  return isWorkspaceGroup(tab) ? tab : DEFAULT_WORKSPACE_PREFS.homepageTab;
}

export function normalizeWorkspacePrefs(raw = {}) {
  const rawVersion = Number(raw?.version) || 0;
  return {
    ...DEFAULT_WORKSPACE_PREFS,
    homepageTab: rawVersion < 3 ? DEFAULT_WORKSPACE_PREFS.homepageTab : normalizeHomepageTab(raw?.homepageTab),
    updatedAt: String(raw?.updatedAt || '')
  };
}

export function readWorkspacePrefs() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_WORKSPACE_PREFS;
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WORKSPACE_PREFS_KEY) || 'null');
    return normalizeWorkspacePrefs(parsed || {});
  } catch {
    return DEFAULT_WORKSPACE_PREFS;
  }
}

export function persistWorkspacePrefs(nextPrefs = {}) {
  const payload = normalizeWorkspacePrefs({
    ...readWorkspacePrefs(),
    ...nextPrefs,
    updatedAt: new Date().toISOString()
  });
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(WORKSPACE_PREFS_KEY, JSON.stringify(payload));
  }
  return payload;
}
