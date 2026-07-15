// 账号同步「端」标识 —— 安装实例粒度。
//
// 同步版本号的语义：同一安装（同一浏览器/设备）连续修改只覆盖云端、不涨版本；
// 只有「另一个安装实例」接管修改时才涨版本（跨端）。因此需要一个稳定的、设备本地的
// 安装 id（不参与同步），外加一个便于展示/排查的平台类型标签。
//
// id：localStorage 持久化的随机 UUID（设备本地，永不进入同步 envelope）。
// type：尽力而为的平台判定（小程序 / APP / APP Web / PC Web）。原生壳层 / 小程序壳层
//       如注入 window.__AIDCA_CLIENT_END__ 则以其为准。

const CLIENT_ID_KEY = 'aiDcaSyncClientId';
const SESSION_ID_KEY = 'aiDcaSyncSessionId';

function safeLocalStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeSessionStorage() {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function randomUuid(prefix = 'cid') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${String(globalThis?.performance?.now?.() || 0).replace('.', '')}`;
}

// 稳定的安装实例 id（设备本地，不同步）。
export function getClientId() {
  const ls = safeLocalStorage();
  if (!ls) return 'ephemeral';
  let id = '';
  try { id = ls.getItem(CLIENT_ID_KEY) || ''; } catch { id = ''; }
  if (!id) {
    id = randomUuid();
    try { ls.setItem(CLIENT_ID_KEY, id); } catch { /* 配额/隐私模式失败时退化为临时 id */ }
  }
  return id;
}

// tab / App WebView 会话 id。与安装 id 分开，避免同一浏览器多个标签页共享写租约。
export function getClientSessionId() {
  const ss = safeSessionStorage();
  if (!ss) return `sid-${getClientId()}`;
  let id = '';
  try { id = ss.getItem(SESSION_ID_KEY) || ''; } catch { id = ''; }
  if (!id) {
    id = randomUuid('sid');
    try { ss.setItem(SESSION_ID_KEY, id); } catch { /* 隐私模式下退化为临时会话 id */ }
  }
  return id;
}

// 平台类型标签（仅展示/排查用，不参与「是否跨端」判定）。
export function getClientEndType() {
  if (typeof window === 'undefined') return 'Server';
  // 壳层显式注入优先。
  const injected = window.__AIDCA_CLIENT_END__;
  if (injected && typeof injected === 'string') return injected.slice(0, 40);
  const nav = window.navigator || {};
  const ua = String(nav.userAgent || '');
  // 微信小程序 webview。
  if (window.__wxjs_environment === 'miniprogram' || /miniProgram/i.test(ua)) return '小程序';
  // 原生 App 内嵌 webview（RN / 自定义 UA 标记 / Android wv）。
  if (window.ReactNativeWebView || /\bwv\b|AIDCAApp/i.test(ua)) return 'APP';
  // 移动端浏览器 H5 vs 桌面浏览器。
  const viewportWidth = Number(window.innerWidth || 0);
  const isMobile = /Mobi|Android|iPhone|iPod/i.test(ua) || (viewportWidth > 0 && viewportWidth < 768);
  return isMobile ? 'APP Web' : 'PC Web';
}

// 上传时附带的端标识。
export function getClientEnd() {
  return { id: getClientId(), type: getClientEndType(), sessionId: getClientSessionId() };
}

export const SYNC_CLIENT_ID_KEY = CLIENT_ID_KEY;
export const SYNC_CLIENT_SESSION_ID_KEY = SESSION_ID_KEY;
