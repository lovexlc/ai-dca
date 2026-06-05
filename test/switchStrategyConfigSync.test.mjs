import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDefaultSwitchConfig,
  normalizeSwitchConfigShape
} from '../src/app/switchStrategySync.js';
import {
  buildSwitchTriggerNotification,
  computeSwitchSnapshot,
  evaluateSwitchTriggers,
  isSwitchConfigRunnable,
  normalizeSwitchConfig
} from '../workers/notify/src/switchStrategy.js';

const BASE_CONFIG = {
  enabled: true,
  benchmarkCodes: ['513100'],
  enabledCodes: ['159501'],
  premiumClass: {
    '513100': 'H',
    '159501': 'L'
  },
  intraSellLowerPct: 1,
  intraBuyOtherPct: 3,
  otcPremiumThresholdPct: 9.5,
  otcMinIntraPremiumLow: 0.5,
  otcMinIntraPremiumHigh: 1.5
};

const OTC_ONLY_CONFIG = {
  ...BASE_CONFIG,
  premiumClass: {},
  otcPremiumThresholdPct: 8,
  otcMinIntraPremiumLow: 1,
  otcMinIntraPremiumHigh: 2
};

const OTC_PRICE_MAP = {
  '513100': { price: 2.2, preClose: 2.05 },
  '159501': { price: 1.005, preClose: 1 }
};

const OTC_NAV_BY_CODE = {
  '513100': { code: '513100', name: '纳指ETF', nav: 2, latestNavDate: '2026-06-03' },
  '159501': { code: '159501', name: '纳指ETF', nav: 1, latestNavDate: '2026-06-03' }
};

test('switch config sync keeps OTC thresholds in frontend shape', () => {
  const defaults = buildDefaultSwitchConfig();
  assert.equal(defaults.otcPremiumThresholdPct, 8);
  assert.equal(defaults.otcMinIntraPremiumLow, 1);
  assert.equal(defaults.otcMinIntraPremiumHigh, 2);

  const normalized = normalizeSwitchConfigShape(BASE_CONFIG);
  assert.equal(normalized.otcPremiumThresholdPct, 9.5);
  assert.equal(normalized.otcMinIntraPremiumLow, 0.5);
  assert.equal(normalized.otcMinIntraPremiumHigh, 1.5);
});

test('notify worker switch config keeps OTC thresholds after normalization', () => {
  const normalized = normalizeSwitchConfig(BASE_CONFIG);
  assert.equal(normalized.otcPremiumThresholdPct, 9.5);
  assert.equal(normalized.otcMinIntraPremiumLow, 0.5);
  assert.equal(normalized.otcMinIntraPremiumHigh, 1.5);
});

test('notify worker switch snapshot echoes OTC thresholds', () => {
  const snapshot = computeSwitchSnapshot(
    normalizeSwitchConfig(BASE_CONFIG),
    {
      '513100': { price: 2.1, preClose: 2.05 },
      '159501': { price: 0.99, preClose: 1 }
    },
    {
      '513100': { code: '513100', name: '纳指ETF', nav: 2, latestNavDate: '2026-06-03' },
      '159501': { code: '159501', name: '纳指ETF', nav: 1, latestNavDate: '2026-06-03' }
    },
    '2026-06-04T02:31:00.000Z'
  );

  assert.equal(snapshot.otcPremiumThresholdPct, 9.5);
  assert.equal(snapshot.otcMinIntraPremiumLow, 0.5);
  assert.equal(snapshot.otcMinIntraPremiumHigh, 1.5);
});

test('notify worker treats OTC-only benchmark and candidate config as runnable', () => {
  assert.equal(isSwitchConfigRunnable(normalizeSwitchConfig(OTC_ONLY_CONFIG)), true);
});

