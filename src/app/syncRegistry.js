// 账号云同步「单一来源」注册表。
//
// 账户同步 key、合并策略和持仓页刷新监听统一在这里声明，避免各同步入口维护不同清单。
//
// merge 策略由 syncV2/merge.js 实现：
//   'lww'           最后写入胜（默认，整值不可结构化合并的对象/标量）
//   'arrayById'     按 id 合并数组、保留较新记录（流水类）
//   'planStore'     plans 数组按 id 合并 + activePlanId 指针校正
//   'dcaStore'      同 planStore，但活动指针为 activeDcaId
//   'holdingsLedger' transactions/switchChains/snapshotsByCode 分别合并
//   'objectMerge'   对象浅合并（本地覆盖远端同名字段）
//   'watchlist'     自选清单：lists 按 id 合并、清单内 us/cn 取并集

export const SYNC_REGISTRY = [
  // —— 持仓 / 交易 ——
  { key: 'aiDcaFundHoldingsLedger', tab: 'holdings', label: '持仓流水', merge: 'holdingsLedger', adapter: 'holdingsLedger', scope: 'account', role: 'canonical', syncMode: 'collection', holdingsListener: true },
  { key: 'aiDcaFundHoldingsState', tab: 'holdings', label: '持仓状态', merge: 'lww', adapter: 'holdingsState', scope: 'account', role: 'derived', syncMode: 'document', holdingsListener: true },
  { key: 'aiDcaAccountAllocationSettings', tab: 'holdings', label: '账户比例设置', merge: 'lww', adapter: 'accountAllocationSettings', scope: 'account', role: 'canonical', syncMode: 'document', holdingsListener: true },
  { key: 'aiDcaTradeLedger', tab: 'holdings', label: '交易流水', merge: 'arrayById', adapter: 'tradeLedger', scope: 'account', role: 'canonical', syncMode: 'collection', holdingsListener: true },
  { key: 'aiDcaTradeLedgerArchive', tab: 'holdings', label: '交易归档', merge: 'arrayById', adapter: 'tradeLedgerArchive', scope: 'account', role: 'canonical', syncMode: 'collection' },
  { key: 'aiDcaAccumulationState', tab: 'holdings', label: '累计配置', merge: 'lww', adapter: 'accumulationState', scope: 'account', role: 'canonical', syncMode: 'document' },
  { key: 'aiDcaPositionSnapshot', tab: 'holdings', label: '仓位快照', merge: 'lww', adapter: 'positionSnapshot', scope: 'account', role: 'derived', syncMode: 'document' },
  // —— 策略 / 定投 ——
  { key: 'aiDcaPlanStore', tab: 'tradePlans', label: '策略库', merge: 'planStore', adapter: 'planStore', scope: 'account', role: 'canonical', syncMode: 'collection' },
  { key: 'aiDcaPlanState', tab: 'tradePlans', label: '策略状态', merge: 'lww', adapter: 'planState', scope: 'account', role: 'derived', syncMode: 'document' },
  { key: 'aiDcaDcaStore', tab: 'tradePlans', label: '定投库', merge: 'dcaStore', adapter: 'dcaStore', scope: 'account', role: 'canonical', syncMode: 'collection' },
  { key: 'aiDcaDcaState', tab: 'tradePlans', label: '定投状态', merge: 'lww', adapter: 'dcaState', scope: 'account', role: 'derived', syncMode: 'document' },
  // —— 卖出计划 ——
  { key: 'aiDcaSellPlanStore', tab: 'tradePlans', label: '卖出计划库', merge: 'arrayById', adapter: 'sellPlanStore', scope: 'account', role: 'canonical', syncMode: 'collection' },
  { key: 'aiDcaSellPlanDraft', tab: 'tradePlans', label: '卖出计划草稿', merge: 'lww', adapter: 'sellPlanDraft', scope: 'device', role: 'draft', syncMode: 'document' },
  // —— 换基策略 ——
  { key: 'aiDcaSwitchStrategyPrefs', tab: 'fundSwitch', label: '换基偏好', merge: 'lww', adapter: 'switchStrategyPrefs', scope: 'account', role: 'canonical', syncMode: 'document' },
  { key: 'aiDcaSwitchStrategyWorkerConfig', tab: 'fundSwitch', label: '换基 Worker 配置', merge: 'lww', adapter: 'switchStrategyWorkerConfig', scope: 'cache', role: 'derived', syncMode: 'document' },
  // —— VIX ——
  { key: 'aiDcaVixState', tab: 'tradePlans', label: 'VIX 状态', merge: 'lww', adapter: 'vixState', scope: 'cache', role: 'derived', syncMode: 'document' },
  // —— 通知 ——
  { key: 'aiDcaNotifyClientConfig', tab: 'notify', label: '通知客户端配置', merge: 'lww', adapter: 'notifyClientConfig', scope: 'device', role: 'canonical', syncMode: 'document' },
  { key: 'aiDcaWebNotifyConfig', tab: 'notify', label: 'Web 通知配置', merge: 'lww', adapter: 'webNotifyConfig', scope: 'device', role: 'canonical', syncMode: 'document' },
  { key: 'aiDcaMarketAlerts', tab: 'notify', label: '行情提醒规则', merge: 'arrayById', adapter: 'marketAlerts', scope: 'account', role: 'canonical', syncMode: 'collection' },
  { key: 'aiDcaHoldingAlerts', tab: 'notify', label: '持仓提醒规则', merge: 'arrayById', adapter: 'holdingAlerts', scope: 'account', role: 'canonical', syncMode: 'collection' },
  // —— 全局偏好 ——
  { key: 'aiDcaWorkspacePrefs', tab: 'global', label: '工作台偏好', merge: 'lww', adapter: 'workspacePrefs', scope: 'account', role: 'canonical', syncMode: 'document' },
  { key: 'aiDcaHomeDashboardState', tab: 'global', label: '首页看板偏好', merge: 'lww', adapter: 'homeDashboardState', scope: 'account', role: 'canonical', syncMode: 'document' },
  // —— 新增覆盖项 ——
  { key: 'markets:watchlist:v1', tab: 'markets', label: '自选清单', merge: 'watchlist', adapter: 'watchlist', scope: 'account', role: 'canonical', syncMode: 'collection' },
  { key: 'aiDcaAnalyticsOptOut_v1', tab: 'global', label: '分析偏好', merge: 'lww', adapter: 'analyticsOptOut', scope: 'device', role: 'canonical', syncMode: 'document' },
  { key: 'aiDcaPremiumState', tab: 'global', label: '会员状态', merge: 'lww', adapter: 'premiumState', scope: 'cache', role: 'derived', syncMode: 'document' },
];

