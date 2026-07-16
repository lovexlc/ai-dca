import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareRecordVersions,
  mergeBackupEnvelopes,
  summarizeBackupConflict
} from '../src/app/cloudSync.js';

test('summarizeBackupConflict reports changed, remote-only, and local-only keys', () => {
  const localEnvelope = {
    version: 1,
    keys: ['aiDcaWorkspacePrefs', 'aiDcaTradeLedger'],
    payload: {
      aiDcaWorkspacePrefs: '{"local":true}',
      aiDcaTradeLedger: '{"only":"local"}'
    }
  };
  const remoteEnvelope = {
    version: 1,
    keys: ['aiDcaWorkspacePrefs', 'aiDcaFundHoldingsLedger'],
    payload: {
      aiDcaWorkspacePrefs: '{"remote":true}',
      aiDcaFundHoldingsLedger: '{"only":"remote"}'
    }
  };

  const summary = summarizeBackupConflict({
    localEnvelope,
    remoteEnvelope,
    remote: { version: 8, updatedAt: '2026-05-30T12:00:00.000Z' },
    localMeta: { version: 6, localUpdatedAt: '2026-05-30T12:05:00.000Z' }
  });

  assert.equal(summary.hasConflict, true);
  assert.equal(summary.hasChanges, true);
  assert.equal(summary.hasLocalChanges, true);
  assert.equal(summary.remoteVersion, 8);
  assert.deepEqual(summary.changedKeys, ['aiDcaWorkspacePrefs']);
  assert.deepEqual(summary.unresolvedChangedKeys, ['aiDcaWorkspacePrefs']);
  assert.deepEqual(summary.remoteOnlyKeys, ['aiDcaFundHoldingsLedger']);
  assert.deepEqual(summary.localOnlyKeys, ['aiDcaTradeLedger']);
  assert.match(summary.summaryText, /需要手动选择/);
  assert.match(summary.summaryText, /只在云端存在/);
  assert.match(summary.summaryText, /只在本机存在/);
});

test('summarizeBackupConflict treats domain record differences as auto mergeable', () => {
  const localEnvelope = {
    version: 1,
    keys: ['aiDcaPlanStore', 'aiDcaTradeLedger'],
    payload: {
      aiDcaPlanStore: JSON.stringify({ plans: [{ id: 'local-plan' }], activePlanId: 'local-plan' }),
      aiDcaTradeLedger: JSON.stringify([{ id: 'trade-local', updatedAt: '2026-05-02T10:00:00.000Z' }])
    }
  };
  const remoteEnvelope = {
    version: 1,
    keys: ['aiDcaPlanStore', 'aiDcaFundHoldingsLedger'],
    payload: {
      aiDcaPlanStore: JSON.stringify({ plans: [{ id: 'remote-plan' }], activePlanId: 'remote-plan' }),
      aiDcaFundHoldingsLedger: JSON.stringify({ transactions: [], snapshotsByCode: {} })
    }
  };

  const summary = summarizeBackupConflict({ localEnvelope, remoteEnvelope });

  assert.equal(summary.hasChanges, true);
  assert.equal(summary.hasConflict, false);
  assert.equal(summary.hasLocalChanges, true);
  assert.deepEqual(summary.autoMergeChangedKeys, ['aiDcaPlanStore']);
  assert.deepEqual(summary.unresolvedChangedKeys, []);
  assert.deepEqual(summary.autoMergeKeys, ['aiDcaFundHoldingsLedger', 'aiDcaPlanStore', 'aiDcaTradeLedger']);
  assert.match(summary.summaryText, /可自动合并/);
});

test('mergeBackupEnvelopes keeps remote-only keys and lets local win on simple shared keys', () => {
  const remoteEnvelope = {
    version: 1,
    keys: ['aiDcaWorkspacePrefs', 'aiDcaFundHoldingsLedger'],
    payload: {
      aiDcaWorkspacePrefs: '{"remote":true}',
      aiDcaFundHoldingsLedger: '{"only":"remote"}'
    }
  };
  const localEnvelope = {
    version: 1,
    keys: ['aiDcaWorkspacePrefs', 'aiDcaTradeLedger'],
    payload: {
      aiDcaWorkspacePrefs: '{"local":true}',
      aiDcaTradeLedger: '{"only":"local"}'
    }
  };

  const merged = mergeBackupEnvelopes(remoteEnvelope, localEnvelope);

  assert.deepEqual(merged.keys, ['aiDcaFundHoldingsLedger', 'aiDcaTradeLedger', 'aiDcaWorkspacePrefs']);
  assert.equal(merged.keyCount, 3);
  assert.equal(merged.payload.aiDcaWorkspacePrefs, '{"local":true}');
  assert.equal(merged.payload.aiDcaFundHoldingsLedger, '{"only":"remote"}');
  assert.equal(merged.payload.aiDcaTradeLedger, '{"only":"local"}');
});

