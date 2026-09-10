// 前端侧账号资源目录。
// holdings/ledger 与 position-snapshot 保留 legacy 映射用于迁移/回滚，但不再走通用整块同步：
// holdings/ledger 由 holdingTransactionsSync 按交易行同步，position-snapshot 永久只读兼容。

import { SYNCABLE_STORAGE_KEYS, getMergeStrategy } from './syncRegistry.js';

export const ACCOUNT_RESOURCES = Object.freeze([
  { resource: 'holdings/ledger', feature: 'holdings', key: 'aiDcaFundHoldingsLedger', label: '持仓交易行', sync: false, rowSync: true },
  { resource: 'holdings/state', feature: 'holdings', key: 'aiDcaFundHoldingsState', label: '持仓页状态' },
  { resource: 'holdings/allocation', feature: 'holdings', key: 'aiDcaAccountAllocationSettings', label: '账户资金配置' },
  { resource: 'holdings/accumulation', feature: 'holdings', key: 'aiDcaAccumulationState', label: '加仓状态' },
  { resource: 'holdings/position-snapshot', feature: 'holdings', key: 'aiDcaPositionSnapshot', label: '旧持仓快照', sync: false, deprecated: true },
  { resource: 'trades/ledger', feature: 'trades', key: 'aiDcaTradeLedger', label: '交易流水' },
  { resource: 'trades/archive', feature: 'trades', key: 'aiDcaTradeLedgerArchive', label: '交易归档' },
  { resource: 'plans/store', feature: 'plans', key: 'aiDcaPlanStore', label: '建仓计划' },
  { resource: 'plans/state', feature: 'plans', key: 'aiDcaPlanState', label: '建仓计划视图状态' },
  { resource: 'dca/store', feature: 'dca', key: 'aiDcaDcaStore', label: '定投计划' },
  { resource: 'dca/state', feature: 'dca', key: 'aiDcaDcaState', label: '定投视图状态' },
  { resource: 'sell-plans/store', feature: 'sell-plans', key: 'aiDcaSellPlanStore', label: '卖出计划' },
  { resource: 'sell-plans/draft', feature: 'sell-plans', key: 'aiDcaSellPlanDraft', label: '卖出计划草稿' },
  { resource: 'vix/state', feature: 'vix', key: 'aiDcaVixState', label: 'VIX 状态' },
  { resource: 'fund-switch/prefs', feature: 'fund-switch', key: 'aiDcaSwitchStrategyPrefs', label: '转换策略偏好' },
  { resource: 'fund-switch/worker-config', feature: 'fund-switch', key: 'aiDcaSwitchStrategyWorkerConfig', label: '转换策略托管配置' },
  { resource: 'notify/client-config', feature: 'notify', key: 'aiDcaNotifyClientConfig', label: '通知客户端配置', runtimeRead: false },
  { resource: 'notify/web-config', feature: 'notify', key: 'aiDcaWebNotifyConfig', label: 'Web 通知配置', runtimeRead: false },
  { resource: 'notify/market-alerts', feature: 'notify', key: 'aiDcaMarketAlerts', label: '行情提醒' },
  { resource: 'notify/holding-alerts', feature: 'notify', key: 'aiDcaHoldingAlerts', label: '持仓提醒' },
  { resource: 'markets/watchlist', feature: 'markets', key: 'markets:watchlist:v1', label: '自选清单' },
  { resource: 'prefs/workspace', feature: 'prefs', key: 'aiDcaWorkspacePrefs', label: '工作台偏好' },
  { resource: 'prefs/home-dashboard', feature: 'prefs', key: 'aiDcaHomeDashboardState', label: '首页看板' },
  { resource: 'prefs/analytics-opt-out', feature: 'prefs', key: 'aiDcaAnalyticsOptOut_v1', label: '分析退出开关', runtimeRead: false },
  { resource: 'prefs/premium', feature: 'prefs', key: 'aiDcaPremiumState', label: '会员状态' }
]);

const BY_RESOURCE = new Map(ACCOUNT_RESOURCES.map((item) => [item.resource, item]));
const BY_KEY = new Map(ACCOUNT_RESOURCES.map((item) => [item.key, item]));

export function listAccountResources() {
  return ACCOUNT_RESOURCES.slice();
}

export function listAccountResourceNames() {
  return ACCOUNT_RESOURCES.filter((item) => item.sync !== false).map((item) => item.resource);
}

export function resourceForKey(key = '') {
  const item = BY_KEY.get(String(key || '')) || null;
  return item?.sync === false ? null : item;
}

export function keyForResource(resource = '') {
  const item = BY_RESOURCE.get(String(resource || ''));
  return item?.sync === false ? '' : (item?.key || '');
}

export function descriptorForResource(resource = '') {
  return BY_RESOURCE.get(String(resource || '')) || null;
}

export function descriptorForKey(key = '') {
  return BY_KEY.get(String(key || '')) || null;
}

export function listResourcesForFeature(feature = '') {
  return ACCOUNT_RESOURCES.filter((item) => item.feature === String(feature || '') && item.sync !== false);
}

export function mergeStrategyForResource(resource = '') {
  const item = BY_RESOURCE.get(String(resource || ''));
  if (item?.rowSync) return 'holdingsTransactions';
  const key = keyForResource(resource);
  return key ? getMergeStrategy(key) : 'lww';
}

export function unmappedRegistryKeys() {
  return Array.from(SYNCABLE_STORAGE_KEYS).filter((key) => !BY_KEY.has(key));
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return undefined; }
}

// 旧 envelope 拆分：交易资源保留 transactions，快照资源不再进入新账号事实。
export function splitEnvelopeIntoResources(envelope = {}) {
  const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const resources = {};
  const invalid = [];
  const unmapped = [];
  const deprecated = [];
  for (const [key, value] of Object.entries(payload)) {
    const descriptor = BY_KEY.get(String(key || ''));
    if (!descriptor) {
      unmapped.push(key);
      continue;
    }
    if (value === null || value === undefined) continue;
    const parsed = parseMaybeJson(value);
    if (parsed === undefined) {
      invalid.push(key);
      continue;
    }
    if (descriptor.deprecated) {
      deprecated.push(key);
      continue;
    }
    resources[descriptor.resource] = parsed;
  }
  return { resources, invalid, unmapped, deprecated, resourceCount: Object.keys(resources).length };
}

// 回滚/导出仍可生成旧 envelope，但不再写入 position-snapshot。
export function buildEnvelopeFromResources(resourceMap = {}) {
  const payload = {};
  for (const [resource, data] of Object.entries(resourceMap || {})) {
    const descriptor = BY_RESOURCE.get(resource);
    if (!descriptor || descriptor.deprecated || data === null || data === undefined) continue;
    const key = descriptor.key;
    if (!key) continue;
    payload[key] = typeof data === 'string' ? data : JSON.stringify(data);
  }
  const keys = Object.keys(payload).sort();
  return {
    version: 1,
    source: 'ai-dca',
    exportedAt: new Date().toISOString(),
    keyCount: keys.length,
    keys,
    payload: keys.reduce((acc, key) => { acc[key] = payload[key]; return acc; }, {})
  };
}
