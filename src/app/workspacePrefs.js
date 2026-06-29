import { isWorkspaceGroup } from './screens.js';
import { SCENARIOS } from './scenarios.js';

export const WORKSPACE_PREFS_KEY = 'aiDcaWorkspacePrefs';

export const DEFAULT_WORKSPACE_PREFS = {
  source: 'react-workspace-prefs',
  version: 3,
  scenario: 'stock',
  homepageTab: 'markets',
  updatedAt: ''
};

export function normalizeHomepageTab(value = '') {
  const tab = String(value || '').trim();
  return isWorkspaceGroup(tab) ? tab : DEFAULT_WORKSPACE_PREFS.homepageTab;
}

export function normalizeScenario(value = '') {
  const scenario = String(value || '').trim();
  return SCENARIOS[scenario] ? scenario : DEFAULT_WORKSPACE_PREFS.scenario;
}

export function normalizeWorkspacePrefs(raw = {}) {
  const rawVersion = Number(raw?.version) || 0;
  return {
    ...DEFAULT_WORKSPACE_PREFS,
    scenario: normalizeScenario(raw?.scenario),
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

/**
 * 切换场景
 * @param {string} scenarioKey - 场景 key
 * @param {string|null} newHomepageTab - 可选的新首页 tab，不传则使用场景默认值
 * @returns {Object} 更新后的偏好设置
 */
export function switchScenario(scenarioKey, newHomepageTab = null) {
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) {
    console.warn(`Invalid scenario: ${scenarioKey}`);
    return readWorkspacePrefs();
  }

  return persistWorkspacePrefs({
    scenario: scenarioKey,
    homepageTab: newHomepageTab || scenario.defaultHome
  });
}
