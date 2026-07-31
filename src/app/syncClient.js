// 账号同步「端」标识 —— 登录账号粒度。
//
// 登录后使用 username 作为 end.id，让同一账号在不同设备上被视为同一端；
// 未登录时统一退化为 anonymous。type 仍仅用于展示/排查，不参与版本判定。
//
// type：尽力而为的平台判定（小程序 / APP / APP Web / PC Web）。原生壳层 / 小程序壳层
//       如注入 window.__AIDCA_CLIENT_END__ 则以其为准。

const CLOUD_SYNC_SESSION_KEY = 'aiDcaCloudSyncSession';

function safeLocalStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// 登录后以 username 作为同步端标识；未登录时退化为 anonymous。
export function getClientId() {
  try {
    const raw = safeLocalStorage()?.getItem(CLOUD_SYNC_SESSION_KEY);
    if (raw) {
      const session = JSON.parse(raw);
      if (session?.username) return String(session.username);
    }
  } catch {
    // localStorage 不可用或会话内容损坏时，使用匿名端标识。
  }
  return 'anonymous';
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
  return { id: getClientId(), type: getClientEndType() };
}
