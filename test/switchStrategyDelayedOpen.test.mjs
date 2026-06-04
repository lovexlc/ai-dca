import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSwitchSnapshot,
  getDelayedOpenInfo,
  refreshSnapshotWithLatestNav
} from '../workers/notify/src/switchStrategy.js';

const CONFIG = {
  enabled: true,
  benchmarkCodes: ['513100'],
  enabledCodes: ['159501'],
  premiumClass: {
    '513100': 'H',
    '159501': 'L'
  },
  intraSellLowerPct: 1,
  intraBuyOtherPct: 3
};

const PRICE_MAP = {
  '513100': {
    price: 2.1,
    preClose: 2.21
  },
  '159501': {
    price: 0.99,
    preClose: 1.01
  }
};

const NAV_BY_CODE = {
  '513100': {
    code: '513100',
    name: '纳指ETF',
    nav: 2,
    latestNavDate: '2026-06-03'
  },
  '159501': {
    code: '159501',
    name: '纳指ETF',
    nav: 1,
    latestNavDate: '2026-06-03'
  }
};

test('switch delayed open flags high previous-close premium before 10:30 Shanghai', () => {
  const info = getDelayedOpenInfo(
    '513100',
    PRICE_MAP,
    NAV_BY_CODE,
    '2026-06-04T01:45:00.000Z'
  );

  assert.equal(info.delayed, true);
  assert.equal(info.delayedUntil, '10:30');
  assert.equal(Number(info.previousClosePremiumPct.toFixed(2)), 10.5);
});

test('switch snapshot skips benchmark calculation during delayed open window', () => {
  const snapshot = computeSwitchSnapshot(
    CONFIG,
    PRICE_MAP,
    NAV_BY_CODE,
    '2026-06-04T01:45:00.000Z'
  );

  const group = snapshot.byBenchmark[0];
  assert.equal(snapshot.ready, false);
  assert.equal(snapshot.signals.length, 0);
  assert.equal(group.benchmarkDelayedOpen, true);
  assert.equal(group.benchmarkNote, 'delayed-open');
  assert.equal(group.benchmarkPremiumPct, null);
  assert.equal(group.candidates[0].note, 'benchmark-delayed-open');
  assert.equal(group.candidates[0].spreadVsBenchmarkPct, null);
});

test('switch snapshot resumes calculation after delayed open window', () => {
  const snapshot = computeSwitchSnapshot(
    CONFIG,
    PRICE_MAP,
    NAV_BY_CODE,
    '2026-06-04T02:31:00.000Z'
  );

  const group = snapshot.byBenchmark[0];
  assert.equal(group.benchmarkDelayedOpen, false);
  assert.equal(group.benchmarkNote, '');
  assert.equal(Number(group.benchmarkPremiumPct.toFixed(2)), 5);
  assert.equal(Number(group.candidates[0].premiumPct.toFixed(2)), -1);
  assert.equal(Number(group.candidates[0].spreadVsBenchmarkPct.toFixed(2)), 6);
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.signals.length, 1);
  assert.equal(snapshot.signals[0].kind, 'B');
});

test('switch snapshot nav refresh preserves delayed open unavailable state', async () => {
  const snapshot = computeSwitchSnapshot(
    CONFIG,
    PRICE_MAP,
    NAV_BY_CODE,
    '2026-06-04T01:45:00.000Z'
  );

  const refreshed = await refreshSnapshotWithLatestNav(snapshot, {}, async (_env, code) => ({
    ...NAV_BY_CODE[code],
    latestNavDate: '2026-06-04'
  }));

  const group = refreshed.byBenchmark[0];
  assert.equal(refreshed.ready, false);
  assert.equal(group.benchmarkDelayedOpen, true);
  assert.equal(group.benchmarkNote, 'delayed-open');
  assert.equal(group.benchmarkPremiumPct, null);
  assert.equal(group.candidates[0].note, 'benchmark-delayed-open');
  assert.equal(group.candidates[0].spreadVsBenchmarkPct, null);
});
