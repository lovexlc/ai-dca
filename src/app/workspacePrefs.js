import { PRIMARY_TAB_ORDER } from './screens.js';

export const WORKSPACE_PREFS_KEY = 'aiDcaWorkspacePrefs';

export const DEFAULT_WORKSPACE_PREFS = {
  source: 'react-workspace-prefs',
  version: 1,
  homepageTab: 'strategy',
  updatedAt: ''
};

export function normalizeHomepageTab(value = '') {
  const tab = String(value || '').trim();
  return PRIMARY_TAB_ORDER.includes(tab) ? tab : DEFAULT_WORKSPACE_PREFS.homepageTab;
}

export function normalizeWorkspacePrefs(raw = {}) {
  return {
    ...DEFAULT_WORKSPACE_PREFS,
    homepageTab: normalizeHomepageTab(raw?.homepageTab),
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
  } catch (_error) {
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
