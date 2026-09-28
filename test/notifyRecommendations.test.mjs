import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNotifyRecommendations,
  dismissRecommendation,
  PREMIUM_REC_TRIGGER,
  readDismissedRecommendationIds,
} from '../src/pages/notify/notifyRecommendations.js';

const POSITIONS = [
  { symbol: '159659', name: '招商纳指ETF', holdingCost: 2.2 },
  { symbol: '159632', name: '华安纳指ETF', holdingCost: 2.4 },
  { symbol: '510300', name: '沪深300ETF', holdingCost: 4.0 },
];

const QUOTES = {
  159659: { premiumPercent: 8.9 },
  159632: { premiumPercent: 8.5 },
  510300: { premiumRate: 0.001 },
};

const ALL_OFF = {
  daily: { enabled: false },
  gain: { enabled: false, threshold: 2 },
  loss: { enabled: false, threshold: 2 },
  premium: { enabled: false, threshold: 8 },
  dca: { enabled: false },
};

function build(overrides = {}) {
  return buildNotifyRecommendations({
    positions: POSITIONS,
    quotesBySymbol: QUOTES,
    presets: ALL_OFF,
    dcaCount: 2,
    dismissedIds: new Set(),
    ...overrides,
  });
}

test('无持仓无定投时不生成任何推荐', () => {
  const recs = build({ positions: [], dcaCount: 0 });
  assert.deepEqual(recs, []);
});

test('无持仓但有定投计划时只推荐定投提醒', () => {
  const recs = build({ positions: [], dcaCount: 2 });
  assert.deepEqual(recs.map((rec) => rec.id), ['dca:all']);
});

test('溢价达标的持仓生成推荐并按溢价从高到低排序', () => {
  const recs = build();
  const premiumRecs = recs.filter((rec) => rec.presetId === 'premium');
  assert.equal(premiumRecs.length, 2);
  assert.equal(premiumRecs[0].id, 'premium:159659');
  assert.equal(premiumRecs[0].data.premium, 8.9);
  assert.equal(premiumRecs[1].id, 'premium:159632');
  // 510300 溢价 0.1% 不达标
  assert.ok(!premiumRecs.some((rec) => rec.id === 'premium:510300'));
});

test(`溢价低于触发线（${PREMIUM_REC_TRIGGER}%）不推荐`, () => {
  const recs = build({
    positions: [{ symbol: '510300', name: '沪深300ETF', holdingCost: 4 }],
    quotesBySymbol: { 510300: { premiumPercent: 3.2 } },
  });
  assert.ok(!recs.some((rec) => rec.presetId === 'premium'));
});

test('行情缺失时降级：只生成不依赖行情的推荐', () => {
  const recs = build({ quotesBySymbol: {} });
  assert.ok(!recs.some((rec) => rec.presetId === 'premium'));
  assert.ok(recs.some((rec) => rec.id === 'gain:all'));
  assert.ok(recs.some((rec) => rec.id === 'daily:all'));
});

test('已开启的预设不再推荐', () => {
  const recs = build({
    presets: { ...ALL_OFF, premium: { enabled: true, threshold: 8 }, gain: { enabled: true, threshold: 2 } },
  });
  assert.ok(!recs.some((rec) => rec.presetId === 'premium'));
  assert.ok(!recs.some((rec) => rec.id === 'gain:all'));
  assert.ok(recs.some((rec) => rec.id === 'loss:all'));
});

test('用户关闭过的推荐不再出现', () => {
  const recs = build({ dismissedIds: new Set(['premium:159659', 'daily:all']) });
  assert.ok(!recs.some((rec) => rec.id === 'premium:159659'));
  assert.ok(recs.some((rec) => rec.id === 'premium:159632'));
  assert.ok(!recs.some((rec) => rec.id === 'daily:all'));
});

test('涨跌推荐使用预设阈值并统计有成本持仓数', () => {
  const recs = build();
  const gain = recs.find((rec) => rec.id === 'gain:all');
  assert.equal(gain.threshold, 2);
  assert.equal(gain.data.count, 3);
  // 无成本持仓不计入
  const noCost = build({ positions: [{ symbol: '159659', name: '招商纳指ETF', holdingCost: 0 }] });
  assert.ok(!noCost.some((rec) => rec.id === 'gain:all'));
});

test('定投推荐依赖定投计划数量', () => {
  assert.ok(build({ dcaCount: 2 }).some((rec) => rec.id === 'dca:all'));
  assert.ok(!build({ dcaCount: 0 }).some((rec) => rec.id === 'dca:all'));
});

test('推荐按溢价、涨、跌、汇总、定投的顺序排列', () => {
  const ids = build().map((rec) => rec.id);
  const order = ['premium:159659', 'premium:159632', 'gain:all', 'loss:all', 'daily:all', 'dca:all'];
  assert.deepEqual(ids, order);
});

test('服务端环境下关闭推荐为无操作且不抛错', () => {
  assert.doesNotThrow(() => dismissRecommendation('premium:159659'));
  assert.ok(readDismissedRecommendationIds() instanceof Set);
});
