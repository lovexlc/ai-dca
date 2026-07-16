import { clearMarketHistoryCache } from './marketHistoryCache.js';
import { MARKET_LOCAL_STORAGE_CACHE_KEYS } from './marketCacheKeys.js';
import { clearNavHistoryCache } from './navHistoryClient.js';

/**
 * 清除所有本地数据
 *
 * 用于处理用户误触生成测试数据后无法清除的场景。
 * 清除范围：持仓、交易、计划、定投、自选等所有核心业务数据。
 */

export function clearAllLocalData() {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('无法访问本地存储');
  }

  // 清除所有持仓和交易相关的 localStorage key
  const keysToRemove = [
    'aiDcaFundHoldingsLedger',
    'aiDcaFundHoldingsState',
    'aiDcaAccountAllocationSettings',
    'aiDcaAccountAssignments',
    'aiDcaTradeLedger',
    'aiDcaTradeLedgerArchive',
    'aiDcaHoldingAlerts',
    'aiDcaPlanState',
    'aiDcaPlanStore',
    'aiDcaDcaState',
    'aiDcaDcaStore',
    'aiDcaSellPlanDraft',
    'aiDcaSellPlanStore',
    'aiDcaDemoDataMeta',
    'markets:watchlist:v1',
    ...MARKET_LOCAL_STORAGE_CACHE_KEYS
  ];

  for (const key of keysToRemove) {
    window.localStorage.removeItem(key);
  }

  return { removedCount: keysToRemove.length };
}

export async function clearAllLocalDataAsync() {
  const local = clearAllLocalData();
  const [marketHistoryCleared, navHistoryCleared] = await Promise.all([
    clearMarketHistoryCache().catch(() => false),
    clearNavHistoryCache().then(() => true).catch(() => false)
  ]);
  return { ...local, marketHistoryCleared, navHistoryCleared };
}

/**
 * 统计即将清除的数据量
 */
export function getDataStats({ transactions = [], aggregates = [] } = {}) {
  return {
    transactionCount: Array.isArray(transactions) ? transactions.length : 0,
    aggregateCount: Array.isArray(aggregates) ? aggregates.length : 0
  };
}

/**
 * 生成确认提示消息
 */
export function getClearDataConfirmMessage(stats) {
  return `即将清除所有本地数据：\n\n• ${stats.transactionCount} 笔交易记录\n• ${stats.aggregateCount} 只基金持仓\n\n⚠️ 此操作不可恢复，确认清除？`;
}

const ANALYTICS_LOCAL_KEY_PREFIXES = ['aiDcaAnalytics', 'ph_', '$ph_'];

function isAnalyticsLocalKey(key = '') {
  const value = String(key || '');
  return ANALYTICS_LOCAL_KEY_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function clearAllBrowserLocalStorage({ preserveAnalytics = true } = {}) {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('无法访问本地存储');
  }

  const keys = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key) continue;
    if (preserveAnalytics && isAnalyticsLocalKey(key)) continue;
    keys.push(key);
  }
  keys.forEach((key) => window.localStorage.removeItem(key));

  let sessionStorageCleared = false;
  try {
    if (window.sessionStorage) {
      window.sessionStorage.clear();
      sessionStorageCleared = true;
    }
  } catch {
    sessionStorageCleared = false;
  }

  return {
    removedCount: keys.length,
    sessionStorageCleared,
    analyticsPreserved: preserveAnalytics
  };
}

async function clearAppCacheStorage() {
  if (typeof caches === 'undefined' || typeof caches.keys !== 'function') return 0;
  try {
    const cacheNames = await caches.keys();
    const appCacheNames = cacheNames.filter((name) => String(name || '').startsWith('ai-dca-'));
    await Promise.all(appCacheNames.map((name) => caches.delete(name)));
    return appCacheNames.length;
  } catch {
    return 0;
  }
}

/**
 * 清除本机所有应用数据，但保留本地埋点队列、访客标识和分析偏好。
 * 账号会话和安全密钥由调用方在远端删除成功后再清理，避免自动同步把空数据重新上传。
 */
export async function clearAllBrowserDataAsync({ preserveAnalytics = true } = {}) {
  const local = clearAllBrowserLocalStorage({ preserveAnalytics });
  const [marketHistoryCleared, navHistoryCleared, cacheStorageCount] = await Promise.all([
    clearMarketHistoryCache().catch(() => false),
    clearNavHistoryCache().then(() => true).catch(() => false),
    clearAppCacheStorage()
  ]);
  return {
    ...local,
    marketHistoryCleared,
    navHistoryCleared,
    cacheStorageCount
  };
}