test('mergeBackupEnvelopes unions trade ledger entries by id', () => {
  const remoteEnvelope = {
    version: 1,
    keys: ['aiDcaTradeLedger'],
    payload: {
      aiDcaTradeLedger: JSON.stringify([
        { id: 'trade-remote', symbol: 'QQQ', side: 'buy', date: '2026-05-01', shares: 1, price: 400 },
        { id: 'trade-shared', symbol: 'QQQ', side: 'buy', date: '2026-05-02', shares: 1, price: 410, updatedAt: '2026-05-02T10:00:00.000Z' }
      ])
    }
  };
  const localEnvelope = {
    version: 1,
    keys: ['aiDcaTradeLedger'],
    payload: {
      aiDcaTradeLedger: JSON.stringify([
        { id: 'trade-local', symbol: 'NVDA', side: 'buy', date: '2026-05-03', shares: 2, price: 100 },
        { id: 'trade-shared', symbol: 'QQQ', side: 'buy', date: '2026-05-02', shares: 1, price: 420, updatedAt: '2026-05-02T11:00:00.000Z' }
      ])
    }
  };

  const merged = mergeBackupEnvelopes(remoteEnvelope, localEnvelope);
  const list = JSON.parse(merged.payload.aiDcaTradeLedger);
  assert.deepEqual(list.map((item) => item.id), ['trade-remote', 'trade-shared', 'trade-local']);
  assert.equal(list.find((item) => item.id === 'trade-shared').price, 420);
});

test('mergeBackupEnvelopes merges holdings transactions without snapshots', () => {
  const remoteEnvelope = {
    version: 1,
    keys: ['aiDcaFundHoldingsLedger'],
    payload: {
      aiDcaFundHoldingsLedger: JSON.stringify({
        source: 'react-fund-holdings-ledger',
        version: 2,
        transactions: [{ id: 'tx-remote', code: '021000', type: 'BUY', date: '2026-05-01', price: 2, shares: 10 }],
        snapshotsByCode: { '021000': { latestNav: 2.1 } },
        switchChains: []
      })
    }
  };
  const localEnvelope = {
    version: 1,
    keys: ['aiDcaFundHoldingsLedger'],
    payload: {
      aiDcaFundHoldingsLedger: JSON.stringify({
        source: 'react-fund-holdings-ledger',
        version: 2,
        transactions: [{ id: 'tx-local', code: '513100', type: 'BUY', date: '2026-05-02', price: 2.3, shares: 20 }],
        snapshotsByCode: { '513100': { price: 2.3 } },
        switchChains: []
      })
    }
  };

  const merged = mergeBackupEnvelopes(remoteEnvelope, localEnvelope);
  const ledger = JSON.parse(merged.payload.aiDcaFundHoldingsLedger);
  assert.deepEqual(ledger.transactions.map((tx) => tx.id), ['tx-remote', 'tx-local']);
  assert.equal(Object.hasOwn(ledger, 'snapshotsByCode'), false);
  assert.equal(Object.hasOwn(ledger, 'switchChains'), false);
});

test('mergeBackupEnvelopes merges plan store plans by id and keeps local active plan', () => {
  const remoteEnvelope = {
    version: 1,
    keys: ['aiDcaPlanStore'],
    payload: {
      aiDcaPlanStore: JSON.stringify({
        source: 'react-plan-store',
        version: 1,
        activePlanId: 'remote-plan',
        plans: [{ id: 'remote-plan', symbol: 'QQQ', updatedAt: '2026-05-01T10:00:00.000Z' }]
      })
    }
  };
  const localEnvelope = {
    version: 1,
    keys: ['aiDcaPlanStore'],
    payload: {
      aiDcaPlanStore: JSON.stringify({
        source: 'react-plan-store',
        version: 1,
        activePlanId: 'local-plan',
        plans: [{ id: 'local-plan', symbol: '513100', updatedAt: '2026-05-02T10:00:00.000Z' }]
      })
    }
  };

  const merged = mergeBackupEnvelopes(remoteEnvelope, localEnvelope);
  const store = JSON.parse(merged.payload.aiDcaPlanStore);
  assert.deepEqual(store.plans.map((plan) => plan.id), ['remote-plan', 'local-plan']);
  assert.equal(store.activePlanId, 'local-plan');
});

