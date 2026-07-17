// 账号数据「单一来源」注册表。
//
// 过去「哪些 key 同步 + 各自怎么合并 + 哪些要触发持仓页刷新」散落在三处
// （webdavBackup 白名单、cloudSync 的 merge switch、holdings 的监听名单），
// 新增一个 key 要改三处、极易漏。此处用一份描述符集中声明，其余模块全部从这里派生。
//
// merge 策略（与 cloudSync.js 中的合并实现一一对应）：
//   'lww'           最后写入胜（默认，整值不可结构化合并的对象/标量）
//   'arrayById'     按 id 合并数组、保留较新记录（流水类）
//   'planStore'     plans 数组按 id 合并 + activePlanId 指针校正
//   'dcaStore'      同 planStore，但活动指针为 activeDcaId
//   'holdingsLedger' 只合并交易记录；持仓表格和净值快照由交易记录在本机派生
//   'objectMerge'   对象浅合并（本地覆盖远端同名字段）
//   'watchlist'     自选清单：lists 按 id 合并、清单内 us/cn 取并集

export const SYNC_REGISTRY = [
  // —— 持仓 / 交易 ——
  { key: 'aiDcaFundHoldingsLedger', tab: 'holdings', label: '持仓交易记录', merge: 'holdingsLedger', holdingsListener: true },
  { key: 'aiDcaAccountAllocationSettings', tab: 'holdings', label: '账户比例设置', merge: 'lww', holdingsListener: true },
  { key: 'aiDcaAccumulationState', tab: 'holdings', label: '累计配置', merge: 'lww' },
  // —— 策略 / 定投 ——
  { key: 'aiDcaPlanStore', tab: 'tradePlans', label: '策略库', merge: 'planStore' },
  { key: 'aiDcaPlanState', tab: 'tradePlans', label: '策略状态', merge: 'lww' },
  { key: 'aiDcaDcaStore', tab: 'tradePlans', label: '定投库', merge: 'dcaStore' },
  { key: 'aiDcaDcaState', tab: 'tradePlans', label: '定投状态', merge: 'lww' },
  // —— 卖出计划 ——
  { key: 'aiDcaSellPlanStore', tab: 'tradePlans', label: '卖出计划库', merge: 'arrayById' },
  // —— 换基策略 ——
  { key: 'aiDcaSwitchStrategyPrefs', tab: 'fundSwitch', label: '换基偏好', merge: 'lww' },
  { key: 'aiDcaSwitchWatchlist', tab: 'fundSwitch', label: '换基关注方案', merge: 'arrayById' },
  // —— VIX ——
  { key: 'aiDcaVixState', tab: 'tradePlans', label: 'VIX 状态', merge: 'lww' },
  // —— 全局偏好 ——
  { key: 'aiDcaWorkspacePrefs', tab: 'global', label: '工作台偏好', merge: 'lww' },
  { key: 'aiDcaHomeDashboardState', tab: 'global', label: '首页看板偏好', merge: 'lww' },
  // —— 新增覆盖项 ——
  { key: 'markets:watchlist:v1', tab: 'markets', label: '自选清单', merge: 'watchlist' },
  { key: 'markets:groups:v1', tab: 'markets', label: '市场分组', merge: 'objectMerge' },
  { key: 'markets:columnVisibility', tab: 'markets', label: '行情列显示', merge: 'objectMerge' },
  { key: 'markets:tableViewState:v1', tab: 'markets', label: '行情表格视图', merge: 'objectMerge' },
  { key: 'aiDcaAnalyticsOptOut_v1', tab: 'global', label: '分析偏好', merge: 'lww' },
  { key: 'aiDcaPremiumState', tab: 'global', label: '会员状态', merge: 'lww' },
];

