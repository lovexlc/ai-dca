// 网页 app 页面的 beta（小程序版）开关。
// 设计目标：正式版逻辑完全不变，beta 只作为可切换的并行实现挂载。
// 纯函数与浏览器读写分离，便于 node --test 直接测试。

export const BETA_QUERY_KEY = 'beta';
export const BETA_TAB_QUERY_KEY = 'btab';
export const BETA_STORAGE_KEY = 'site:betaApp';
export const BETA_BANNER_DISMISS_KEY = 'site:betaBannerDismissed';

const TRUE_VALUES = new Set(['1', 'true', 'on', 'yes', 'y']);
const FALSE_VALUES = new Set(['0', 'false', 'off', 'no', 'n']);
const APP_PATHNAMES = new Set(['/', '/index.html']);
const PAGES_DIR_PATTERN = /\/pages(?:-v2)?\//;

export function normalizeBetaValue(raw) {
  if (raw === true || raw === false) return raw;
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value) return null;
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  return null;
}

// 仅限网页的 app 页面：单入口 index.html（含 ?tab= 路由）以及 /pages/ 下的子页面。
// 其他静态页（落地页、文档页等）不显示 beta 入口，也不会进入 beta。
export function isAppPagePath(pathname = '/') {
  const clean = String(pathname || '/').split('?')[0].split('#')[0];
  if (!clean) return false;
  if (APP_PATHNAMES.has(clean)) return true;
  if (PAGES_DIR_PATTERN.test(clean)) return true;
  return clean.endsWith('/index.html');
}

function parseSearch(search) {
  const raw = String(search || '');
  return new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
}

export function readBetaOverride(search = '') {
  if (!String(search || '')) return null;
  const params = parseSearch(search);
  if (!params.has(BETA_QUERY_KEY)) return null;
  return normalizeBetaValue(params.get(BETA_QUERY_KEY));
}

export function readBetaTabOverride(search = '') {
  if (!String(search || '')) return null;
  const value = (parseSearch(search).get(BETA_TAB_QUERY_KEY) || '').trim();
  return value || null;
}

// 优先级：?beta= > localStorage > 默认关闭（正式版）。
export function resolveBetaState({ search = '', pathname = '/', storedValue = null } = {}) {
  if (!isAppPagePath(pathname)) {
    return { enabled: false, appPage: false, canSwitch: false, source: 'not-app-page' };
  }
  const override = readBetaOverride(search);
  if (override !== null) {
    return { enabled: override, appPage: true, canSwitch: true, source: 'query' };
  }
  const stored = normalizeBetaValue(storedValue);
  if (stored !== null) {
    return { enabled: stored, appPage: true, canSwitch: true, source: 'storage' };
  }
  return { enabled: false, appPage: true, canSwitch: true, source: 'default' };
}

// 切换时保留其他查询参数，避免丢掉 ?tab= / ?region= 等既有状态。
export function buildBetaUrl({ pathname = '/', search = '', enabled = true, tab = null } = {}) {
  const params = parseSearch(search);
  if (enabled) {
    params.set(BETA_QUERY_KEY, '1');
    if (tab) params.set(BETA_TAB_QUERY_KEY, tab);
  } else {
    params.delete(BETA_QUERY_KEY);
    params.delete(BETA_TAB_QUERY_KEY);
  }
  const query = params.toString();
  return query ? String(pathname) + '?' + query : String(pathname);
}

function safeStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

export function readStoredBeta() {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    return normalizeBetaValue(storage.getItem(BETA_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function persistBeta(enabled) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(BETA_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // 隐私模式下写入失败不影响使用，本次仍按查询参数生效
  }
}

export function isBetaBannerDismissed() {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    return storage.getItem(BETA_BANNER_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissBetaBanner() {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(BETA_BANNER_DISMISS_KEY, '1');
  } catch {
    // ignore
  }
}

// 浏览器入口：读取当前地址与本地存储，并把 ?beta= 的显式选择固化下来。
export function detectBetaState() {
  if (typeof window === 'undefined') {
    return { enabled: false, appPage: false, canSwitch: false, source: 'ssr' };
  }
  const state = resolveBetaState({
    search: window.location.search,
    pathname: window.location.pathname,
    storedValue: readStoredBeta()
  });
  if (state.source === 'query') persistBeta(state.enabled);
  return state;
}

function navigate(enabled, tab) {
  if (typeof window === 'undefined') return;
  persistBeta(enabled);
  const target = buildBetaUrl({
    pathname: window.location.pathname,
    search: window.location.search,
    enabled,
    tab
  });
  window.location.assign(target + window.location.hash);
}

export function enableBeta(tab = null) {
  navigate(true, tab);
}

export function disableBeta() {
  navigate(false, null);
}
