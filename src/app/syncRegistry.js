// 账号云同步注册表。持仓交易已切换为独立行同步，旧 snapshot 只保留兼容读取。

export const SYNC_REGISTRY = [
  { key: 'aiDcaFundHoldingsState', tab: 'holdings', label: '持仓状态', merge: 'lww', holdingsListener: true },
  { key: 'aiDcaAccountAllocationSettings', tab: 'holdings', label: '账户比例设置', merge: 'lww', holdingsListener: true },
  { key: 'aiDcaAccumulationState', tab: 'holdings', label: '累计配置', merge: 'lww' },
  { key: 'aiDcaTradeLedger', tab: 'holdings', label: '交易流水', merge: 'arrayById', holdingsListener: true },
  { key: 'aiDcaTradeLedgerArchive', tab: 'holdings', label: '交易归档', merge: 'arrayById' },
  { key: 'aiDcaPlanStore', tab: 'tradePlans', label: '策略库', merge: 'planStore' },
  { key: 'aiDcaPlanState', tab: 'tradePlans', label: '策略状态', merge: 'lww' },
  { key: 'aiDcaDcaStore', tab: 'tradePlans', label: '定投库', merge: 'dcaStore' },
  { key: 'aiDcaDcaState', tab: 'tradePlans', label: '定投状态', merge: 'lww' },
  { key: 'aiDcaSellPlanStore', tab: 'tradePlans', label: '卖出计划库', merge: 'arrayById' },
  { key: 'aiDcaSellPlanDraft', tab: 'tradePlans', label: '卖出计划草稿', merge: 'lww' },
  { key: 'aiDcaSwitchStrategyPrefs', tab: 'fundSwitch', label: '换基偏好', merge: 'lww' },
  { key: 'aiDcaSwitchStrategyWorkerConfig', tab: 'fundSwitch', label: '换基 Worker 配置', merge: 'lww' },
  { key: 'aiDcaVixState', tab: 'tradePlans', label: 'VIX 状态', merge: 'lww' },
  { key: 'aiDcaNotifyClientConfig', tab: 'notify', label: '通知客户端配置', merge: 'lww' },
  { key: 'aiDcaWebNotifyConfig', tab: 'notify', label: 'Web 通知配置', merge: 'lww' },
  { key: 'aiDcaMarketAlerts', tab: 'notify', label: '行情提醒规则', merge: 'arrayById' },
  { key: 'aiDcaHoldingAlerts', tab: 'notify', label: '持仓提醒规则', merge: 'arrayById' },
  { key: 'aiDcaWorkspacePrefs', tab: 'global', label: '工作台偏好', merge: 'lww' },
  { key: 'aiDcaHomeDashboardState', tab: 'global', label: '首页看板', merge: 'lww' },
  { key: 'markets:watchlist:v1', tab: 'markets', label: '自选清单', merge: 'watchlist' },
  { key: 'aiDcaAnalyticsOptOut_v1', tab: 'global', label: '分析偏好', merge: 'lww' },
  { key: 'aiDcaPremiumState', tab: 'global', label: '会员状态', merge: 'lww' }
];

export const TRANSIENT_SYNC_KEYS = new Set([
  'aiDcaPendingToasts',
  'aiDcaCloudSyncSession',
  'aiDcaCloudSyncMeta',
  'aiDcaSecureSyncRememberedKey',
  'aiDcaSyncClientId'
]);

const REGISTRY_BY_KEY = new Map(SYNC_REGISTRY.map((descriptor) => [descriptor.key, descriptor]));
export const SYNCABLE_STORAGE_KEYS = new Set([
  ...SYNC_REGISTRY.map((descriptor) => descriptor.key),
  // 本地 envelope / 导出仍需携带交易行；实际云端写入由 holdingTransactionsSync 接管。
  'aiDcaFundHoldingsLedger'
]);

// 持仓交易行和旧快照不走通用资源同步，但仍需要让持仓页面监听跨页恢复事件。
export const HOLDINGS_SYNC_KEYS = new Set([
  ...SYNC_REGISTRY.filter((descriptor) => descriptor.holdingsListener).map((descriptor) => descriptor.key),
  'aiDcaFundHoldingsLedger',
  'aiDcaPositionSnapshot'
]);

export function getMergeStrategy(key) {
  if (String(key || '') === 'aiDcaFundHoldingsLedger') return 'holdingsTransactions';
  return REGISTRY_BY_KEY.get(String(key || ''))?.merge || 'lww';
}

export function isDomainMergeKey(key) {
  return getMergeStrategy(key) !== 'lww';
}