// 已有领域 REST 接口的数据不再复制到 /api/sync/{tab}/{resource}。
// 这些 key 仍保留在总注册表中，供旧版合并逻辑识别策略；新账号数据同步
// 不会把它们加入远端资源，也不会把它们写入通用同步 envelope。
export const DOMAIN_API_REGISTRY = [
  { key: 'aiDcaSwitchStrategyWorkerConfig', tab: 'fundSwitch', label: '换基 Worker 配置', merge: 'lww', apis: ['/api/notify/switch/config'] },
  { key: 'aiDcaNotifyClientConfig', tab: 'notify', label: '通知客户端配置', merge: 'lww', apis: ['/api/notify/settings', '/api/notify/switch/config'] },
  { key: 'aiDcaWebNotifyConfig', tab: 'notify', label: 'Web 通知配置', merge: 'lww', apis: ['browser-local'] },
  { key: 'aiDcaMarketAlerts', tab: 'notify', label: '行情提醒规则', merge: 'arrayById', apis: ['/api/notify/sync'] },
  { key: 'aiDcaHoldingAlerts', tab: 'notify', label: '持仓提醒规则', merge: 'arrayById', apis: ['/api/notify/sync'] },
];

// 登录态 / 同步元数据 / 设备密钥 / 安装实例 id / 临时 toast —— 永不进入同步 envelope。
export const TRANSIENT_SYNC_KEYS = new Set([
  'aiDcaPendingToasts',
  'aiDcaCloudSyncSession',
  'aiDcaCloudSyncMeta',
  'aiDcaCloudSyncV2Meta',
  'aiDcaSecureSyncRememberedKey',
  'aiDcaSyncClientId',
]);

const REGISTRY_BY_KEY = new Map([...SYNC_REGISTRY, ...DOMAIN_API_REGISTRY].map((descriptor) => [descriptor.key, descriptor]));

export const RESOURCE_REGISTRY = SYNC_REGISTRY.map((descriptor) => ({
  resourceId: descriptor.key,
  legacyKeys: [descriptor.key],
  schemaVersion: 1,
  scope: 'remote',
  saveMode: descriptor.merge === 'lww' ? 'debounced' : 'explicit-or-debounced',
  ...descriptor
}));

// 新版按 Tab 访问的 REST 资源。resource 是稳定的接口路径，不把
// localStorage key 暴露给页面，也不再把整个账号打成一个同步快照。
// 只有持仓交易流水属于敏感数据，仍要求客户端使用安全密码加密。
const TAB_RESOURCE_ROUTE_BY_KEY = {
  aiDcaFundHoldingsLedger: { tab: 'holdings', resource: 'transactions', security: 'encrypted' },
  aiDcaAccountAllocationSettings: { tab: 'holdings', resource: 'allocation-settings', security: 'plain' },
  aiDcaAccumulationState: { tab: 'holdings', resource: 'accumulation', security: 'plain' },
  aiDcaPlanStore: { tab: 'trade-plans', resource: 'plans', security: 'plain' },
  aiDcaPlanState: { tab: 'trade-plans', resource: 'plan-state', security: 'plain' },
  aiDcaDcaStore: { tab: 'trade-plans', resource: 'dca', security: 'plain' },
  aiDcaDcaState: { tab: 'trade-plans', resource: 'dca-state', security: 'plain' },
  aiDcaSellPlanStore: { tab: 'trade-plans', resource: 'sell-plans', security: 'plain' },
  aiDcaVixState: { tab: 'trade-plans', resource: 'vix', security: 'plain' },
  aiDcaSwitchStrategyPrefs: { tab: 'fund-switch', resource: 'prefs', security: 'plain' },
  aiDcaSwitchWatchlist: { tab: 'fund-switch', resource: 'watchlist', security: 'plain' },
  aiDcaWorkspacePrefs: { tab: 'global', resource: 'workspace-prefs', security: 'plain' },
  aiDcaHomeDashboardState: { tab: 'global', resource: 'home-dashboard', security: 'plain' },
  'markets:watchlist:v1': { tab: 'markets', resource: 'watchlist', security: 'plain' },
  'markets:groups:v1': { tab: 'markets', resource: 'groups', security: 'plain' },
  'markets:columnVisibility': { tab: 'markets', resource: 'column-visibility', security: 'plain' },
  'markets:tableViewState:v1': { tab: 'markets', resource: 'table-view', security: 'plain' },
  aiDcaAnalyticsOptOut_v1: { tab: 'global', resource: 'analytics-opt-out', security: 'plain' },
  aiDcaPremiumState: { tab: 'global', resource: 'premium-state', security: 'plain' }
};

