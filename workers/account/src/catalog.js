// 账号数据资源目录：RESTful 契约的单一事实来源。
// 设计参考 ai-dca-miniprogram：每个功能只读写自己的接口，不再整包上传 / 下载。
// 资源名必须与前端 src/app/accountResources.js 完全一致（test/accountResourceSync.test.mjs 会校验）。

export const RESOURCE_API_PREFIX = '/api/account/v1';
export const MAX_RESOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const RESOURCE_HISTORY_LIMIT = 10;

// shape：'array' | 'object' | 'any'，只用于形态校验与 PATCH 语义推断。
// merge：与前端 syncRegistry.js 的合并策略对齐；服务端不做业务合并，仅在冲突响应里回传给客户端。
export const RESOURCE_CATALOG = Object.freeze([
  { resource: 'holdings/ledger', feature: 'holdings', legacyKey: 'aiDcaFundHoldingsLedger', shape: 'object', merge: 'holdingsLedger', label: '持仓账本' },
  { resource: 'holdings/state', feature: 'holdings', legacyKey: 'aiDcaFundHoldingsState', shape: 'any', merge: 'lww', label: '持仓页状态' },
  { resource: 'holdings/allocation', feature: 'holdings', legacyKey: 'aiDcaAccountAllocationSettings', shape: 'any', merge: 'lww', label: '账户资金配置' },
  { resource: 'holdings/accumulation', feature: 'holdings', legacyKey: 'aiDcaAccumulationState', shape: 'any', merge: 'lww', label: '加仓状态' },
  { resource: 'holdings/position-snapshot', feature: 'holdings', legacyKey: 'aiDcaPositionSnapshot', shape: 'any', merge: 'lww', label: '持仓快照' },
  { resource: 'trades/ledger', feature: 'trades', legacyKey: 'aiDcaTradeLedger', shape: 'array', merge: 'arrayById', label: '交易流水' },
  { resource: 'trades/archive', feature: 'trades', legacyKey: 'aiDcaTradeLedgerArchive', shape: 'array', merge: 'arrayById', label: '交易归档' },
  { resource: 'plans/store', feature: 'plans', legacyKey: 'aiDcaPlanStore', shape: 'object', merge: 'planStore', label: '建仓计划' },
  { resource: 'plans/state', feature: 'plans', legacyKey: 'aiDcaPlanState', shape: 'any', merge: 'lww', label: '建仓计划视图状态' },
  { resource: 'dca/store', feature: 'dca', legacyKey: 'aiDcaDcaStore', shape: 'object', merge: 'dcaStore', label: '定投计划' },
  { resource: 'dca/state', feature: 'dca', legacyKey: 'aiDcaDcaState', shape: 'any', merge: 'lww', label: '定投视图状态' },
  { resource: 'sell-plans/store', feature: 'sell-plans', legacyKey: 'aiDcaSellPlanStore', shape: 'array', merge: 'arrayById', label: '卖出计划' },
  { resource: 'sell-plans/draft', feature: 'sell-plans', legacyKey: 'aiDcaSellPlanDraft', shape: 'any', merge: 'lww', label: '卖出计划草稿' },
  { resource: 'vix/state', feature: 'vix', legacyKey: 'aiDcaVixState', shape: 'any', merge: 'lww', label: 'VIX 状态' },
  { resource: 'fund-switch/prefs', feature: 'fund-switch', legacyKey: 'aiDcaSwitchStrategyPrefs', shape: 'any', merge: 'lww', label: '转换策略偏好' },
  { resource: 'fund-switch/worker-config', feature: 'fund-switch', legacyKey: 'aiDcaSwitchStrategyWorkerConfig', shape: 'any', merge: 'lww', label: '转换策略托管配置' },
  { resource: 'notify/client-config', feature: 'notify', legacyKey: 'aiDcaNotifyClientConfig', shape: 'any', merge: 'lww', label: '通知客户端配置' },
  { resource: 'notify/web-config', feature: 'notify', legacyKey: 'aiDcaWebNotifyConfig', shape: 'any', merge: 'lww', label: 'Web 通知配置' },
  { resource: 'notify/market-alerts', feature: 'notify', legacyKey: 'aiDcaMarketAlerts', shape: 'array', merge: 'arrayById', label: '行情提醒' },
  { resource: 'notify/holding-alerts', feature: 'notify', legacyKey: 'aiDcaHoldingAlerts', shape: 'array', merge: 'arrayById', label: '持仓提醒' },
  { resource: 'markets/watchlist', feature: 'markets', legacyKey: 'markets:watchlist:v1', shape: 'object', merge: 'watchlist', label: '自选清单' },
  { resource: 'prefs/workspace', feature: 'prefs', legacyKey: 'aiDcaWorkspacePrefs', shape: 'any', merge: 'lww', label: '工作台偏好' },
  { resource: 'prefs/home-dashboard', feature: 'prefs', legacyKey: 'aiDcaHomeDashboardState', shape: 'any', merge: 'lww', label: '首页看板' },
  { resource: 'prefs/analytics-opt-out', feature: 'prefs', legacyKey: 'aiDcaAnalyticsOptOut_v1', shape: 'any', merge: 'lww', label: '分析退出开关' },
  { resource: 'prefs/premium', feature: 'prefs', legacyKey: 'aiDcaPremiumState', shape: 'any', merge: 'lww', label: '会员状态' }
]);

