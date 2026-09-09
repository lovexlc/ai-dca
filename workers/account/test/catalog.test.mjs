import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_RESOURCE_BYTES,
  RESOURCE_CATALOG,
  getResourceByLegacyKey,
  getResourceDescriptor,
  parseAccountPath,
  validateResourcePayload
} from '../src/catalog.js';

test('资源名与 legacyKey 均唯一', () => {
  const resources = RESOURCE_CATALOG.map((item) => item.resource);
  const legacyKeys = RESOURCE_CATALOG.map((item) => item.legacyKey);
  assert.equal(new Set(resources).size, resources.length);
  assert.equal(new Set(legacyKeys).size, legacyKeys.length);
  for (const item of RESOURCE_CATALOG) {
    assert.equal(item.resource.split('/')[0], item.feature, `${item.resource} 的 feature 前缀必须一致`);
  }
});

test('parseAccountPath 能识别功能资源与条目路径', () => {
  assert.equal(parseAccountPath('/api/account/v1/health').kind, 'health');
  assert.equal(parseAccountPath('/api/account/v1/manifest').kind, 'manifest');
  assert.equal(parseAccountPath('/api/account/v1/bundle').kind, 'bundle');
  assert.equal(parseAccountPath('/api/account/v1/exports/envelope').kind, 'export-envelope');
  assert.equal(parseAccountPath('/api/account/v1/migrations/legacy').kind, 'migration');
  assert.equal(parseAccountPath('/api/account/v1/migrations/legacy/skip').kind, 'migration-skip');

  const resourceRoute = parseAccountPath('/api/account/v1/holdings/ledger');
  assert.equal(resourceRoute.kind, 'resource');
  assert.equal(resourceRoute.descriptor.legacyKey, 'aiDcaFundHoldingsLedger');

  const itemRoute = parseAccountPath('/api/account/v1/notify/market-alerts/items/alert-1');
  assert.equal(itemRoute.kind, 'resource-item');
  assert.equal(itemRoute.itemId, 'alert-1');
});

test('未知资源与越权路径一律不可路由', () => {
  assert.equal(parseAccountPath('/api/account/v1/unknown/thing').kind, 'unknown');
  assert.equal(parseAccountPath('/api/sync/latest').kind, 'unknown');
  assert.equal(parseAccountPath('/api/account/v1/holdings/ledger/items').kind, 'unknown');
});

test('形态校验拦截错误类型与超大 payload', () => {
  const arrayResource = getResourceDescriptor('trades/ledger');
  assert.equal(validateResourcePayload(arrayResource, { not: 'array' }).code, 'SHAPE_MISMATCH');
  assert.equal(validateResourcePayload(arrayResource, []).ok, true);

  const objectResource = getResourceDescriptor('plans/store');
  assert.equal(validateResourcePayload(objectResource, []).code, 'SHAPE_MISMATCH');
  assert.equal(validateResourcePayload(objectResource, { plans: [] }).ok, true);

  const anyResource = getResourceDescriptor('prefs/analytics-opt-out');
  assert.equal(validateResourcePayload(anyResource, true).ok, true);
  assert.equal(validateResourcePayload(anyResource, undefined).code, 'PAYLOAD_REQUIRED');

  const huge = ['x'.repeat(MAX_RESOURCE_BYTES + 10)];
  assert.equal(validateResourcePayload(arrayResource, huge).code, 'PAYLOAD_TOO_LARGE');
});

test('legacyKey 可反查资源，覆盖持仓与自选', () => {
  assert.equal(getResourceByLegacyKey('aiDcaFundHoldingsLedger').resource, 'holdings/ledger');
  assert.equal(getResourceByLegacyKey('markets:watchlist:v1').resource, 'markets/watchlist');
  assert.equal(getResourceByLegacyKey('不存在的key'), null);
});
