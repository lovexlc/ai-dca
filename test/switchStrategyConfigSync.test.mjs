import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSwitchConfigSyncKey,
  buildDefaultSwitchConfig,
  normalizeSwitchConfigShape
} from '../src/app/switchStrategySync.js';
import {
  buildSwitchPushDigest,
  buildSwitchTriggerNotification,
  computeSwitchSnapshot,
  evaluateSwitchTriggers,
  isSwitchConfigRunnable,
  normalizeSwitchConfig,
  switchPushDigestKey
} from '../workers/notify/src/switchStrategy.js';
import {
  buildSwitchDeliveryAnalyticsMeta,
  restoreUndeliveredSwitchTriggerStates,
  selectLatestSwitchConfigsForAccounts
} from '../workers/notify/src/switchStrategyRoutes.js';

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

test('switch config sync keeps mobile condition and trigger selections', () => {
  const frontend = normalizeSwitchConfigShape({
    ...BASE_CONFIG,
    holdingCondition: 'all',
    triggerRule: 'b'
  });
  const worker = normalizeSwitchConfig({
    ...BASE_CONFIG,
    holdingCondition: 'all',
    triggerRule: 'b'
  });

  assert.equal(frontend.holdingCondition, 'all');
  assert.equal(frontend.triggerRule, 'b');
  assert.equal(frontend.rules[0].holdingCondition, 'all');
  assert.equal(worker.holdingCondition, 'all');
  assert.equal(worker.triggerRule, 'b');
});

test('switch H/L thresholds keep directly entered signed values', () => {
  const input = {
    ...BASE_CONFIG,
    intraSellLowerPct: -125.5,
    intraBuyOtherPct: 87.25
  };
  const frontend = normalizeSwitchConfigShape(input);
  const worker = normalizeSwitchConfig(input);

  assert.equal(frontend.intraSellLowerPct, -125.5);
  assert.equal(frontend.intraBuyOtherPct, 87.25);
  assert.equal(worker.intraSellLowerPct, -125.5);
  assert.equal(worker.intraBuyOtherPct, 87.25);
});

test('worker switch snapshot filters mobile trigger rule selection', () => {
  const snapshot = computeSwitchSnapshot(
    normalizeSwitchConfig({ ...BASE_CONFIG, triggerRule: 'a' }),
    OTC_PRICE_MAP,
    OTC_NAV_BY_CODE,
    '2026-06-04T02:31:00.000Z'
  );

  assert.equal(snapshot.triggerRule, 'a');
  assert.equal(snapshot.signals.length, 0);
});

test('frontend switch config sync key ignores metadata and numeric string shape', () => {
  const first = buildSwitchConfigSyncKey({
    ...BASE_CONFIG,
    updatedAt: '2026-06-04T01:00:00.000Z',
    clientLabel: 'browser-a'
  });
  const sameEffectiveConfig = buildSwitchConfigSyncKey({
    ...BASE_CONFIG,
    benchmarkCodes: ['513100'],
    enabledCodes: ['159501'],
    otcPremiumThresholdPct: '9.5',
    otcMinIntraPremiumLow: '0.5',
    otcMinIntraPremiumHigh: '1.5',
    updatedAt: '2026-06-04T01:01:00.000Z',
    clientLabel: 'browser-b'
  });
  const changedThreshold = buildSwitchConfigSyncKey({
    ...BASE_CONFIG,
    otcPremiumThresholdPct: 10
  });

  assert.equal(first, sameEffectiveConfig);
  assert.notEqual(first, changedThreshold);
});

