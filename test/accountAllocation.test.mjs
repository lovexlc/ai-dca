import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAccountAllocationDigest,
  getAccountAllocation,
  normalizeAccountAllocationSettings
} from '../src/app/accountManager.js';

test('getAccountAllocation: investment and cash ratios use manual cash amount', () => {
  const allocation = getAccountAllocation(
    { marketValue: 7000 },
    { cashAmount: 3000, targetInvestmentPct: 70, rebalanceThresholdPct: 5 }
  );

  assert.equal(allocation.totalAccountValue, 10000);
  assert.equal(allocation.investmentPct, 70);
  assert.equal(allocation.cashPct, 30);
  assert.equal(allocation.rebalanceNeeded, false);
  assert.equal(allocation.direction, 'balanced');
  assert.deepEqual(allocation.items.map((item) => item.key), ['investment', 'cash']);
});

test('getAccountAllocation: detects investment-high rebalance state', () => {
  const allocation = getAccountAllocation(
    { marketValue: 9000 },
    { cashAmount: 1000, targetInvestmentPct: 70, rebalanceThresholdPct: 5 }
  );

  assert.equal(allocation.investmentPct, 90);
  assert.equal(allocation.cashPct, 10);
  assert.equal(allocation.rebalanceNeeded, true);
  assert.equal(allocation.direction, 'investment_high');
  assert.equal(allocation.maxDeviationPct, 20);
});

test('normalizeAccountAllocationSettings: target cash follows investment target', () => {
  const settings = normalizeAccountAllocationSettings({
    cashAmount: -10,
    targetInvestmentPct: 82,
    targetCashPct: 5,
    rebalanceThresholdPct: 3,
    notifyEnabled: false
  });

  assert.equal(settings.cashAmount, 0);
  assert.equal(settings.targetInvestmentPct, 82);
  assert.equal(settings.targetCashPct, 18);
  assert.equal(settings.rebalanceThresholdPct, 3);
  assert.equal(settings.notifyEnabled, false);
});

test('getAccountAllocation: manual cash yield calculates annual income', () => {
  const allocation = getAccountAllocation({ marketValue: 7000 }, { cashAmount: 3000, cashYieldMode: 'manual', cashYieldRate: 3.2 });
  assert.equal(allocation.cashYieldRate, 3.2);
  assert.equal(allocation.cashAnnualIncome, 96);
});

test('getAccountAllocation: code cash yield uses resolved annual return', () => {
  const allocation = getAccountAllocation({ marketValue: 7000 }, { cashAmount: 3000, cashYieldMode: 'code', cashYieldCode: '511010', cashYieldResolvedRate: 2.5 });
  assert.equal(allocation.cashYieldRate, 2.5);
  assert.equal(allocation.cashAnnualIncome, 75);
});


test('buildAccountAllocationDigest: returns null when account has no value', () => {
  assert.equal(buildAccountAllocationDigest({ marketValue: 0 }, { cashAmount: 0 }), null);
});
