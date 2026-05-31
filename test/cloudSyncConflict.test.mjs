import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeBackupEnvelopes,
  summarizeBackupConflict
} from '../src/app/cloudSync.js';

test('summarizeBackupConflict reports changed, remote-only, and local-only keys', () => {
  const localEnvelope = {
    version: 1,
    keys: ['aiDcaPlanStore', 'aiDcaTradeLedger'],
    payload: {
      aiDcaPlanStore: '{"local":true}',
      aiDcaTradeLedger: '{"only":"local"}'
    }
  };
  const remoteEnvelope = {
    version: 1,
    keys: ['aiDcaPlanStore', 'aiDcaFundHoldingsLedger'],
    payload: {
      aiDcaPlanStore: '{"remote":true}',
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
  assert.equal(summary.remoteVersion, 8);
  assert.deepEqual(summary.changedKeys, ['aiDcaPlanStore']);
  assert.deepEqual(summary.remoteOnlyKeys, ['aiDcaFundHoldingsLedger']);
  assert.deepEqual(summary.localOnlyKeys, ['aiDcaTradeLedger']);
  assert.match(summary.summaryText, /两端都改过/);
  assert.match(summary.summaryText, /只在云端存在/);
  assert.match(summary.summaryText, /只在本机存在/);
});

test('mergeBackupEnvelopes keeps remote-only keys and lets local win on shared keys', () => {
  const remoteEnvelope = {
    version: 1,
    keys: ['aiDcaPlanStore', 'aiDcaFundHoldingsLedger'],
    payload: {
      aiDcaPlanStore: '{"remote":true}',
      aiDcaFundHoldingsLedger: '{"only":"remote"}'
    }
  };
  const localEnvelope = {
    version: 1,
    keys: ['aiDcaPlanStore', 'aiDcaTradeLedger'],
    payload: {
      aiDcaPlanStore: '{"local":true}',
      aiDcaTradeLedger: '{"only":"local"}'
    }
  };

  const merged = mergeBackupEnvelopes(remoteEnvelope, localEnvelope);

  assert.deepEqual(merged.keys, ['aiDcaFundHoldingsLedger', 'aiDcaPlanStore', 'aiDcaTradeLedger']);
  assert.equal(merged.keyCount, 3);
  assert.equal(merged.payload.aiDcaPlanStore, '{"local":true}');
  assert.equal(merged.payload.aiDcaFundHoldingsLedger, '{"only":"remote"}');
  assert.equal(merged.payload.aiDcaTradeLedger, '{"only":"local"}');
});
