import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MOBILE_METRICS_ETF,
  DEFAULT_MOBILE_METRICS_OTC,
  MOBILE_METRIC_MAX,
  MOBILE_PAGE_SIZE,
  buildIdentityLine,
  catalogForMode,
  defaultMobileExpanded,
  defaultMobileMetrics,
  formatRowCode,
  isOtcFundRow,
  readMobileMetricsConfig,
  resolveMetricDisplay,
  sortMobileRows,
  writeMobileMetricsConfig,
} from '../src/pages/markets/mobileFundMetrics.js';

// Expose normalize via public behavior: write + read

test('mobile page size and metric max match compact list spec', () => {
  assert.equal(MOBILE_PAGE_SIZE, 20);
  assert.equal(MOBILE_METRIC_MAX, 3);
});

test('otc and etf default metrics differ and stay within three slots', () => {
  assert.deepEqual(defaultMobileMetrics(true), DEFAULT_MOBILE_METRICS_OTC);
  assert.deepEqual(defaultMobileMetrics(false), DEFAULT_MOBILE_METRICS_ETF);
  assert.equal(DEFAULT_MOBILE_METRICS_OTC.length, 3);
  assert.equal(DEFAULT_MOBILE_METRICS_ETF.length, 3);
  assert.ok(DEFAULT_MOBILE_METRICS_OTC.includes('limit'));
  assert.ok(DEFAULT_MOBILE_METRICS_ETF.includes('premium'));
  assert.ok(!DEFAULT_MOBILE_METRICS_ETF.includes('limit'));
  assert.ok(!defaultMobileExpanded(true).includes('feeRate'));
});

test('catalog filters otc-only and etf-only metrics by mode', () => {
  const otcIds = catalogForMode(true).map((item) => item.id);
  const etfIds = catalogForMode(false).map((item) => item.id);
  assert.ok(otcIds.includes('limit'));
  assert.ok(!otcIds.includes('feeRate'));
  assert.ok(!otcIds.includes('premium'));
  assert.ok(etfIds.includes('premium'));
  assert.ok(!etfIds.includes('limit'));
  assert.ok(!etfIds.includes('feeRate'));
});

test('isOtcFundRow respects list flag and row kind', () => {
  assert.equal(isOtcFundRow({ symbol: '513100' }, true), true);
  assert.equal(isOtcFundRow({ fundKind: 'otc' }, false), true);
  assert.equal(isOtcFundRow({ assetType: '场外基金' }, false), true);
  assert.equal(isOtcFundRow({ symbol: '513100', name: '纳指ETF' }, false), false);
});

test('buildIdentityLine formats otc and etf identity text', () => {
  const otc = buildIdentityLine(
    {
      latestNavDate: '2026-07-23',
      fundMeta: { share_class: 'A', currency: 'CNY' },
    },
    true
  );
  assert.match(otc, /场外基金/);
  assert.match(otc, /净值日 07-23/);

  const etf = buildIdentityLine(
    {
      name: '纳指ETF国泰',
      fundMeta: { index_key: 'nasdaq100' },
      asOf: '2026-07-23T15:00:00+08:00',
    },
    false
  );
  assert.match(etf, /场内ETF/);
  assert.match(etf, /纳指100/);
  assert.match(etf, /更新 \d{2}:\d{2}/);
});

test('resolveMetricDisplay formats price change and limit', () => {
  const row = {
    price: 6.3921,
    changePercent: 0.0155,
    fundLimit: { buyStatus: 'open', maxPurchasePerDay: 1000 },
  };
  const price = resolveMetricDisplay('price', row);
  assert.equal(price.id, 'price');
  assert.ok(String(price.text).includes('6.39') || String(price.text).includes('6.392'));

  const change = resolveMetricDisplay('changePercent', row);
  assert.match(String(change.text), /\+/);

  const limit = resolveMetricDisplay('limit', row);
  assert.match(String(limit.text), /限额|1000|开放/);
});

test('sortMobileRows ranks by changePercent like ORDER BY (no soft held boost)', () => {
  const rows = [
    { symbol: 'A', name: 'a', changePercent: 0.01, isHeld: false },
    { symbol: 'B', name: 'b', changePercent: 0.05, isHeld: true },
    { symbol: 'C', name: 'c', changePercent: 0.08, isHeld: false },
  ];
  const sorted = sortMobileRows(rows, { id: 'changePercent', desc: true });
  assert.equal(sorted[0].symbol, 'C');
  assert.equal(sorted[1].symbol, 'B');
  assert.equal(sorted[2].symbol, 'A');

  const heldFirst = sortMobileRows(rows, { id: 'heldRank', desc: true });
  assert.equal(heldFirst[0].symbol, 'B');
});

test('mobile metrics config persists otc and etf independently and caps at three', () => {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  };

  writeMobileMetricsConfig(true, ['price', 'changePercent', 'limit', 'return1m', 'return3m']);
  writeMobileMetricsConfig(false, ['premium', 'highDrawdown', 'historicalPercentile', 'turnover']);

  assert.deepEqual(readMobileMetricsConfig(true), ['price', 'changePercent', 'limit']);
  assert.deepEqual(readMobileMetricsConfig(false), ['premium', 'highDrawdown', 'historicalPercentile']);

  // Invalid etf limit id falls back toward defaults when empty after filter
  writeMobileMetricsConfig(false, ['limit']);
  const etf = readMobileMetricsConfig(false);
  assert.equal(etf.length, 3);
  assert.ok(!etf.includes('limit'));

  delete globalThis.window;
});

test('formatRowCode strips market prefix for display', () => {
  assert.equal(formatRowCode({ symbol: 'sh513100' }), '513100');
  assert.equal(formatRowCode({ symbol: '000834' }), '000834');
});