test('frontend switch config supports multiple named rules and active rule mirror', () => {
  const normalized = normalizeSwitchConfigShape({
    enabled: true,
    activeRuleId: 'rule-b',
    rules: [
      {
        id: 'rule-a',
        name: '低高切换',
        benchmarkCodes: ['513100'],
        enabledCodes: ['159501'],
        premiumClass: { '513100': 'H', '159501': 'L' },
        intraSellLowerPct: 1,
        intraBuyOtherPct: 3
      },
      {
        id: 'rule-b',
        name: '备用规则',
        enabled: false,
        benchmarkCodes: ['159501'],
        enabledCodes: ['513100'],
        premiumClass: { '159501': 'L', '513100': 'H' },
        intraSellLowerPct: 0.5,
        intraBuyOtherPct: 4
      }
    ]
  });

  assert.equal(normalized.rules.length, 2);
  assert.equal(normalized.activeRuleId, 'rule-b');
  assert.equal(normalized.ruleName, '备用规则');
  assert.equal(normalized.ruleEnabled, false);
  assert.deepEqual(normalized.benchmarkCodes, ['159501']);
  assert.equal(normalized.intraBuyOtherPct, 4);
});

test('notify worker switch config keeps OTC thresholds after normalization', () => {
  const normalized = normalizeSwitchConfig(BASE_CONFIG);
  assert.equal(normalized.otcPremiumThresholdPct, 9.5);
  assert.equal(normalized.otcMinIntraPremiumLow, 0.5);
  assert.equal(normalized.otcMinIntraPremiumHigh, 1.5);
});

test('notify worker switch config keeps multiple rules and checks runnable rules', () => {
  const normalized = normalizeSwitchConfig({
    enabled: true,
    activeRuleId: 'rule-b',
    rules: [
      {
        id: 'rule-a',
        name: '停用规则',
        enabled: false,
        benchmarkCodes: ['513100'],
        enabledCodes: ['159501'],
        premiumClass: { '513100': 'H', '159501': 'L' },
        intraSellLowerPct: 1,
        intraBuyOtherPct: 3
      },
      {
        id: 'rule-b',
        name: '启用规则',
        enabled: true,
        benchmarkCodes: ['159501'],
        enabledCodes: ['513100'],
        premiumClass: { '159501': 'L', '513100': 'H' },
        intraSellLowerPct: 1,
        intraBuyOtherPct: 3
      }
    ]
  });

  assert.equal(normalized.rules.length, 2);
  assert.equal(normalized.activeRuleId, 'rule-b');
  assert.equal(normalized.ruleName, '启用规则');
  assert.equal(isSwitchConfigRunnable(normalized), true);
});

test('notify cron collapses logged-in clients to the newest account config', () => {
  const selected = selectLatestSwitchConfigsForAccounts([
    {
      clientId: 'web:lovexl-old',
      accountUsername: 'LoveXL',
      config: normalizeSwitchConfig({
        ...BASE_CONFIG,
        updatedAt: '2026-07-16T06:57:59.299Z',
        benchmarkCodes: ['513100']
      })
    },
    {
      clientId: 'web:lovexl-current',
      accountUsername: 'lovexl',
      config: normalizeSwitchConfig({
        ...BASE_CONFIG,
        updatedAt: '2026-07-17T03:05:47.977Z',
        benchmarkCodes: ['159659', '159632']
      })
    },
    {
      clientId: 'web:anonymous',
      accountUsername: '',
      config: normalizeSwitchConfig({
        ...BASE_CONFIG,
        updatedAt: '2026-07-17T03:00:00.000Z'
      })
    }
  ]);

  assert.deepEqual(selected.map((entry) => entry.clientId).sort(), ['web:anonymous', 'web:lovexl-current']);
  assert.deepEqual(selected.find((entry) => entry.accountUsername === 'lovexl').config.benchmarkCodes, ['159659', '159632']);
});

