// 市场页面 URL 同步工具：确保基金详情页 URL 包含 symbol 参数，支持分享和刷新。

/**
 * 更新 URL 中的 symbol 参数
 * @param {string} symbol - 基金代码
 */
export function updateSymbolInUrl(symbol) {
  if (typeof window === 'undefined' || !symbol) return;
  const url = new URL(window.location.href);
  url.searchParams.set('symbol', symbol);
  window.history.replaceState({ tab: 'markets', symbol }, '', url.href);
}

/**
 * 清除 URL 中的 symbol 参数
 */
export function clearSymbolFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('symbol');
  window.history.replaceState({ tab: 'markets' }, '', url.href);
}
