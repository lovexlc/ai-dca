import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluatePositionDigest } from '../workers/notify/src/evaluator.js';

function buildDigest(overrides = {}) {
  return {
    version: 2,
    generatedAt: '2026-07-09T00:00:00.000Z',
    investmentValue: 9000,
    cashValue: 1000,
    totalAccountValue: 10000,
    investmentPct: 90,
    cashPct: 10,
    targetInvestmentPct: 70,
    targetCashPct: 30,
    rebalanceThresholdPct: 5,
    investmentDeviationPct: 20,
    cashDeviationPct: -20,
    maxDeviationPct: 20,
    rebalanceNeeded: true,
    direction: 'investment_high',
    notifyEnabled: true,
    ...overrides
  };
}

test('evaluatePositionDigest: v2 allocation digest pushes rebalance-needed', async () => {
  let state = {};
  const result = await evaluatePositionDigest({ PUBLIC_DATA_BASE_URL: 'https://example.test' }, buildDigest(), {
    clientId: 'web:test-client',
    settings: {},
    readState: async () => state,
    writeState: async (next) => { state = next; }
  });

  assert.equal(result.delivered.length, 1);
  assert.equal(result.delivered[0].direction, 'investment_high');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].eventType, 'rebalance-needed');
  assert.equal(result.events[0].status, 'delivered');
  assert.equal(state._rebalance.lastPushedActive, true);
  assert.equal(state._rebalance.lastPushedDirection, 'investment_high');
});

test('evaluatePositionDigest: v2 allocation digest debounces repeated imbalance', async () => {
  const now = Date.now();
  let state = {
    _rebalance: {
      lastPushedActive: true,
      lastPushedAt: now,
      lastPushedDirection: 'investment_high'
    }
  };
  const result = await evaluatePositionDigest({ PUBLIC_DATA_BASE_URL: 'https://example.test' }, buildDigest(), {
    readState: async () => state,
    writeState: async (next) => { state = next; }
  });

  assert.equal(result.delivered.length, 0);
  assert.equal(result.skipped[0].reason, 'debounced-rebalance');
});

test('evaluatePositionDigest: v2 allocation digest resets state when back within target', async () => {
  let state = {
    _rebalance: {
      lastPushedActive: true,
      lastPushedAt: Date.now() - 1000,
      lastPushedDirection: 'cash_high'
    }
  };
  const result = await evaluatePositionDigest({ PUBLIC_DATA_BASE_URL: 'https://example.test' }, buildDigest({
    investmentValue: 7000,
    cashValue: 3000,
    investmentPct: 70,
    cashPct: 30,
    investmentDeviationPct: 0,
    cashDeviationPct: 0,
    maxDeviationPct: 0,
    rebalanceNeeded: false,
    direction: 'balanced'
  }), {
    readState: async () => state,
    writeState: async (next) => { state = next; }
  });

  assert.equal(result.delivered.length, 0);
  assert.equal(result.skipped[0].reason, 'within-target');
  assert.equal(state._rebalance.lastPushedActive, false);
});
