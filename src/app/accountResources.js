// 前端侧的账号资源目录：把 localStorage key 映射到「功能/资源」的 RESTful 路径。
// 必须与 workers/account/src/catalog.js 完全一致（test/accountResourceSync.test.mjs 会逐项比对）。

import { SYNCABLE_STORAGE_KEYS, getMergeStrategy } from './syncRegistry.js';

export const ACCOUNT_RESOURCES = Object.freeze([
  { resource: 'holdings/ledger', feature: 'holdings', key: 'aiDcaFundHoldingsLedger', label: '持仓账本' },
  { resource: 'holdings/state', feature: 'holdings', key: 'aiDcaFundHoldingsState', label: '持仓页状态' },
  { resource: 'holdings/allocation', feature: 'holdings', key: 'aiDcaAccountAllocationSettings', label: '账户资金配置' },
  { resource: 'holdings/accumulation', feature: 'holdings', key: 'aiDcaAccumulationState', label: '加仓状态' },
  { resource: 'holdings/position-snapshot', feature: 'holdings', key: 'aiDcaPositionSnapshot', label: '持仓快照' },
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
  { resource: 'notify/client-config', feature: 'notify', key: 'aiDcaNotifyClientConfig', label: '通知客户端配置' },
  { resource: 'notify/web-config', feature: 'notify', key: 'aiDcaWebNotifyConfig', label: 'Web 通知配置' },
  { resource: 'notify/market-alerts', feature: 'notify', key: 'aiDcaMarketAlerts', label: '行情提醒' },
  { resource: 'notify/holding-alerts', feature: 'notify', key: 'aiDcaHoldingAlerts', label: '持仓提醒' },
  { resource: 'markets/watchlist', feature: 'markets', key: 'markets:watchlist:v1', label: '自选清单' },
  { resource: 'prefs/workspace', feature: 'prefs', key: 'aiDcaWorkspacePrefs', label: '工作台偏好' },
  { resource: 'prefs/home-dashboard', feature: 'prefs', key: 'aiDcaHomeDashboardState', label: '首页看板' },
  { resource: 'prefs/analytics-opt-out', feature: 'prefs', key: 'aiDcaAnalyticsOptOut_v1', label: '分析退出开关' },
  { resource: 'prefs/premium', feature: 'prefs', key: 'aiDcaPremiumState', label: '会员状态' }
]);

const BY_RESOURCE = new Map(ACCOUNT_RESOURCES.map((item) => [item.resource, item]));
const BY_KEY = new Map(ACCOUNT_RESOURCES.map((item) => [item.key, item]));

export function listAccountResources() {
  return ACCOUNT_RESOURCES.slice();
}

export function listAccountResourceNames() {
  return ACCOUNT_RESOURCES.map((item) => item.resource);
}

export function resourceForKey(key = '') {
  return BY_KEY.get(String(key || '')) || null;
}

export function keyForResource(resource = '') {
  return BY_RESOURCE.get(String(resource || ''))?.key || '';
}

export function descriptorForResource(resource = '') {
  return BY_RESOURCE.get(String(resource || '')) || null;
}

export function listResourcesForFeature(feature = '') {
  return ACCOUNT_RESOURCES.filter((item) => item.feature === String(feature || ''));
}

export function mergeStrategyForResource(resource = '') {
  const key = keyForResource(resource);
  return key ? getMergeStrategy(key) : 'lww';
}

// 白名单里没有对应资源的 key（应该永远为空，由测试看守）。
export function unmappedRegistryKeys() {
  return Array.from(SYNCABLE_STORAGE_KEYS).filter((key) => !BY_KEY.has(key));
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

// 把旧的一大块 envelope 拆成逐功能资源（存量迁移的核心映射）。
export function splitEnvelopeIntoResources(envelope = {}) {
  const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const resources = {};
  const invalid = [];
  const unmapped = [];
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
    resources[descriptor.resource] = parsed;
  }
  return { resources, invalid, unmapped, resourceCount: Object.keys(resources).length };
}

// 反向：把逐资源数据拼回 envelope 形态（本地导出 / 冲突展示复用旧逻辑）。
export function buildEnvelopeFromResources(resourceMap = {}) {
  const payload = {};
  for (const [resource, data] of Object.entries(resourceMap || {})) {
    const key = keyForResource(resource);
    if (!key || data === null || data === undefined) continue;
    payload[key] = typeof data === 'string' ? data : JSON.stringify(data);
  }
  const keys = Object.keys(payload).sort();
  return {
    version: 1,
    source: 'ai-dca',
    exportedAt: new Date().toISOString(),
    keyCount: keys.length,
    keys,
    payload: keys.reduce((acc, key) => {
      acc[key] = payload[key];
      return acc;
    }, {})
  };
}
