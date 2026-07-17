import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SYNC_REGISTRY,
  SYNCABLE_STORAGE_KEYS,
  HOLDINGS_SYNC_KEYS,
  TRANSIENT_SYNC_KEYS,
  DERIVED_HOLDINGS_KEYS,
  HOLDINGS_BACKUP_KEYS,
  TAB_RESOURCE_REGISTRY,
  DOMAIN_API_STORAGE_KEYS,
  DOMAIN_API_LOCAL_CACHE_KEYS,
  getTabResourceDescriptors,
  getTabResourceDescriptorByRoute,
  getMergeStrategy,
  isDomainMergeKey,
  serializeSyncResourceValue
} from '../src/app/syncRegistry.js';

// 与 cloudSync.js mergePayloadValue 的 switch 分支一一对应。新增策略必须同时在两处登记。
const KNOWN_STRATEGIES = new Set([
  'lww', 'arrayById', 'planStore', 'dcaStore', 'holdingsLedger', 'objectMerge', 'watchlist',
]);

test('registry keys are unique', () => {
  const keys = SYNC_REGISTRY.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length, '存在重复的同步 key');
});

test('every descriptor uses a known merge strategy', () => {
  for (const d of SYNC_REGISTRY) {
    assert.ok(KNOWN_STRATEGIES.has(d.merge), `未知合并策略：${d.key} -> ${d.merge}`);
  }
});

test('SYNCABLE_STORAGE_KEYS mirrors the registry exactly', () => {
  assert.equal(SYNCABLE_STORAGE_KEYS.size, SYNC_REGISTRY.length);
  for (const d of SYNC_REGISTRY) {
    assert.ok(SYNCABLE_STORAGE_KEYS.has(d.key), `白名单缺少 ${d.key}`);
  }
});

test('legacy trade ledger is no longer a synchronized resource', () => {
  assert.equal(SYNCABLE_STORAGE_KEYS.has('aiDcaTradeLedger'), false);
  assert.equal(SYNCABLE_STORAGE_KEYS.has('aiDcaTradeLedgerArchive'), false);
});

test('derived holdings state is not a cloud resource and ledger sync keeps transactions only', () => {
  for (const key of DERIVED_HOLDINGS_KEYS) assert.equal(SYNCABLE_STORAGE_KEYS.has(key), false);
  const serialized = serializeSyncResourceValue('aiDcaFundHoldingsLedger', JSON.stringify({
    transactions: [{ id: 'tx-1', code: '000001', type: 'BUY' }],
    snapshotsByCode: { '000001': { latestNav: 9.9 } },
    lastNavMeta: { status: 'success' }
  }));
  assert.deepEqual(JSON.parse(serialized), {
    source: 'ai-dca-trade-ledger',
    version: 1,
    transactions: [{ id: 'tx-1', code: '000001', type: 'BUY' }]
  });
});

test('getMergeStrategy reflects the registry and defaults to lww', () => {
  for (const d of SYNC_REGISTRY) {
    assert.equal(getMergeStrategy(d.key), d.merge);
  }
  assert.equal(getMergeStrategy('not-a-real-key'), 'lww');
  assert.equal(isDomainMergeKey('not-a-real-key'), false);
  assert.equal(isDomainMergeKey('aiDcaFundHoldingsLedger'), true);
  assert.equal(isDomainMergeKey('aiDcaVixState'), false);
});

test('newly covered keys are registered', () => {
  for (const key of ['markets:watchlist:v1', 'aiDcaAnalyticsOptOut_v1', 'aiDcaPremiumState', 'aiDcaAccountAllocationSettings']) {
    assert.ok(SYNCABLE_STORAGE_KEYS.has(key), `新增覆盖项缺失：${key}`);
  }
  assert.equal(getMergeStrategy('markets:watchlist:v1'), 'watchlist');
  assert.equal(getMergeStrategy('aiDcaAccountAllocationSettings'), 'lww');
});

test('换基 Worker 配置由领域接口负责，不进入通用 Tab 同步', () => {
  assert.ok(DOMAIN_API_STORAGE_KEYS.has('aiDcaSwitchStrategyWorkerConfig'));
  assert.ok(DOMAIN_API_LOCAL_CACHE_KEYS.has('aiDcaSwitchStrategyWorkerConfig'));
  assert.equal(SYNCABLE_STORAGE_KEYS.has('aiDcaSwitchStrategyWorkerConfig'), false);
  assert.equal(getTabResourceDescriptorByRoute('fund-switch', 'worker-config'), null);
});

test('holdings listener keys are a subset of syncable keys', () => {
  for (const key of HOLDINGS_SYNC_KEYS) {
    assert.ok(SYNCABLE_STORAGE_KEYS.has(key), `${key} 不在白名单内`);
  }
});

test('Tab 路由只把交易流水标为加密资源', () => {
  assert.equal(HOLDINGS_BACKUP_KEYS.size, 1);
  assert.ok(HOLDINGS_BACKUP_KEYS.has('aiDcaFundHoldingsLedger'));
  assert.equal(getTabResourceDescriptorByRoute('holdings', 'transactions').security, 'encrypted');
  assert.equal(getTabResourceDescriptorByRoute('holdings', 'allocation-settings').security, 'plain');
  assert.equal(getTabResourceDescriptorByRoute('trade-plans', 'plans').security, 'plain');
  assert.equal(TAB_RESOURCE_REGISTRY.length, SYNC_REGISTRY.length);
});

test('已有领域接口的数据不注册通用 Tab 同步路由', () => {
  for (const key of ['aiDcaNotifyClientConfig', 'aiDcaWebNotifyConfig', 'aiDcaMarketAlerts', 'aiDcaHoldingAlerts']) {
    assert.ok(DOMAIN_API_STORAGE_KEYS.has(key));
    assert.ok(DOMAIN_API_LOCAL_CACHE_KEYS.has(key));
    assert.equal(SYNCABLE_STORAGE_KEYS.has(key), false);
  }
  assert.equal(getTabResourceDescriptors('notify').length, 0);
  assert.equal(getTabResourceDescriptorByRoute('notify', 'client-config'), null);
});

test('transient keys never overlap syncable keys', () => {
  for (const key of TRANSIENT_SYNC_KEYS) {
    assert.ok(!SYNCABLE_STORAGE_KEYS.has(key), `${key} 既是 transient 又被同步`);
  }
});
