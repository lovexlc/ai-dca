import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  QUANT_PREMIUM_CONFIG_PREFIX,
  QUANT_PREMIUM_STRATEGIES_PREFIX,
  buildQuantPremiumSwitchConfig,
  normalizeQuantPremiumConfig,
  normalizeQuantPremiumStrategy,
  runQuantPremiumBacktest
} from '../workers/notify/src/quantPremiumRoutes.js';
import { quantPremiumPaperStateKey } from '../workers/notify/src/premiumPaperTrading.js';
import { getRunnableSwitchRules } from '../workers/notify/src/switchStrategy.js';

function makePremiumCandles(premiums = [], { start = Math.floor(Date.UTC(2026, 5, 12, 1, 30) / 1000), step = 300 } = {}) {
  return premiums.map((premiumPct, index) => ({
    t: start + index * step,
    c: 1 + Number(premiumPct) / 100
  }));
}

test('quant premium config normalizes arbitrary H/L symbols without holdings', () => {
  const config = normalizeQuantPremiumConfig({
    enabled: true,
    highCodes: '159513, 513100',
    lowCodes: '159501 159513 513100',
    activeSide: 'all',
    intraSellLowerPct: '0.8',
    intraBuyOtherPct: '4.2'
  });

  assert.deepEqual(config.highCodes, ['159513', '513100']);
  assert.deepEqual(config.lowCodes, ['159501']);
  assert.equal(config.activeSide, 'all');
  assert.equal(config.intraSellLowerPct, 0.8);
  assert.equal(config.intraBuyOtherPct, 4.2);

  const switchConfig = buildQuantPremiumSwitchConfig(config);
  assert.equal(switchConfig.enabled, true);
  assert.deepEqual(switchConfig.benchmarkCodes, ['159513', '513100', '159501']);
  assert.deepEqual(switchConfig.enabledCodes, []);
  assert.equal(switchConfig.premiumClass['159513'], 'H');
  assert.equal(switchConfig.premiumClass['159501'], 'L');
  assert.equal(getRunnableSwitchRules(switchConfig).length, 1);
});

test('quant premium state keys are isolated from holding switch keys', () => {
  assert.equal(QUANT_PREMIUM_CONFIG_PREFIX, 'quant:premium:config:');
  assert.equal(QUANT_PREMIUM_STRATEGIES_PREFIX, 'quant:premium:strategies:');
  assert.equal(quantPremiumPaperStateKey('client-a'), 'quant:premium:paper:state:client-a');
  assert.equal(quantPremiumPaperStateKey('client-a', 'strategy-a'), 'quant:premium:paper:state:client-a:strategy-a');
  assert.equal(quantPremiumPaperStateKey('client-a').startsWith('switch:'), false);
});

test('quant premium live signal requires a passed approved backtest gate', () => {
  const strategy = normalizeQuantPremiumStrategy({
    id: 's1',
    enabled: true,
    liveSignalEnabled: true,
    highCodes: ['159513'],
    lowCodes: ['513100'],
    backtestGate: {
      status: 'passed',
      approvedAt: '2026-06-12T02:00:00.000Z',
      approvedFingerprint: JSON.stringify({
        highCodes: ['159513'],
        lowCodes: ['513100'],
        activeSide: 'all',
        intraSellLowerPct: 1,
        intraBuyOtherPct: 3
      })
    }
  });

  assert.equal(strategy.liveSignalEnabled, true);

  const stale = normalizeQuantPremiumStrategy({
    ...strategy,
    lowCodes: ['159501']
  });
  assert.equal(stale.liveSignalEnabled, false);
  assert.equal(stale.backtestGate.approvedAt, '');
});