test('a newest disabled account config suppresses older enabled cron configs', () => {
  const selected = selectLatestSwitchConfigsForAccounts([
    {
      clientId: 'web:old',
      accountUsername: 'lovexl',
      config: normalizeSwitchConfig({
        ...BASE_CONFIG,
        enabled: true,
        updatedAt: '2026-07-16T06:57:59.299Z'
      })
    },
    {
      clientId: 'web:disabled',
      accountUsername: 'lovexl',
      config: normalizeSwitchConfig({
        ...BASE_CONFIG,
        enabled: false,
        updatedAt: '2026-07-17T03:05:47.977Z'
      })
    }
  ]);

  assert.equal(selected.length, 0);
  assert.equal(selectLatestSwitchConfigsForAccounts([
    {
      clientId: 'web:disabled',
      accountUsername: 'lovexl',
      config: normalizeSwitchConfig({ ...BASE_CONFIG, enabled: false, updatedAt: '2026-07-17T03:05:47.977Z' })
    }
  ], { runnableOnly: false })[0].config.enabled, false);
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

test('notify worker snapshot carries lightweight market enhancement fields', () => {
  const snapshot = computeSwitchSnapshot(
    normalizeSwitchConfig(BASE_CONFIG),
    {
      '513100': { price: 2.1, high: 2.2, highPoint: { high: 2.5 }, yearHigh: 2.8, historicalPercentile: 68, turnover: 120000000 },
      '159501': { price: 0.99, high: 1.01, highPoint: { high: 1.2 }, yearHigh: 1.3, historicalPercentile: 42, turnover: 80000000 }
    },
    {
      '513100': { code: '513100', name: '纳指ETF', nav: 2, latestNavDate: '2026-06-03' },
      '159501': { code: '159501', name: '纳指ETF', nav: 1, latestNavDate: '2026-06-03' }
    },
    '2026-06-04T02:31:00.000Z'
  );

  assert.equal(snapshot.byBenchmark[0].benchmarkHighPoint, 2.5);
  assert.equal(snapshot.byBenchmark[0].benchmarkYearHigh, 2.8);
  assert.equal(snapshot.byBenchmark[0].benchmarkHistoricalPercentile, 68);
  assert.equal(snapshot.byBenchmark[0].benchmarkTurnover, 120000000);
  assert.equal(snapshot.byBenchmark[0].candidates[0].highPoint, 1.2);
  assert.equal(snapshot.byBenchmark[0].candidates[0].historicalPercentile, 42);
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

test('notify worker evaluates OTC trigger at most three times per Shanghai trading date', () => {
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
  assert.equal(second.triggers.length, 1);

  const third = evaluateSwitchTriggers(snapshot, second.nextTriggerStates);
  assert.equal(third.triggers.length, 1);

  const fourth = evaluateSwitchTriggers(snapshot, third.nextTriggerStates);
  assert.equal(fourth.triggers.length, 0);
});

test('notify worker re-triggers unchanged OTC signal on the next Shanghai trading date', () => {
  const firstSnapshot = computeSwitchSnapshot(
    normalizeSwitchConfig(OTC_ONLY_CONFIG),
    OTC_PRICE_MAP,
    OTC_NAV_BY_CODE,
    '2026-06-04T02:31:00.000Z'
  );
  const first = evaluateSwitchTriggers(firstSnapshot, {});
  assert.equal(first.triggers.length, 1);

  const sameDaySnapshot = computeSwitchSnapshot(
    normalizeSwitchConfig(OTC_ONLY_CONFIG),
    OTC_PRICE_MAP,
    OTC_NAV_BY_CODE,
    '2026-06-04T06:31:00.000Z'
  );
  const sameDay = evaluateSwitchTriggers(sameDaySnapshot, first.nextTriggerStates);
  const sameDayThird = evaluateSwitchTriggers(sameDaySnapshot, sameDay.nextTriggerStates);
  const sameDayFourth = evaluateSwitchTriggers(sameDaySnapshot, sameDayThird.nextTriggerStates);
  assert.equal(sameDay.triggers.length, 1);
  assert.equal(sameDayThird.triggers.length, 1);
  assert.equal(sameDayFourth.triggers.length, 0);

  const nextDaySnapshot = computeSwitchSnapshot(
    normalizeSwitchConfig(OTC_ONLY_CONFIG),
    OTC_PRICE_MAP,
    OTC_NAV_BY_CODE,
    '2026-06-05T02:31:00.000Z'
  );
  const nextDay = evaluateSwitchTriggers(nextDaySnapshot, sameDayFourth.nextTriggerStates);
  assert.equal(nextDay.triggers.length, 1);
  assert.equal(nextDay.triggers[0].rule, 'OTC_STRONG');
});

test('notify worker re-triggers unchanged intra switch signal on the next Shanghai trading date', () => {
  const intraOnlyConfig = normalizeSwitchConfig({
    ...BASE_CONFIG,
    otcPremiumThresholdPct: 99
  });
  const priceMap = {
    '513100': { price: 2.2, preClose: 2.05 },
    '159501': { price: 1, preClose: 1 }
  };
  const navByCode = {
    '513100': { code: '513100', name: '纳指ETF', nav: 2, latestNavDate: '2026-06-03' },
    '159501': { code: '159501', name: '纳指ETF', nav: 1, latestNavDate: '2026-06-03' }
  };
  const firstSnapshot = computeSwitchSnapshot(
    intraOnlyConfig,
    priceMap,
    navByCode,
    '2026-06-04T02:31:00.000Z'
  );
  const first = evaluateSwitchTriggers(firstSnapshot, {});
  assert.equal(first.triggers.length, 1);
  assert.equal(first.triggers[0].rule, 'B');

  const sameDaySnapshot = computeSwitchSnapshot(
    intraOnlyConfig,
    priceMap,
    navByCode,
    '2026-06-04T06:31:00.000Z'
  );
  const sameDay = evaluateSwitchTriggers(sameDaySnapshot, first.nextTriggerStates);
  const sameDayThird = evaluateSwitchTriggers(sameDaySnapshot, sameDay.nextTriggerStates);
  const sameDayFourth = evaluateSwitchTriggers(sameDaySnapshot, sameDayThird.nextTriggerStates);
  assert.equal(sameDay.triggers.length, 1);
  assert.equal(sameDayThird.triggers.length, 1);
  assert.equal(sameDayFourth.triggers.length, 0);

  const nextDaySnapshot = computeSwitchSnapshot(
    intraOnlyConfig,
    priceMap,
    navByCode,
    '2026-06-05T02:31:00.000Z'
  );
  const nextDay = evaluateSwitchTriggers(nextDaySnapshot, sameDayFourth.nextTriggerStates);
  assert.equal(nextDay.triggers.length, 1);
  assert.equal(nextDay.triggers[0].rule, 'B');
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
        benchmarkNavDate: '2026-06-03',
        benchmarkOrderBook: {
          bidPrice: 2.36,
          bidVolume: 120000,
          askPrice: 2.361,
          askVolume: 230000,
          levels: [
            { level: 1, bidPrice: 2.36, bidVolume: 120000, askPrice: 2.361, askVolume: 230000 },
            { level: 2, bidPrice: 2.359, bidVolume: 130000, askPrice: 2.362, askVolume: 240000 },
            { level: 3, bidPrice: 2.358, bidVolume: 140000, askPrice: 2.363, askVolume: 250000 }
          ]
        },
        candidates: [{
          code: '159501',
          orderBook: {
            bidPrice: 1.1,
            bidVolume: 340000,
            askPrice: 1.101,
            askVolume: 450000,
            levels: [
              { level: 1, bidPrice: 1.1, bidVolume: 340000, askPrice: 1.101, askVolume: 450000 },
              { level: 2, bidPrice: 1.099, bidVolume: 350000, askPrice: 1.102, askVolume: 460000 },
              { level: 3, bidPrice: 1.098, bidVolume: 360000, askPrice: 1.103, askVolume: 470000 }
            ]
          }
        }]
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
    { NOTIFICATION_WEB_BASE_URL: 'https://tools.freebacktrack.tech/' }
  );

  assert.equal(payload.detailUrl, 'https://tools.freebacktrack.tech/index.html?tab=fundSwitch&source=notification&code=513100&targetCode=159501&trigger=switch-threshold&rule=B');
  assert.equal(payload.eventType, 'switch-strategy-trigger');
  assert.match(payload.body_md, /513100盘口：买一 2\.36 × 12\.00万 \/ 卖一 2\.361 × 23\.00万/);
  assert.match(payload.body_md, /买二 2\.359 × 13\.00万 \/ 卖二 2\.362 × 24\.00万/);
  assert.match(payload.body_md, /买三 2\.358 × 14\.00万 \/ 卖三 2\.363 × 25\.00万/);
  assert.match(payload.body_md, /159501盘口：买一 1\.1 × 34\.00万 \/ 卖一 1\.101 × 45\.00万/);
  assert.match(payload.body_md, /买二 1\.099 × 35\.00万 \/ 卖二 1\.102 × 46\.00万/);
  assert.match(payload.body_md, /买三 1\.098 × 36\.00万 \/ 卖三 1\.103 × 47\.00万/);
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
    { NOTIFICATION_WEB_BASE_URL: 'https://tools.freebacktrack.tech/' }
  );

  assert.equal(payload.strategyName, '场外切换');
  assert.match(payload.title, /场外切换 强信号/);
  assert.match(payload.body, /申购场外 QDII 联接基金/);
  assert.equal(payload.detailUrl, 'https://tools.freebacktrack.tech/index.html?tab=fundSwitch&source=notification&code=513100&targetCode=159501&trigger=switch-otc&rule=OTC_STRONG');
});

test('notify worker OTC trigger notification includes exchange order book when available', () => {
  const snapshot = computeSwitchSnapshot(
    normalizeSwitchConfig(OTC_ONLY_CONFIG),
    {
      '513100': {
        price: 2.2,
        preClose: 2.05,
        orderBook: { bidPrice: 2.199, bidVolume: 50000, askPrice: 2.2, askVolume: 60000 }
      },
      '159501': {
        price: 1.005,
        preClose: 1,
        orderBook: { bidPrice: 1.004, bidVolume: 70000, askPrice: 1.005, askVolume: 80000 }
      }
    },
    OTC_NAV_BY_CODE,
    '2026-06-04T02:31:00.000Z'
  );
  const { triggers } = evaluateSwitchTriggers(snapshot, {});
  const payload = buildSwitchTriggerNotification(
    snapshot,
    triggers[0],
    { PUBLIC_DATA_BASE_URL: 'https://tools.freebacktrack.tech/' }
  );

  assert.match(payload.body_md, /513100盘口：买一 2\.199 × 5\.00万 \/ 卖一 2\.2 × 6\.00万/);
  assert.match(payload.body_md, /159501盘口：买一 1\.004 × 7\.00万 \/ 卖一 1\.005 × 8\.00万/);
});

test('notify worker stores concise switch push digest copy', () => {
  const digest = buildSwitchPushDigest({
    clientId: 'web:test-client',
    computedAt: '2026-06-04T02:31:00.000Z',
    triggerRecords: [
      {
        trigger: {
          ruleId: 'rule-1',
          ruleName: '默认规则',
          rule: 'B',
          fromCode: '513100',
          toCode: '159501',
          gapPct: 6
        },
        event: { id: 'evt-1' }
      },
      {
        trigger: {
          ruleId: 'rule-1',
          ruleName: '默认规则',
          rule: 'A',
          fromCode: '159941',
          toCode: '513100',
          gapPct: -0.8
        },
        event: { id: 'evt-2' }
      }
    ]
  });

  assert.equal(switchPushDigestKey('web:test-client'), 'switch:push-digest:web:test-client');
  assert.equal(digest.status, 'triggered');
  assert.equal(digest.body.split('\n').length, 1);
  assert.match(digest.body, /今日 2 只纳指 ETF 触发切换信号（513100\/159941）/);
  assert.match(digest.body, /其中 513100 溢价差触发 B 规则。点击查看 →/);
  assert.deepEqual(digest.codes, ['513100', '159941']);
  assert.equal(digest.triggers[0].eventId, 'evt-1');
  assert.equal(/513100 溢价 .*159941 溢价/.test(digest.body), false);
});

test('notify worker does not mark switch trigger date when delivery is not confirmed', () => {
  const prevStatesByRule = {
    'rule-1': {
      '159501:159632': {
        rule: 'B',
        lastTriggeredDate: '2026-07-02',
        lastTriggeredRule: 'B',
        dailyTriggerCount: 2
      }
    }
  };
  const nextStatesByRule = {
    'rule-1': {
      '159501:159632': {
        rule: 'B',
        fromCode: '159501',
        lastTriggeredDate: '2026-07-03',
        lastTriggeredRule: 'B',
        dailyTriggerCount: 1,
        lastGapPct: 3.32
      }
    }
  };

  const withoutDelivery = restoreUndeliveredSwitchTriggerStates(prevStatesByRule, nextStatesByRule, []);
  assert.equal(withoutDelivery['rule-1']['159501:159632'].lastTriggeredDate, '2026-07-02');
  assert.equal(withoutDelivery['rule-1']['159501:159632'].lastTriggeredRule, 'B');
  assert.equal(withoutDelivery['rule-1']['159501:159632'].dailyTriggerCount, 2);

  const withDelivery = restoreUndeliveredSwitchTriggerStates(prevStatesByRule, nextStatesByRule, [{
    ruleId: 'rule-1',
    pairKey: 'rule-1:159501:159632'
  }]);
  assert.equal(withDelivery['rule-1']['159501:159632'].lastTriggeredDate, '2026-07-03');
  assert.equal(withDelivery['rule-1']['159501:159632'].dailyTriggerCount, 1);
});

test('notify worker switch delivery analytics summarizes confirmed channels', () => {
  const meta = buildSwitchDeliveryAnalyticsMeta({
    clientId: 'web:test-client',
    reason: 'switch-cron',
    computedAt: '2026-07-09T01:30:00.000Z',
    trigger: {
      ruleId: 'rule-a',
      rule: 'A',
      pairKey: 'rule-a:159501:513100',
      fromCode: '159501',
      toCode: '513100',
      gapPct: 0.8,
      threshold: 1
    },
    payload: {
      eventId: 'switch:rule-a:159501:513100:RA:2026-07-09T01:30',
      eventType: 'switch-strategy-trigger',
      detailUrl: 'https://freebacktrack.tech/index.html?tab=fundSwitch&source=notification&code=159501&targetCode=513100&trigger=switch-threshold&rule=A'
    },
    result: {
      summary: {
        events: [{
          status: 'sent',
          channels: [
            { channel: 'bark', status: 'delivered' },
            { channel: 'serverchan3', status: 'failed' }
          ]
        }]
      }
    }
  });

  assert.equal(meta.status, 'success');
  assert.equal(meta.ok, true);
  assert.equal(meta.delivered, true);
  assert.equal(meta.deliveredChannels, 'bark');
  assert.equal(meta.failedChannels, 'serverchan3');
  assert.equal(meta.fromCode, '159501');
  assert.equal(meta.toCode, '513100');
  assert.equal(meta.notificationSource, 'notification');
});

test('notify worker switch delivery analytics records delivery errors', () => {
  const meta = buildSwitchDeliveryAnalyticsMeta({
    clientId: 'web:test-client',
    reason: 'switch-cron',
    trigger: {
      rule: 'B',
      fromCode: '513100',
      toCode: '159501'
    },
    payload: { eventId: 'switch:error' },
    error: new Error('delivery failed')
  });

  assert.equal(meta.status, 'error');
  assert.equal(meta.ok, false);
  assert.equal(meta.delivered, false);
  assert.equal(meta.deliveryStatus, 'error');
  assert.equal(meta.errorName, 'Error');
  assert.equal(meta.errorMessage, 'delivery failed');
});
