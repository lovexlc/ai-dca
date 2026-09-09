import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCOUNT_RESOURCES,
  buildEnvelopeFromResources,
  keyForResource,
  listAccountResourceNames,
  mergeStrategyForResource,
  resourceForKey,
  splitEnvelopeIntoResources,
  unmappedRegistryKeys
} from '../src/app/accountResources.js';
import { SYNC_REGISTRY, getMergeStrategy } from '../src/app/syncRegistry.js';
import { RESOURCE_CATALOG } from '../workers/account/src/catalog.js';

// 服务端 catalog 与前端 accountResources 是两份手写清单，必须逐项对得上，否则会出现「写得进去但读不回来」。
test('前后端资源目录一一对应', () => {
  assert.equal(ACCOUNT_RESOURCES.length, RESOURCE_CATALOG.length);
  const frontByResource = new Map(ACCOUNT_RESOURCES.map((item) => [item.resource, item]));
  for (const serverItem of RESOURCE_CATALOG) {
    const frontItem = frontByResource.get(serverItem.resource);
    assert.ok(frontItem, `前端缺少资源：${serverItem.resource}`);
    assert.equal(frontItem.key, serverItem.legacyKey, `${serverItem.resource} 的 localStorage key 不一致`);
    assert.equal(frontItem.feature, serverItem.feature, `${serverItem.resource} 的 feature 不一致`);
  }
});

test('服务端记录的合并策略与 syncRegistry 一致', () => {
  for (const serverItem of RESOURCE_CATALOG) {
    assert.equal(serverItem.merge, getMergeStrategy(serverItem.legacyKey), `${serverItem.resource} 合并策略漂移`);
    assert.equal(mergeStrategyForResource(serverItem.resource), serverItem.merge);
  }
});

test('每个白名单 key 都有对应资源', () => {
  assert.deepEqual(unmappedRegistryKeys(), [], '存在无法走新接口的同步 key');
  assert.equal(listAccountResourceNames().length, SYNC_REGISTRY.length);
});

test('key 与 resource 双向映射自洽', () => {
  for (const item of ACCOUNT_RESOURCES) {
    assert.equal(resourceForKey(item.key)?.resource, item.resource);
    assert.equal(keyForResource(item.resource), item.key);
  }
  assert.equal(resourceForKey('aiDcaCloudSyncMeta'), null, '瞬时态 key 不应参与同步');
  assert.equal(keyForResource('unknown/resource'), '');
});

test('存量 envelope 能按功能拆成资源', () => {
  const envelope = {
    version: 1,
    source: 'ai-dca',
    keys: ['aiDcaFundHoldingsLedger', 'aiDcaTradeLedger', 'markets:watchlist:v1'],
    payload: {
      aiDcaFundHoldingsLedger: JSON.stringify({ transactions: [{ id: 'tx-1' }], snapshotsByCode: {} }),
      aiDcaTradeLedger: JSON.stringify([{ id: 'trade-1' }]),
      'markets:watchlist:v1': JSON.stringify({ lists: [], activeListId: '' }),
      aiDcaBrokenValue: '{not-json',
      aiDcaSomeRetiredKey: '{}'
    }
  };

  const split = splitEnvelopeIntoResources(envelope);
  assert.equal(split.resourceCount, 3);
  assert.deepEqual(split.resources['trades/ledger'], [{ id: 'trade-1' }]);
  assert.deepEqual(split.resources['holdings/ledger'].transactions, [{ id: 'tx-1' }]);
  assert.ok(split.resources['markets/watchlist']);
  // 不在白名单里的 key 只上报，不静默丢弃也不阻断迁移。
  assert.deepEqual(split.unmapped.sort(), ['aiDcaBrokenValue', 'aiDcaSomeRetiredKey']);
});

test('非法 JSON 会被单独报告而不中断迁移', () => {
  const split = splitEnvelopeIntoResources({
    payload: {
      aiDcaTradeLedger: '[{"id":"trade-1"}]',
      aiDcaPlanStore: '{broken'
    }
  });
  assert.deepEqual(split.invalid, ['aiDcaPlanStore']);
  assert.equal(split.resourceCount, 1);
});

test('资源可重新拼回 envelope 形态（导出 / 回滚用）', () => {
  const source = {
    payload: {
      aiDcaTradeLedger: JSON.stringify([{ id: 'trade-1' }]),
      aiDcaWorkspacePrefs: JSON.stringify({ theme: 'dark' })
    }
  };
  const split = splitEnvelopeIntoResources(source);
  const envelope = buildEnvelopeFromResources(split.resources);
  assert.deepEqual(envelope.keys, ['aiDcaTradeLedger', 'aiDcaWorkspacePrefs']);
  assert.equal(envelope.keyCount, 2);
  assert.equal(envelope.source, 'ai-dca');
  assert.deepEqual(JSON.parse(envelope.payload.aiDcaTradeLedger), [{ id: 'trade-1' }]);
  assert.deepEqual(JSON.parse(envelope.payload.aiDcaWorkspacePrefs), { theme: 'dark' });
});
