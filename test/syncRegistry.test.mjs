import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SYNC_REGISTRY,
  HOLDINGS_SYNC_KEYS,
  V2_ACCOUNT_SYNC_DESCRIPTORS,
  V2_ACCOUNT_SYNC_KEYS,
  getMergeStrategy,
} from '../src/app/syncRegistry.js';

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

test('getMergeStrategy reflects the registry and defaults to lww', () => {
  for (const d of SYNC_REGISTRY) {
    assert.equal(getMergeStrategy(d.key), d.merge);
  }
  assert.equal(getMergeStrategy('not-a-real-key'), 'lww');
});

test('registry keeps covered keys and their scopes explicit', () => {
  for (const key of ['markets:watchlist:v1', 'aiDcaAnalyticsOptOut_v1', 'aiDcaPremiumState', 'aiDcaAccountAllocationSettings']) {
    assert.ok(SYNC_REGISTRY.some((descriptor) => descriptor.key === key), `覆盖项缺失：${key}`);
  }
  assert.equal(getMergeStrategy('markets:watchlist:v1'), 'watchlist');
  assert.equal(getMergeStrategy('aiDcaAccountAllocationSettings'), 'lww');
});

test('holdings listener keys are a subset of syncable keys', () => {
  for (const key of HOLDINGS_SYNC_KEYS) {
    assert.ok(SYNC_REGISTRY.some((descriptor) => descriptor.key === key), `${key} 未登记`);
  }
});

test('V2 includes account notification settings and excludes device identities', () => {
  assert.ok(V2_ACCOUNT_SYNC_DESCRIPTORS.length > 0);
  for (const descriptor of V2_ACCOUNT_SYNC_DESCRIPTORS) {
    assert.equal(descriptor.scope, 'account');
    assert.equal(descriptor.role, 'canonical');
    assert.ok(['document', 'collection'].includes(descriptor.syncMode));
    assert.ok(descriptor.adapter);
  }
  for (const key of ['aiDcaNotifyClientConfig', 'aiDcaWebNotifyDeviceState', 'aiDcaPremiumState', 'aiDcaPositionSnapshot']) {
    assert.equal(V2_ACCOUNT_SYNC_KEYS.has(key), false, `${key} 不应进入 V2 账户同步`);
  }
  for (const key of ['aiDcaNotifySettings', 'aiDcaWebNotifyConfig', 'aiDcaMarketAlerts', 'aiDcaHoldingAlerts', 'aiDcaHoldingsNotifyRule', 'aiDcaSwitchStrategyWorkerConfig']) {
    assert.equal(V2_ACCOUNT_SYNC_KEYS.has(key), true, `${key} 应进入 V2 账户同步`);
  }
  assert.equal(V2_ACCOUNT_SYNC_KEYS.has('markets:watchlist:v1'), true);
});
