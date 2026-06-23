// 持仓页面 URL 同步工具：确保持仓详情页 URL 包含 code 参数，支持分享和刷新。

/**
 * 更新 URL 中的持仓基金代码参数
 * @param {string} code - 基金代码
 */
export function updateCodeInUrl(code) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (code) {
    url.searchParams.set('code', code);
  } else {
    url.searchParams.delete('code');
  }
  window.history.replaceState({ tab: 'holdings', code: code || '' }, '', url.href);
}

/**
 * 从 URL 读取持仓基金代码参数
 * @returns {string} 基金代码，如果不存在则返回空字符串
 */
export function getCodeFromUrl() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return params.get('code') || '';
}
