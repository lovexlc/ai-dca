import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPresetAlerts,
  collectManualAlertTypes,
  defaultNotifyPresets,
  isPresetAlertId,
  mergePresetAlerts,
  normalizePresetThreshold,
  readNotifyPresets,
  persistNotifyPresets,
  PRESET_DEFS,
} from '../src/pages/notify/notifyPresets.js';

function withWindow(fn) {
  const store = {};
  const prev = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: (key) => { delete store[key]; },
    },
  };
  try {
    return fn(store);
  } finally {
    if (prev === undefined) delete globalThis.window;
    else globalThis.window = prev;
  }
}

test('默认预设：阈值与开关均为关闭', () => {
  const defaults = defaultNotifyPresets();
  assert.equal(defaults.gain.enabled, false);
  assert.equal(defaults.gain.threshold, 2);
  assert.equal(defaults.premium.threshold, 8);
  assert.equal(defaults.daily.enabled, false);
});

test('read/persist 预设：合并默认值，损坏数据回退', () => {
  withWindow((store) => {
    persistNotifyPresets({ gain: { enabled: true, threshold: 3 } });
    const loaded = readNotifyPresets();
    assert.equal(loaded.gain.enabled, true);
    assert.equal(loaded.gain.threshold, 3);
    assert.equal(loaded.loss.enabled, false);
    assert.equal(loaded.loss.threshold, 2);
    store['ai-dca-notify-presets-v1'] = 'not-json{{{';
    const fallback = readNotifyPresets();
    assert.equal(fallback.gain.enabled, false);
  });
});

test('buildPresetAlerts: 大涨预设按持仓展开，需要 holdingCost', () => {
  const holdings = [
    { symbol: '159655', name: '电池ETF', holdingCost: 1.25 },
    { symbol: '513100', name: '纳指ETF', holdingCost: 0 },
    { symbol: '', name: '空代码', holdingCost: 2 },
  ];
  const alerts = buildPresetAlerts('gain', 5, holdings);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].symbol, '159655');
  assert.equal(alerts[0].type, 'holding-alert');
  assert.equal(alerts[0].alertType, 'gain');
  assert.equal(alerts[0].threshold, 5);
  assert.equal(alerts[0].holdingCost, 1.25);
  assert.equal(alerts[0].presetId, 'gain');
  assert.equal(alerts[0].enabled, true);
});

test('buildPresetAlerts: 溢价预设走 market-alert，仅 6 位代码', () => {
  const holdings = [
    { symbol: '159655', name: '电池ETF', holdingCost: 1.25 },
    { symbol: 'ABC', name: '场外基金', holdingCost: 1 },
  ];
  const alerts = buildPresetAlerts('premium', 8, holdings);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'market-alert');
  assert.equal(alerts[0].alertType, 'premium');
  assert.equal(alerts[0].threshold, 8);
  assert.equal(alerts[0].presetId, 'premium');
});

test('buildPresetAlerts: 跳过已有同类型手工规则的标的', () => {
  const holdings = [
    { symbol: '159655', name: '电池ETF', holdingCost: 1.25 },
    { symbol: '513100', name: '纳指ETF', holdingCost: 2.5 },
  ];
  const manual = collectManualAlertTypes([
    { symbol: '159655', alertType: 'gain' },
    { symbol: '159655', alertType: 'loss', presetId: 'loss' },
  ]);
  const alerts = buildPresetAlerts('gain', 5, holdings, manual);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].symbol, '513100');
});

test('mergePresetAlerts: 清掉该预设旧规则，手工规则保留', () => {
  const existing = [
    { id: 'holding-alert:preset:gain:159655', presetId: 'gain', symbol: '159655', threshold: 5 },
    { id: 'manual-1', symbol: '159655', alertType: 'gain', threshold: 10 },
    { id: 'holding-alert:preset:loss:159655', presetId: 'loss', symbol: '159655', threshold: 5 },
  ];
  const next = [{ id: 'holding-alert:preset:gain:513100', presetId: 'gain', symbol: '513100', threshold: 3 }];
  const merged = mergePresetAlerts(existing, 'gain', next);
  assert.equal(merged.length, 3);
  assert.ok(!merged.some((a) => a.id === 'holding-alert:preset:gain:159655'));
  assert.ok(merged.some((a) => a.id === 'manual-1'));
  assert.ok(merged.some((a) => a.id === 'holding-alert:preset:loss:159655'));
  assert.ok(merged.some((a) => a.id === 'holding-alert:preset:gain:513100'));
});

test('mergePresetAlerts: 关闭预设即清空该预设规则', () => {
  const existing = [
    { id: 'holding-alert:preset:gain:159655', presetId: 'gain', symbol: '159655' },
    { id: 'manual-1', symbol: '159655' },
  ];
  const merged = mergePresetAlerts(existing, 'gain', []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'manual-1');
});

test('normalizePresetThreshold: 非法值回退默认值', () => {
  assert.equal(normalizePresetThreshold('gain', 3), 3);
  assert.equal(normalizePresetThreshold('gain', 0), 2);
  assert.equal(normalizePresetThreshold('gain', -2), 2);
  assert.equal(normalizePresetThreshold('gain', 'abc'), 2);
  assert.equal(normalizePresetThreshold('premium', null), 8);
});

test('isPresetAlertId: 只有涨跌/溢价走 alert 展开', () => {
  assert.equal(isPresetAlertId('gain'), true);
  assert.equal(isPresetAlertId('loss'), true);
  assert.equal(isPresetAlertId('premium'), true);
  assert.equal(isPresetAlertId('daily'), false);
  assert.equal(isPresetAlertId('dca'), false);
  assert.equal(isPresetAlertId('plan'), false);
});

test('PRESET_DEFS: 涨跌走持仓提醒，溢价走市场提醒', () => {
  assert.equal(PRESET_DEFS.gain.kind, 'holding-alert');
  assert.equal(PRESET_DEFS.loss.kind, 'holding-alert');
  assert.equal(PRESET_DEFS.premium.kind, 'market-alert');
});
