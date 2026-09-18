import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SWITCH_CHANNEL_KEYS,
  buildSpreadGauge,
  buildSwitchBoardRows,
  filterSwitchBoardRows,
  resolveSpreadPct,
  sanitizeSwitchChannelKeys,
  summarizeSwitchBoard
} from '../src/pages/switch/switchBoardModel.js';

const RULE = {
  id: 'rule-1',
  name: '纳指100轮动套利',
  enabled: true,
  benchmarkCodes: ['159632'],
  enabledCodes: ['513100'],
  premiumClass: { '159632': 'H', '513100': 'L' },
  intraSellLowerPct: 0.1,
  intraBuyOtherPct: 0.9
};

const SNAPSHOT = {
  snapshot: {
    computedAt: '2026-09-14T08:34:12.000Z',
    rules: [
      {
        ruleId: 'rule-1',
        snapshot: {
          computedAt: '2026-09-14T08:34:12.000Z',
          hitCount: 3,
          todayTriggerCount: 4,
          byBenchmark: [
            {
              benchmarkCode: '159632',
              benchmarkClass: 'H',
              benchmarkPrice: 1.842,
              benchmarkPremiumPct: 2.15,
              candidates: [
                { code: '513100', name: '纳指科技', valid: true, spreadVsBenchmarkPct: 0.65, price: 1.62, premiumPct: 1.5 }
              ]
            }
          ]
        }
      }
    ]
  }
};

test('resolveSpreadPct 统一成 H−L 口径', () => {
  assert.equal(resolveSpreadPct('H', 0.65), 0.65);
  assert.equal(resolveSpreadPct('L', 0.65), -0.65);
  assert.equal(resolveSpreadPct('H', 'not-a-number'), null);
});

test('buildSpreadGauge 计算标尺位置与距触发距离', () => {
  const gauge = buildSpreadGauge({ spreadPct: 0.65, lowerPct: 0.1, upperPct: 0.9, holdingSide: 'H' });
  assert.equal(gauge.direction, 'H_TO_L');
  assert.equal(gauge.directionLabel, 'H→L');
  assert.equal(gauge.triggered, false);
  assert.ok(Math.abs(gauge.distancePct - 0.25) < 1e-9);
  assert.ok(Math.abs(gauge.ratio - 0.6875) < 1e-9);
});

test('buildSpreadGauge 越过上界时标记已触发', () => {
  const gauge = buildSpreadGauge({ spreadPct: 0.95, lowerPct: 0.1, upperPct: 0.9, holdingSide: 'H' });
  assert.equal(gauge.triggered, true);
  assert.equal(gauge.direction, 'H_TO_L');
  assert.equal(gauge.distancePct, 0);
  assert.equal(gauge.ratio, 1);
});

test('buildSpreadGauge 回落到下界时提示 L→H', () => {
  const gauge = buildSpreadGauge({ spreadPct: 0.05, lowerPct: 0.1, upperPct: 0.9, holdingSide: 'L' });
  assert.equal(gauge.triggered, true);
  assert.equal(gauge.direction, 'L_TO_H');
  assert.equal(gauge.ratio, 0);
});

test('buildSpreadGauge 只判断当前持仓方向', () => {
  const holdingHigh = buildSpreadGauge({ spreadPct: 0.05, lowerPct: 0.1, upperPct: 0.9, holdingSide: 'H' });
  const holdingLow = buildSpreadGauge({ spreadPct: 0.95, lowerPct: 0.1, upperPct: 0.9, holdingSide: 'L' });
  assert.equal(holdingHigh.triggered, false);
  assert.equal(holdingHigh.direction, 'H_TO_L');
  assert.equal(holdingLow.triggered, false);
  assert.equal(holdingLow.direction, 'L_TO_H');
});

test('buildSpreadGauge 缺行情时不编造数据', () => {
  const gauge = buildSpreadGauge({ spreadPct: null, lowerPct: 0.1, upperPct: 0.9, holdingSide: 'H' });
  assert.equal(gauge.spreadPct, null);
  assert.equal(gauge.ratio, null);
  assert.equal(gauge.direction, '');
  assert.equal(gauge.triggered, false);
});

test('buildSwitchBoardRows 派生 H/L 双腿与利差', () => {
  const [row] = buildSwitchBoardRows({ rules: [RULE] }, SNAPSHOT);
  assert.equal(row.highCode, '159632');
  assert.equal(row.lowCode, '513100');
  assert.equal(row.high.price, 1.842);
  assert.equal(row.low.name, '纳指科技');
  assert.ok(Math.abs(row.spreadPct - 0.65) < 1e-9);
  assert.equal(row.gauge.directionLabel, 'H→L');
  assert.equal(row.hitCount, 4);
  assert.equal(row.hasQuote, true);
  assert.deepEqual(row.channels, SWITCH_CHANNEL_KEYS);
});