const RESOURCE_BY_NAME = new Map(RESOURCE_CATALOG.map((item) => [item.resource, item]));
const RESOURCE_BY_LEGACY_KEY = new Map(RESOURCE_CATALOG.map((item) => [item.legacyKey, item]));

export function listResourceDescriptors() {
  return RESOURCE_CATALOG.slice();
}

export function getResourceDescriptor(resource = '') {
  return RESOURCE_BY_NAME.get(String(resource || '')) || null;
}

export function getResourceByLegacyKey(key = '') {
  return RESOURCE_BY_LEGACY_KEY.get(String(key || '')) || null;
}

export function listFeatures() {
  return Array.from(new Set(RESOURCE_CATALOG.map((item) => item.feature)));
}

// 路由解析：只认目录里存在的 feature/resource，未知路径一律 404，避免被当作任意键值仓库使用。
export function parseAccountPath(pathname = '') {
  const path = String(pathname || '').replace(/\/+$/, '');
  if (path !== RESOURCE_API_PREFIX && !path.startsWith(`${RESOURCE_API_PREFIX}/`)) return { kind: 'unknown' };
  const segments = path.slice(RESOURCE_API_PREFIX.length).split('/').filter(Boolean);
  if (!segments.length) return { kind: 'root' };
  if (segments.length === 1) {
    if (segments[0] === 'health') return { kind: 'health' };
    if (segments[0] === 'manifest') return { kind: 'manifest' };
    if (segments[0] === 'bundle') return { kind: 'bundle' };
    return { kind: 'unknown' };
  }
  if (segments[0] === 'exports' && segments[1] === 'envelope' && segments.length === 2) return { kind: 'export-envelope' };
  if (segments[0] === 'migrations' && segments[1] === 'legacy') {
    if (segments.length === 2) return { kind: 'migration' };
    if (segments.length === 3 && segments[2] === 'skip') return { kind: 'migration-skip' };
    return { kind: 'unknown' };
  }
  const descriptor = RESOURCE_BY_NAME.get(`${segments[0]}/${segments[1]}`);
  if (!descriptor) return { kind: 'unknown' };
  if (segments.length === 2) return { kind: 'resource', descriptor };
  if (segments.length === 4 && segments[2] === 'items') {
    const itemId = decodeURIComponent(segments[3] || '').trim();
    if (!itemId) return { kind: 'unknown' };
    return { kind: 'resource-item', descriptor, itemId };
  }
  return { kind: 'unknown' };
}

export function measureBytes(text = '') {
  return new TextEncoder().encode(String(text || '')).length;
}

export function validateResourcePayload(descriptor, data) {
  if (data === undefined) return { ok: false, code: 'PAYLOAD_REQUIRED', message: '缺少 data 字段' };
  if (descriptor.shape === 'array' && !Array.isArray(data)) {
    return { ok: false, code: 'SHAPE_MISMATCH', message: `${descriptor.resource} 需要数组类型` };
  }
  if (descriptor.shape === 'object' && (data === null || typeof data !== 'object' || Array.isArray(data))) {
    return { ok: false, code: 'SHAPE_MISMATCH', message: `${descriptor.resource} 需要对象类型` };
  }
  let serialized;
  try {
    serialized = JSON.stringify(data);
  } catch {
    serialized = undefined;
  }
  if (serialized === undefined) return { ok: false, code: 'PAYLOAD_UNSERIALIZABLE', message: '数据无法序列化为 JSON' };
  const bytes = measureBytes(serialized);
  if (bytes > MAX_RESOURCE_BYTES) {
    return { ok: false, code: 'PAYLOAD_TOO_LARGE', message: `单个资源不能超过 ${MAX_RESOURCE_BYTES} 字节`, bytes };
  }
  return { ok: true, bytes, serialized };
}