const REGISTRY_BY_KEY = new Map(SYNC_REGISTRY.map((descriptor) => [descriptor.key, descriptor]));

// V2 第一阶段只同步账户级 canonical key。
export const V2_ACCOUNT_SYNC_DESCRIPTORS = SYNC_REGISTRY.filter((descriptor) => (
  descriptor.scope === 'account' && descriptor.role === 'canonical'
));

export const V2_ACCOUNT_SYNC_KEYS = new Set(V2_ACCOUNT_SYNC_DESCRIPTORS.map((descriptor) => descriptor.key));

export function getV2AccountSyncDescriptors() {
  return V2_ACCOUNT_SYNC_DESCRIPTORS.slice();
}

export function isV2AccountSyncKey(key) {
  return V2_ACCOUNT_SYNC_KEYS.has(String(key || ''));
}

// 需要在 storage / 备份恢复后刷新持仓页 React 状态的 key。
export const HOLDINGS_SYNC_KEYS = new Set(
  SYNC_REGISTRY.filter((descriptor) => descriptor.holdingsListener).map((descriptor) => descriptor.key)
);

// 返回某 key 的合并策略；未登记的 key 一律按最后写入胜处理。
export function getMergeStrategy(key) {
  return REGISTRY_BY_KEY.get(String(key || ''))?.merge || 'lww';
}