test('buildSwitchBoardRows 保留多 H / 多 L，并读取 Worker 真实溢价字段', () => {
  const rule = {
    id: 'multi-rule',
    name: '多标的切换',
    enabled: true,
    benchmarkCodes: ['159501', '513100'],
    enabledCodes: ['159632', '159659'],
    premiumClass: {
      '159501': 'H',
      '513100': 'H',
      '159632': 'L',
      '159659': 'L'
    },
    intraSellLowerPct: 0.1,
    intraBuyOtherPct: 0.9
  };
  const snapshot = {
    snapshot: {
      computedAt: '2026-09-14T08:35:00.000Z',
      rules: [{
        ruleId: 'multi-rule',
        snapshot: {
          byBenchmark: [
            {
              benchmarkCode: '159501',
              benchmarkName: '纳指科技ETF',
              benchmarkClass: 'H',
              benchmarkPrice: 1.25,
              benchmarkPremiumPct: 1.8,
              candidates: [
                { code: '159632', name: '纳斯达克ETF', candClass: 'L', valid: true, price: 1.1, premiumPct: 1.1, spreadVsBenchmarkPct: 0.7 },
                { code: '159659', name: '纳指ETF', candClass: 'L', valid: true, price: 1.2, premiumPct: 1.25, spreadVsBenchmarkPct: 0.55 }
              ]
            },
            {
              benchmarkCode: '513100',
              benchmarkName: '纳指ETF',
              benchmarkClass: 'H',
              benchmarkPrice: 2.2,
              benchmarkPremiumPct: 1.6,
              candidates: [
                { code: '159632', name: '纳斯达克ETF', candClass: 'L', valid: true, price: 1.1, premiumPct: 1.1, spreadVsBenchmarkPct: 0.5 },
                { code: '159659', name: '纳指ETF', candClass: 'L', valid: true, price: 1.2, premiumPct: 1.25, spreadVsBenchmarkPct: 0.35 }
              ]
            }
          ]
        }
      }]
    }
  };

  const [row] = buildSwitchBoardRows({ rules: [rule] }, snapshot);
  assert.deepEqual(row.highCodes, ['159501', '513100']);
  assert.deepEqual(row.lowCodes, ['159632', '159659']);
  assert.deepEqual(row.holdingCodes, ['159501', '513100']);
  assert.equal(row.holdingSide, 'H');
  assert.equal(row.highQuotes[0].price, 1.25);
  assert.equal(row.highQuotes[0].premiumPct, 1.8);
  assert.equal(row.lowQuotes[0].premiumPct, 1.1);
  assert.equal(row.spreadPct, 0.7);
  assert.match(row.searchText, /159659/);
});

test('buildSwitchBoardRows 将历史混合基准降级为单向持仓', () => {
  const mixed = {
    ...RULE,
    id: 'mixed-rule',
    benchmarkCodes: ['159632', '513100'],
    enabledCodes: [],
    premiumClass: { '159632': 'H', '513100': 'L' }
  };
  const [row] = buildSwitchBoardRows({ rules: [mixed] }, null);
  assert.equal(row.holdingSide, 'H');
  assert.deepEqual(row.holdingCodes, ['159632', '513100']);
});

test('buildSwitchBoardRows 无快照时仍能从规则定位双腿', () => {
  const [row] = buildSwitchBoardRows({ rules: [RULE] }, null);
  assert.equal(row.highCode, '159632');
  assert.equal(row.lowCode, '513100');
  assert.equal(row.spreadPct, null);
  assert.equal(row.hasQuote, false);
  assert.equal(row.hitCount, 0);
});

test('buildSwitchBoardRows 遵循每个方案自己的渠道选择', () => {
  const [row] = buildSwitchBoardRows({ rules: [RULE] }, SNAPSHOT, { channelsByRuleId: { 'rule-1': ['pc', 'email'] } });
  assert.deepEqual(row.channels, ['pc', 'email']);
});

test('filterSwitchBoardRows 按名称与代码搜索', () => {
  const rows = buildSwitchBoardRows({ rules: [RULE] }, SNAPSHOT);
  assert.equal(filterSwitchBoardRows(rows, '513100').length, 1);
  assert.equal(filterSwitchBoardRows(rows, '纳指100').length, 1);
  assert.equal(filterSwitchBoardRows(rows, '999999').length, 0);
  assert.equal(filterSwitchBoardRows(rows, '  ').length, 1);
});

test('summarizeSwitchBoard 汇总指标工具条数据', () => {
  const rows = buildSwitchBoardRows({ rules: [RULE, { ...RULE, id: 'rule-2', enabled: false }] }, SNAPSHOT);
  const summary = summarizeSwitchBoard(rows);
  assert.equal(summary.total, 2);
  assert.equal(summary.monitoring, 1);
  assert.equal(summary.triggeredToday, 4);
});

test('sanitizeSwitchChannelKeys 只保留已支持渠道', () => {
  assert.deepEqual(sanitizeSwitchChannelKeys(['pc', 'bogus']), ['pc']);
  assert.deepEqual(sanitizeSwitchChannelKeys([]), SWITCH_CHANNEL_KEYS);
  assert.deepEqual(sanitizeSwitchChannelKeys(undefined), SWITCH_CHANNEL_KEYS);
  assert.deepEqual(sanitizeSwitchChannelKeys(['email', 'ios']), ['ios', 'email']);
});
