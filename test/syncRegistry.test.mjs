import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SYNC_REGISTRY,
  SYNCABLE_STORAGE_KEYS,
  HOLDINGS_BACKUP_KEYS,
  NON_HOLDINGS_SYNC_KEYS,
  HOLDINGS_SYNC_KEYS,
  TRANSIENT_SYNC_KEYS,
  getMergeStrategy,
  isDomainMergeKey,
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

test('holdings listener keys are a subset of syncable keys', () => {
  for (const key of HOLDINGS_SYNC_KEYS) {
    assert.ok(SYNCABLE_STORAGE_KEYS.has(key), `${key} 不在白名单内`);
  }
});

test('v2 encrypted backup scope contains holdings only', () => {
  assert.ok(HOLDINGS_BACKUP_KEYS.has('aiDcaFundHoldingsLedger'));
  assert.ok(HOLDINGS_BACKUP_KEYS.has('aiDcaTradeLedger'));
  assert.ok(!HOLDINGS_BACKUP_KEYS.has('aiDcaWorkspacePrefs'));
  assert.ok(!HOLDINGS_BACKUP_KEYS.has('aiDcaSwitchStrategyWorkerConfig'));
});

test('non-holdings REST scope excludes holdings and worker-owned secrets', () => {
  assert.ok(NON_HOLDINGS_SYNC_KEYS.has('aiDcaWorkspacePrefs'));
  assert.ok(NON_HOLDINGS_SYNC_KEYS.has('aiDcaPlanStore'));
  assert.ok(!NON_HOLDINGS_SYNC_KEYS.has('aiDcaFundHoldingsLedger'));
  assert.ok(!NON_HOLDINGS_SYNC_KEYS.has('aiDcaSwitchStrategyPrefs'));
  assert.ok(!NON_HOLDINGS_SYNC_KEYS.has('aiDcaNotifyClientConfig'));
});

test('transient keys never overlap syncable keys', () => {
  for (const key of TRANSIENT_SYNC_KEYS) {
    assert.ok(!SYNCABLE_STORAGE_KEYS.has(key), `${key} 既是 transient 又被同步`);
  }
});
