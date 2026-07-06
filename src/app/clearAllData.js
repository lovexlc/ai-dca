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
export function getDataStats({ transactions = [], aggregates = [], tradeLedgerEntries = [] } = {}) {
  return {
    transactionCount: Array.isArray(transactions) ? transactions.length : 0,
    aggregateCount: Array.isArray(aggregates) ? aggregates.length : 0,
    tradeLedgerCount: Array.isArray(tradeLedgerEntries) ? tradeLedgerEntries.length : 0
  };
}

/**
 * 生成确认提示消息
 */
export function getClearDataConfirmMessage(stats) {
  return `即将清除所有本地数据：\n\n• ${stats.transactionCount} 笔交易记录\n• ${stats.aggregateCount} 只基金持仓\n• ${stats.tradeLedgerCount} 笔成本记录\n\n⚠️ 此操作不可恢复，确认清除？`;
}