test('quant premium backtest passes when 5m price and nav coverage are sufficient', () => {
  const candles = Array.from({ length: 16 }, (_, index) => ({
    t: Math.floor(Date.UTC(2026, 5, 12, 1, 30) / 1000) + index * 300,
    c: 1.5 + index * 0.001
  }));
  const result = runQuantPremiumBacktest({
    id: 's1',
    enabled: true,
    highCodes: ['159513'],
    lowCodes: ['513100'],
    intraBuyOtherPct: 0.2
  }, {
    timeframe: '5m',
    historyByCode: {
      '159513': candles.map((item) => ({ ...item, c: item.c + 0.02 })),
      '513100': candles
    },
    navHistoryByCode: {
      '159513': [{ date: '2026-06-12', nav: 1.48 }],
      '513100': [{ date: '2026-06-12', nav: 1.5 }]
    }
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.summary.sampleCount, 16);
  assert.ok(result.summary.signalCount > 0);
  assert.equal(result.timeframe, '5m');
  assert.equal(result.chart.code, '159513');
  assert.equal(result.chart.candles.length, 16);
  assert.ok(result.chart.markers.length > 0);
  assert.equal(result.chart.markers[0].side, 'sell');
});

test('quant premium backtest cycles according to simulated current holding', () => {
  const gaps = [4, 4, 0.5, 0.5, 4, 4, 0.4, 0.4, 4, 4, 0.6, 0.6];
  const result = runQuantPremiumBacktest({
    id: 'cycle',
    enabled: true,
    highCodes: ['513100'],
    lowCodes: ['159501'],
    activeSide: 'all',
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3
  }, {
    timeframe: '5m',
    historyByCode: {
      '513100': makePremiumCandles(gaps),
      '159501': makePremiumCandles(gaps.map(() => 0))
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-06-12', nav: 1 }],
      '159501': [{ date: '2026-06-12', nav: 1 }]
    }
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.signals.slice(0, 4).map((signal) => `${signal.fromCode}->${signal.toCode}`), [
    '513100->159501',
    '159501->513100',
    '513100->159501',
    '159501->513100'
  ]);
  assert.deepEqual(result.signals.slice(0, 4).map((signal) => signal.rule), ['B', 'A', 'B', 'A']);
  assert.ok(result.summary.totalProfit > 0);
});

test('quant premium backtest chart returns the full fetched kline window', () => {
  const gaps = Array.from({ length: 300 }, () => 4);
  const result = runQuantPremiumBacktest({
    id: 'full-chart',
    enabled: true,
    highCodes: ['513100'],
    lowCodes: ['159501'],
    activeSide: 'all',
    intraBuyOtherPct: 3
  }, {
    timeframe: '5m',
    historyByCode: {
      '513100': makePremiumCandles(gaps),
      '159501': makePremiumCandles(gaps.map(() => 0))
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-06-12', nav: 1 }],
      '159501': [{ date: '2026-06-12', nav: 1 }]
    }
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.summary.sampleCount, 300);
  assert.equal(result.chart.candles.length, 300);
});

test('quant premium backtest records missing kline codes as quality issues', () => {
  const candles = Array.from({ length: 16 }, (_, index) => ({
    t: Math.floor(Date.UTC(2026, 5, 12, 1, 30) / 1000) + index * 300,
    c: 1.5 + index * 0.001
  }));
  const result = runQuantPremiumBacktest({
    id: 's-missing',
    enabled: true,
    highCodes: ['159509'],
    lowCodes: ['513100']
  }, {
    timeframe: '5m',
    historyByCode: {
      '159509': [],
      '513100': candles
    },
    navHistoryByCode: {
      '159509': [{ date: '2026-06-12', nav: 1.5 }],
      '513100': [{ date: '2026-06-12', nav: 1.5 }]
    },
    dataIssues: {
      kline: [{ code: '159509', timeframe: '5m', reason: 'xueqiu kline empty SZ159509' }]
    }
  });

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.quality.missingKlineCodes, ['159509']);
  assert.match(result.quality.reason, /159509/);
  assert.equal(result.summary.sampleCount, 0);
  assert.equal(result.chart.code, '513100');
  assert.equal(result.chart.candles.length, 16);
  assert.equal(result.chart.markers.length, 0);
});
