const PREMIUM_STATE_KEY = 'aiDcaPremiumState';
const APP_ENTRY_AD_SESSION_KEY = 'aiDcaAppEntryAdShown';

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function getLocalStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch (_error) {
    return null;
  }
}

function getSessionStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch (_error) {
    return null;
  }
}

export function readPremiumState() {
  const ls = getLocalStorage();
  const saved = safeParse(ls?.getItem(PREMIUM_STATE_KEY), {});
  return {
    unlocked: saved?.unlocked === true,
    plan: String(saved?.plan || '').trim(),
    source: String(saved?.source || '').trim(),
    updatedAt: String(saved?.updatedAt || '').trim()
  };
}

export function writePremiumState(nextState = {}) {
  const ls = getLocalStorage();
  const payload = {
    ...readPremiumState(),
    ...nextState,
    unlocked: nextState?.unlocked === true,
    updatedAt: new Date().toISOString()
  };
  ls?.setItem(PREMIUM_STATE_KEY, JSON.stringify(payload));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aidca:premium-changed', { detail: payload }));
  }
  return payload;
}

export function clearPremiumState() {
  const ls = getLocalStorage();
  ls?.removeItem(PREMIUM_STATE_KEY);
  const payload = readPremiumState();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aidca:premium-changed', { detail: payload }));
  }
  return payload;
}

export function hasPremiumAccess() {
  return readPremiumState().unlocked === true;
}

export function shouldShowAppEntryAd() {
  if (hasPremiumAccess()) return false;
  const ss = getSessionStorage();
  return ss?.getItem(APP_ENTRY_AD_SESSION_KEY) !== '1';
}

export function markAppEntryAdShown() {
  const ss = getSessionStorage();
  ss?.setItem(APP_ENTRY_AD_SESSION_KEY, '1');
}

export const PREMIUM_FEATURES = [
  {
    key: 'ad_free',
    title: '移除启动与页面广告',
    description: '适合高频使用，减少进入应用和切换页面时的干扰。'
  },
  {
    key: 'advanced_alerts',
    title: '高级提醒策略',
    description: '预留给更多阈值、组合收益、场内溢价和跨市场信号提醒。'
  },
  {
    key: 'unlimited_snapshots',
    title: '更多持仓快照与历史',
    description: '预留给更长历史记录、更多基金池和多设备同步额度。'
  },
  {
    key: 'ai_research',
    title: 'AI 组合分析',
    description: '预留给自动生成复盘、风险摘要和调仓建议说明。'
  }
];