test('mergeBackupEnvelopes merges dca store plans by id and keeps local active dca', () => {
  const remoteEnvelope = {
    version: 1,
    keys: ['aiDcaDcaStore'],
    payload: {
      aiDcaDcaStore: JSON.stringify({
        source: 'react-dca-store',
        version: 1,
        activeDcaId: 'remote-dca',
        plans: [
          { id: 'remote-dca', symbol: 'QQQ', recurringInvestment: 300, updatedAt: '2026-05-01T10:00:00.000Z' },
          { id: 'shared-dca', symbol: 'SPY', recurringInvestment: 400, updatedAt: '2026-05-02T10:00:00.000Z' }
        ]
      })
    }
  };
  const localEnvelope = {
    version: 1,
    keys: ['aiDcaDcaStore'],
    payload: {
      aiDcaDcaStore: JSON.stringify({
        source: 'react-dca-store',
        version: 1,
        activeDcaId: 'local-dca',
        plans: [
          { id: 'local-dca', symbol: 'NVDA', recurringInvestment: 500, updatedAt: '2026-05-03T10:00:00.000Z' },
          { id: 'shared-dca', symbol: 'SPY', recurringInvestment: 450, updatedAt: '2026-05-02T11:00:00.000Z' }
        ]
      })
    }
  };

  const merged = mergeBackupEnvelopes(remoteEnvelope, localEnvelope);
  const store = JSON.parse(merged.payload.aiDcaDcaStore);
  assert.deepEqual(store.plans.map((plan) => plan.id), ['remote-dca', 'shared-dca', 'local-dca']);
  assert.equal(store.plans.find((plan) => plan.id === 'shared-dca').recurringInvestment, 450);
  assert.equal(store.activeDcaId, 'local-dca');
});

test('compareRecordVersions lets higher revision win regardless of timestamp', () => {
  // 逻辑时钟：rev 高者胜，即使它的墙钟时间更早（时钟漂移场景）。
  const older = { rev: 5, updatedAt: '2026-05-01T00:00:00.000Z' };
  const newer = { rev: 2, updatedAt: '2026-05-09T00:00:00.000Z' };
  assert.equal(compareRecordVersions(older, newer) > 0, true);
  assert.equal(compareRecordVersions(newer, older) < 0, true);
});

test('compareRecordVersions falls back to timestamp when revisions tie or are absent', () => {
  assert.equal(compareRecordVersions({ rev: 3, updatedAt: '2026-05-09T00:00:00.000Z' }, { rev: 3, updatedAt: '2026-05-01T00:00:00.000Z' }) > 0, true);
  assert.equal(compareRecordVersions({ updatedAt: '2026-05-09T00:00:00.000Z' }, { updatedAt: '2026-05-01T00:00:00.000Z' }) > 0, true);
});

test('compareRecordVersions breaks exact ties deterministically by origin device', () => {
  const base = { updatedAt: '2026-05-02T10:00:00.000Z' };
  assert.equal(compareRecordVersions({ ...base, deviceId: 'device-b' }, { ...base, deviceId: 'device-a' }) > 0, true);
  assert.equal(compareRecordVersions({ ...base, deviceId: 'device-a' }, { ...base, deviceId: 'device-b' }) < 0, true);
  assert.equal(compareRecordVersions({ ...base, deviceId: 'device-a' }, { ...base, deviceId: 'device-a' }), 0);
  assert.equal(compareRecordVersions({ ...base }, { ...base }), 0);
});

test('mergeBackupEnvelopes uses record revision over timestamp when unioning by id', () => {
  const remoteEnvelope = {
    version: 1,
    keys: ['aiDcaTradeLedger'],
    payload: {
      aiDcaTradeLedger: JSON.stringify([
        { id: 'trade-shared', symbol: 'QQQ', side: 'buy', date: '2026-05-02', shares: 1, price: 999, rev: 5, updatedAt: '2026-05-02T08:00:00.000Z' }
      ])
    }
  };
  const localEnvelope = {
    version: 1,
    keys: ['aiDcaTradeLedger'],
    payload: {
      aiDcaTradeLedger: JSON.stringify([
        { id: 'trade-shared', symbol: 'QQQ', side: 'buy', date: '2026-05-02', shares: 1, price: 420, rev: 2, updatedAt: '2026-05-02T11:00:00.000Z' }
      ])
    }
  };

  const merged = mergeBackupEnvelopes(remoteEnvelope, localEnvelope);
  const list = JSON.parse(merged.payload.aiDcaTradeLedger);
  assert.equal(list.length, 1);
  // 远端 rev=5 胜出，尽管本机 updatedAt 更新。
  assert.equal(list[0].price, 999);
});
