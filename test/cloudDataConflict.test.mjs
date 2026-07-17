import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLOUD_DATA_RESOURCE_REGISTRY,
  buildCloudConflictRows,
  resolveCloudConflictValue,
  summarizeCloudDataResources
} from '../src/app/cloudDataConflict.js';

test('CloudData 资源注册表只把交易记录标为加密，并包含领域接口适配器', () => {
  const ledger = CLOUD_DATA_RESOURCE_REGISTRY.find((item) => item.key === 'aiDcaFundHoldingsLedger');
  const switchConfig = CLOUD_DATA_RESOURCE_REGISTRY.find((item) => item.key === 'aiDcaSwitchStrategyWorkerConfig');
  assert.equal(ledger.security, 'encrypted');
  assert.equal(switchConfig.kind, 'domain');
  assert.equal(CLOUD_DATA_RESOURCE_REGISTRY.filter((item) => item.security === 'encrypted').length, 1);
});

test('CloudData 按记录和字段生成详细冲突项，默认选择云端', () => {
  const local = JSON.stringify({ transactions: [
    { id: 'same', code: '000001', amount: 10 },
    { id: 'changed', code: '000002', amount: 20 },
    { id: 'local-only', code: '000003', amount: 30 }
  ] });
  const remote = JSON.stringify({ transactions: [
    { id: 'same', code: '000001', amount: 10 },
    { id: 'changed', code: '000002', amount: 25 },
    { id: 'cloud-only', code: '000004', amount: 40 }
  ] });
  const rows = buildCloudConflictRows(local, remote);
  assert.deepEqual(rows.map((row) => row.kind), ['changed', 'local-only', 'remote-only']);
  assert.deepEqual(rows[0].fields.map((field) => field.name), ['amount']);
  assert.equal(rows.every((row) => row.defaultDecision === 'cloud'), true);

  const resolved = JSON.parse(resolveCloudConflictValue(local, remote, {
    'transactions:changed': { fields: { amount: 'local' } },
    'transactions:local-only': 'local',
    'transactions:cloud-only': 'cloud'
  }));
  assert.equal(resolved.transactions.find((item) => item.id === 'changed').amount, 20);
  assert.ok(resolved.transactions.some((item) => item.id === 'local-only'));
  assert.ok(resolved.transactions.some((item) => item.id === 'cloud-only'));
});

test('CloudData 标量和对象字段也只能显式选择本机覆盖', () => {
  const local = JSON.stringify({ enabled: true, threshold: 8 });
  const remote = JSON.stringify({ enabled: false, threshold: 10 });
  const rows = buildCloudConflictRows(local, remote);
  assert.deepEqual(rows.map((row) => row.id), ['enabled', 'threshold']);
  const resolved = JSON.parse(resolveCloudConflictValue(local, remote, {
    'field:enabled': 'local',
    'field:threshold': 'cloud'
  }));
  assert.deepEqual(resolved, { enabled: true, threshold: 10 });
});

test('CloudData 同时删除多条云端独有记录时不因数组位移删错记录', () => {
  const local = JSON.stringify({ transactions: [
    { id: 'keep', amount: 1 }
  ] });
  const remote = JSON.stringify({ transactions: [
    { id: 'remove-a', amount: 2 },
    { id: 'keep', amount: 1 },
    { id: 'remove-b', amount: 3 },
    { id: 'keep-2', amount: 4 }
  ] });
  const resolved = JSON.parse(resolveCloudConflictValue(local, remote, {
    'transactions:remove-a': 'local',
    'transactions:remove-b': 'local',
    'transactions:keep-2': 'cloud'
  }));
  assert.deepEqual(resolved.transactions.map((item) => item.id), ['keep', 'keep-2']);
});

test('CloudData 汇总本机独有、云端独有和冲突资源', () => {
  assert.deepEqual(summarizeCloudDataResources([
    { status: 'matched' },
    { status: 'conflict' },
    { status: 'local-only' },
    { status: 'cloud-only' }
  ]), { total: 4, matched: 1, conflicts: 1, localOnly: 1, cloudOnly: 1 });
});