export const TAB_RESOURCE_REGISTRY = Object.entries(TAB_RESOURCE_ROUTE_BY_KEY).map(([key, route]) => ({
  key,
  ...route
}));

const TAB_RESOURCE_BY_KEY = new Map(TAB_RESOURCE_REGISTRY.map((descriptor) => [descriptor.key, descriptor]));
const TAB_RESOURCE_BY_ROUTE = new Map(TAB_RESOURCE_REGISTRY.map((descriptor) => [
  `${descriptor.tab}/${descriptor.resource}`,
  descriptor
]));
const TAB_GROUP_ALIASES = new Map([
  ['tradePlans', 'trade-plans'],
  ['fundSwitch', 'fund-switch']
]);

// 这些旧 key 是由交易记录 / 行情重新计算出的兼容缓存，不再作为账号资源同步。
export const DERIVED_HOLDINGS_KEYS = new Set([
  'aiDcaFundHoldingsState',
  'aiDcaPositionSnapshot'
]);

export const HOLDINGS_LEDGER_RESOURCE_KEY = 'aiDcaFundHoldingsLedger';

/**
 * 生成持仓资源的云端投影：只保存交易记录，避免 NAV 快照、刷新状态等派生字段
 * 因本机行情刷新反复推进资源 revision。
 */
export function serializeSyncResourceValue(key, raw) {
  if (String(key || '') !== HOLDINGS_LEDGER_RESOURCE_KEY) return raw;
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return raw; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw;
  return JSON.stringify({
    source: 'ai-dca-trade-ledger',
    version: 1,
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : []
  });
}

// 通用账号资源同步 key。领域 API 数据不能进入这份集合，否则 userDataStore
// 会把它们误写入 /api/sync/{tab}/{resource}。
export const SYNCABLE_STORAGE_KEYS = new Set(
  SYNC_REGISTRY.map((descriptor) => descriptor.key)
);
export const DOMAIN_API_STORAGE_KEYS = new Set(DOMAIN_API_REGISTRY.map((descriptor) => descriptor.key));
// 领域接口数据在 localStorage 中保留一份页面缓存/设备身份，但不进入通用账号资源。
export const DOMAIN_API_LOCAL_CACHE_KEYS = new Set(DOMAIN_API_STORAGE_KEYS);
export const REMOTE_RESOURCE_KEYS = new Set(SYNCABLE_STORAGE_KEYS);

// 只有交易流水需要敏感数据保护。持仓页其它设置仍按自己的明文 REST 资源保存。
export const HOLDINGS_BACKUP_KEYS = new Set([HOLDINGS_LEDGER_RESOURCE_KEY]);

// 需要在 storage / 备份恢复后刷新持仓页 React 状态的 key。
export const HOLDINGS_SYNC_KEYS = new Set(
  SYNC_REGISTRY.filter((descriptor) => descriptor.holdingsListener).map((descriptor) => descriptor.key)
);

// 返回某 key 的合并策略；未登记的 key 一律按最后写入胜处理。
export function getMergeStrategy(key) {
  return REGISTRY_BY_KEY.get(String(key || ''))?.merge || 'lww';
}

export function getResourceDescriptor(key) {
  const normalized = String(key || '');
  return RESOURCE_REGISTRY.find((descriptor) => descriptor.resourceId === normalized) || null;
}

export function getTabResourceDescriptor(key) {
  return TAB_RESOURCE_BY_KEY.get(String(key || '')) || null;
}

export function getTabResourceDescriptorByRoute(tab, resource) {
  return TAB_RESOURCE_BY_ROUTE.get(`${String(tab || '').trim()}/${String(resource || '').trim()}`) || null;
}

export function getTabResourceDescriptors(tab) {
  const input = String(tab || '').trim();
  const normalized = TAB_GROUP_ALIASES.get(input) || input;
  return TAB_RESOURCE_REGISTRY.filter((descriptor) => descriptor.tab === normalized);
}

export function isRemoteResource(key) {
  return REMOTE_RESOURCE_KEYS.has(String(key || ''));
}

// 是否为「可结构化自动合并」的 key（非 lww）。冲突归类时用来区分自动合并 vs 需手动选择。
export function isDomainMergeKey(key) {
  return getMergeStrategy(key) !== 'lww';
}