test('notify worker switch snapshot computes OTC strong signal', () => {
  const snapshot = computeSwitchSnapshot(
    normalizeSwitchConfig(OTC_ONLY_CONFIG),
    OTC_PRICE_MAP,
    OTC_NAV_BY_CODE,
    '2026-06-04T02:31:00.000Z'
  );

  assert.equal(snapshot.otcSignal.ready, true);
  assert.equal(snapshot.otcSignal.triggered, true);
  assert.equal(snapshot.otcSignal.rule, 'OTC_STRONG');
  assert.equal(snapshot.otcSignal.level, '强信号');
  assert.equal(Number(snapshot.otcSignal.benchPremiumPct.toFixed(2)), 10);
  assert.equal(Number(snapshot.otcSignal.lowestPremiumPct.toFixed(2)), 0.5);
});

test('notify worker evaluates OTC trigger once per unchanged state', () => {
  const snapshot = computeSwitchSnapshot(
    normalizeSwitchConfig(OTC_ONLY_CONFIG),
    OTC_PRICE_MAP,
    OTC_NAV_BY_CODE,
    '2026-06-04T02:31:00.000Z'
  );

  const first = evaluateSwitchTriggers(snapshot, {});
  assert.equal(first.triggers.length, 1);
  assert.equal(first.triggers[0].kind, 'otc');
  assert.equal(first.triggers[0].rule, 'OTC_STRONG');

  const second = evaluateSwitchTriggers(snapshot, first.nextTriggerStates);
  assert.equal(second.triggers.length, 0);
});

test('notify worker does not trigger OTC when only unheld candidate exceeds OTC threshold', () => {
  const snapshot = computeSwitchSnapshot(
    normalizeSwitchConfig(OTC_ONLY_CONFIG),
    {
      '513100': { price: 2.1, preClose: 2.05 },
      '159501': { price: 1.12, preClose: 1 }
    },
    OTC_NAV_BY_CODE,
    '2026-06-04T02:31:00.000Z'
  );

  assert.equal(Number(snapshot.otcSignal.benchPremiumPct.toFixed(2)), 5);
  assert.equal(Number(snapshot.otcSignal.lowestPremiumPct.toFixed(2)), 12);
  assert.equal(snapshot.otcSignal.triggered, false);

  const { triggers } = evaluateSwitchTriggers(snapshot, {});
  assert.equal(triggers.filter((trigger) => trigger.kind === 'otc').length, 0);
});

test('notify worker switch trigger notification builds detail URL', () => {
  const payload = buildSwitchTriggerNotification(
    {
      computedAt: '2026-06-04T02:31:00.000Z',
      byBenchmark: [{
        benchmarkCode: '513100',
        benchmarkNavDate: '2026-06-03'
      }]
    },
    {
      pairKey: '513100:159501',
      rule: 'B',
      fromCode: '513100',
      fromName: '纳指ETF',
      toCode: '159501',
      toName: '纳指ETF',
      gapPct: 6,
      threshold: 3,
      benchClass: 'H',
      candClass: 'L'
    },
    { PUBLIC_DATA_BASE_URL: 'https://tools.freebacktrack.tech/' }
  );

  assert.equal(payload.detailUrl, 'https://tools.freebacktrack.tech/index.html?tab=tradePlans#switch');
  assert.equal(payload.eventType, 'switch-strategy-trigger');
});

test('notify worker OTC trigger notification uses OTC copy', () => {
  const snapshot = computeSwitchSnapshot(
    normalizeSwitchConfig(OTC_ONLY_CONFIG),
    OTC_PRICE_MAP,
    OTC_NAV_BY_CODE,
    '2026-06-04T02:31:00.000Z'
  );
  const { triggers } = evaluateSwitchTriggers(snapshot, {});
  const payload = buildSwitchTriggerNotification(
    snapshot,
    triggers[0],
    { PUBLIC_DATA_BASE_URL: 'https://tools.freebacktrack.tech/' }
  );

  assert.equal(payload.strategyName, '场外切换');
  assert.match(payload.title, /场外切换 强信号/);
  assert.match(payload.body, /申购场外 QDII 联接基金/);
  assert.equal(payload.detailUrl, 'https://tools.freebacktrack.tech/index.html?tab=tradePlans#switch');
});
