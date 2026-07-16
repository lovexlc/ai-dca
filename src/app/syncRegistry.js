// 账号云同步「单一来源」注册表。
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
//   'holdingsLedger' transactions/switchChains/snapshotsByCode 分别合并
//   'objectMerge'   对象浅合并（本地覆盖远端同名字段）
//   'watchlist'     自选清单：lists 按 id 合并、清单内 us/cn 取并集

export const SYNC_REGISTRY = [
  // —— 持仓 / 交易 ——
  { key: 'aiDcaFundHoldingsLedger', tab: 'holdings', label: '持仓流水', merge: 'holdingsLedger', holdingsListener: true },
  { key: 'aiDcaFundHoldingsState', tab: 'holdings', label: '持仓状态', merge: 'lww', holdingsListener: true },
  { key: 'aiDcaAccountAllocationSettings', tab: 'holdings', label: '账户比例设置', merge: 'lww', holdingsListener: true },
  { key: 'aiDcaTradeLedger', tab: 'holdings', label: '交易流水', merge: 'arrayById', holdingsListener: true },
  { key: 'aiDcaTradeLedgerArchive', tab: 'holdings', label: '交易归档', merge: 'arrayById' },
  { key: 'aiDcaAccumulationState', tab: 'holdings', label: '累计配置', merge: 'lww' },
  { key: 'aiDcaPositionSnapshot', tab: 'holdings', label: '仓位快照', merge: 'lww' },
  // —— 策略 / 定投 ——
  { key: 'aiDcaPlanStore', tab: 'tradePlans', label: '策略库', merge: 'planStore' },
  { key: 'aiDcaPlanState', tab: 'tradePlans', label: '策略状态', merge: 'lww' },
  { key: 'aiDcaDcaStore', tab: 'tradePlans', label: '定投库', merge: 'dcaStore' },
  { key: 'aiDcaDcaState', tab: 'tradePlans', label: '定投状态', merge: 'lww' },
  // —— 卖出计划 ——
  { key: 'aiDcaSellPlanStore', tab: 'tradePlans', label: '卖出计划库', merge: 'arrayById' },
  { key: 'aiDcaSellPlanDraft', tab: 'tradePlans', label: '卖出计划草稿', merge: 'lww' },
  // —— 换基策略 ——
  { key: 'aiDcaSwitchStrategyPrefs', tab: 'fundSwitch', label: '换基偏好', merge: 'lww' },
  { key: 'aiDcaSwitchStrategyWorkerConfig', tab: 'fundSwitch', label: '换基 Worker 配置', merge: 'lww' },
  { key: 'aiDcaSwitchWatchlist', tab: 'fundSwitch', label: '换基关注方案', merge: 'arrayById' },
  // —— VIX ——
  { key: 'aiDcaVixState', tab: 'tradePlans', label: 'VIX 状态', merge: 'lww' },
  // —— 通知 ——
  { key: 'aiDcaNotifyClientConfig', tab: 'notify', label: '通知客户端配置', merge: 'lww' },
  { key: 'aiDcaWebNotifyConfig', tab: 'notify', label: 'Web 通知配置', merge: 'lww' },
  { key: 'aiDcaMarketAlerts', tab: 'notify', label: '行情提醒规则', merge: 'arrayById' },
  { key: 'aiDcaHoldingAlerts', tab: 'notify', label: '持仓提醒规则', merge: 'arrayById' },
  // —— 全局偏好 ——
  { key: 'aiDcaWorkspacePrefs', tab: 'global', label: '工作台偏好', merge: 'lww' },
  { key: 'aiDcaHomeDashboardState', tab: 'global', label: '首页看板偏好', merge: 'lww' },
  // —— 新增覆盖项 ——
  { key: 'markets:watchlist:v1', tab: 'markets', label: '自选清单', merge: 'watchlist' },
  { key: 'aiDcaAnalyticsOptOut_v1', tab: 'global', label: '分析偏好', merge: 'lww' },
  { key: 'aiDcaPremiumState', tab: 'global', label: '会员状态', merge: 'lww' },
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

const REGISTRY_BY_KEY = new Map(SYNC_REGISTRY.map((descriptor) => [descriptor.key, descriptor]));

// 可同步 key 全集。
export const SYNCABLE_STORAGE_KEYS = new Set(SYNC_REGISTRY.map((descriptor) => descriptor.key));

// 需要在 storage / 备份恢复后刷新持仓页 React 状态的 key。
export const HOLDINGS_SYNC_KEYS = new Set(
  SYNC_REGISTRY.filter((descriptor) => descriptor.holdingsListener).map((descriptor) => descriptor.key)
);

// V2 密文同步只承载持仓域；策略、通知和行情配置走各自的接口或留在本机，
// 不应因为它们变化而要求用户输入持仓安全密码。
export const HOLDINGS_BACKUP_KEYS = new Set(
  SYNC_REGISTRY.filter((descriptor) => descriptor.tab === 'holdings').map((descriptor) => descriptor.key)
);

// 非持仓配置走账号鉴权的明文 KV 接口。换基 Worker 自己维护配置，因此不在这里重复同步。
const WORKER_OWNED_SYNC_KEYS = new Set([
  'aiDcaSwitchStrategyPrefs',
  'aiDcaSwitchStrategyWorkerConfig',
  // 通知 client secret 由通知服务自己的 client 配置接口管理，不能落入明文通用 KV。
  'aiDcaNotifyClientConfig'
]);
export const NON_HOLDINGS_SYNC_KEYS = new Set(
  SYNC_REGISTRY
    .filter((descriptor) => descriptor.tab !== 'holdings' && !WORKER_OWNED_SYNC_KEYS.has(descriptor.key))
    .map((descriptor) => descriptor.key)
);

// 返回某 key 的合并策略；未登记的 key 一律按最后写入胜处理。
export function getMergeStrategy(key) {
  return REGISTRY_BY_KEY.get(String(key || ''))?.merge || 'lww';
}

// 是否为「可结构化自动合并」的 key（非 lww）。冲突归类时用来区分自动合并 vs 需手动选择。
export function isDomainMergeKey(key) {
  return getMergeStrategy(key) !== 'lww';
}
