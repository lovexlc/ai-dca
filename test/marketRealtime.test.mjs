import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergePricePushItems } from '../src/app/navService.js';
import { normalizeMarketSnapshotItem } from '../workers/notify/src/marketDataPush.js';

test('market realtime normalizes exchange fund snapshot fields', () => {
  const item = normalizeMarketSnapshotItem({
    code: '513100',
    name: '纳指ETF',
    market: 'cn',
    fundKind: 'exchange',
    price: 2.365,
    previousClose: 2.273,
    change: 0.092,
    changePercent: 4.05,
    latestNav: 2.065,
    latestNavDate: '2026-06-02',
    iopv: 2.0647,
    asOf: '2026-06-03T10:12:03+08:00',
    quoteDate: '2026-06-03',
    marketState: 'REGULAR',
    source: 'fund-metrics'
  });

  assert.equal(item.code, '513100');
  assert.equal(item.kind, 'exchange_fund');
  assert.equal(item.price, 2.365);
  assert.equal(item.prevClose, 2.273);
  assert.equal(item.latestNav, 2.065);
  assert.equal(item.latestNavDate, '2026-06-02');
  assert.equal(item.estimatedNav, 2.0647);
  assert.equal(item.estimatedNavSource, 'iopv');
  assert.equal(item.premiumPercent, 14.5445);
  assert.equal(item.quoteAt, '2026-06-03T10:12:03+08:00');
});

test('market realtime merge preserves snapshot and applies WS fields', () => {
  const existing = [{
    code: '513100',
    latestNav: 2.05,
    latestNavDate: '2026-06-01',
    previousNav: 2.01,
    price: 2.32,
    currentPrice: 2.32
  }];

  const merged = mergePricePushItems(existing, [{
    code: '513100',
    price: 2.365,
    prevClose: 2.273,
    changePercent: 4.05,
    latestNav: 2.065,
    latestNavDate: '2026-06-02',
    estimatedNav: 2.0647,
    premiumPercent: 14.5411,
    quoteAt: '2026-06-03T10:12:03+08:00',
    quoteDate: '2026-06-03',
    source: 'fund-metrics'
  }]);

  assert.notEqual(merged, existing);
  assert.equal(merged[0].price, 2.365);
  assert.equal(merged[0].previousClose, 2.273);
  assert.equal(merged[0].previousNav, 2.273);
  assert.equal(merged[0].latestNav, 2.065);
  assert.equal(merged[0].latestNavDate, '2026-06-02');
  assert.equal(merged[0].estimatedNav, 2.0647);
  assert.equal(merged[0].premiumPercent, 14.5411);
  assert.equal(merged[0].quoteAt, '2026-06-03T10:12:03+08:00');
  assert.equal(merged[0].asOf, '2026-06-03T10:12:03+08:00');
});
