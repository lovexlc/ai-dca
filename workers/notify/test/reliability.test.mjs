import assert from 'node:assert/strict';
import test from 'node:test';
import { isRetryableDeliveryStatus, isTerminalDeliveryStatus } from '../src/notifyReliabilityStorage.js';
import { settleNamedDeliveryJobs } from '../src/deliverySettlement.js';

test('delivery status machine keeps failed channels retryable', () => {
  assert.equal(isRetryableDeliveryStatus('failed'), true);
  assert.equal(isRetryableDeliveryStatus('retryable_failed'), true);
  assert.equal(isRetryableDeliveryStatus('delivered'), false);
  assert.equal(isTerminalDeliveryStatus('delivered'), true);
  assert.equal(isTerminalDeliveryStatus('queued'), true);
  assert.equal(isTerminalDeliveryStatus('skipped'), true);
  assert.equal(isTerminalDeliveryStatus('retryable_failed'), false);
});

test('named delivery jobs keep the real channel when a promise rejects', async () => {
  const results = await settleNamedDeliveryJobs([
    { channel: 'email', promise: Promise.reject(new Error('smtp unavailable')) }
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].channel, 'email');
  assert.equal(results[0].status, 'failed');
  assert.match(results[0].detail, /smtp unavailable/);
});
