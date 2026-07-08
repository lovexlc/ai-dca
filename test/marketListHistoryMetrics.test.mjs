import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveMarketListHistoryMetrics,
  normalizeListHistoryCandles,
} from '../src/pages/markets/marketListHistoryMetrics.js';

function candle(date, close, high = close, low = close) {
  return {
    date,
    t: Date.parse(`${date}T15:00:00+08:00`) / 1000,
    o: close,
    h: high,
    l: low,
    c: close,
  };
}

test('list history metrics derive high point, percentile and returns from local candles', () => {
  const candles = [
    candle('2026-01-02', 1),
    candle('2026-06-20', 1.5, 1.8, 1.4),
    candle('2026-06-27', 1.8, 2, 1.7),
    candle('2026-07-04', 2, 2.1, 1.9),
  ];

  const metrics = deriveMarketListHistoryMetrics(candles, { currentPrice: 2.2 });

  assert.equal(metrics.highPoint.high, 2.1);
  assert.equal(metrics.highPoint.highDate, '2026-07-04');
  assert.equal(metrics.highPoint.source, 'local-kline-365d');
  assert.equal(metrics.closeHighPoint.high, 2);
  assert.equal(metrics.closeHighPoint.highDate, '2026-07-04');
  assert.equal(metrics.closeHighPoint.source, 'local-close-kline-365d');
  assert.equal(metrics.historicalPercentile, 100);
  assert.equal(metrics.return1w, 22.22);
  assert.equal(metrics.returnBase, 120);
  assert.equal(metrics.ytdReturn, 120);
});

test('list history normalization deduplicates by date and sorts ascending', () => {
  const rows = normalizeListHistoryCandles([
    candle('2026-07-04', 2),
    candle('2026-07-03', 1.8),
    { ...candle('2026-07-04', 2.1), h: 2.2 },
  ]);

  assert.deepEqual(rows.map((item) => item.date), ['2026-07-03', '2026-07-04']);
  assert.equal(rows[1].c, 2.1);
});
