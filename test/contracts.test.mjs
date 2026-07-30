import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeQuote, normalizeQuotesPayload } from '../src/app/contracts/quoteContract.js';
import {
  normalizeFundMetricsPayload,
  normalizeKlinePayload
} from '../src/app/contracts/marketDataContract.js';
import {
  normalizeNavHistoryBatchPayload,
  normalizeNavHistoryPayload
} from '../src/app/contracts/navContract.js';

test('quote contract normalizes numeric fields while retaining Worker metadata', () => {
  const quote = normalizeQuote({
    code: '513100',
    price: '2.14',
    changePercent: '0.33',
    asOf: '2026-07-30T08:00:00.000Z',
    highPoint: { high: 3 },
    source: 'xueqiu-quote'
  });

  assert.equal(quote.price, 2.14);
  assert.equal(quote.changePct, 0.33);
  assert.equal(quote.ts, Date.parse('2026-07-30T08:00:00.000Z'));
  assert.deepEqual(quote.highPoint, { high: 3 });
  assert.equal(quote.source, 'xueqiu-quote');
});

test('quote payload contract accepts both map and list responses', () => {
  const payload = normalizeQuotesPayload({
    quotes: [{ symbol: 'AAPL', currentPrice: '10', source: 'yahoo' }]
  });

  assert.equal(payload.quotes.AAPL.code, 'AAPL');
  assert.equal(payload.quotes.AAPL.price, 10);
  assert.equal(normalizeQuotesPayload(null).quotes instanceof Object, true);
});

test('fund metrics and kline contracts preserve unknown fields and add numeric aliases', () => {
  const metrics = normalizeFundMetricsPayload({ items: [{ code: '000834', price: '1.2', premiumPct: '3.5', extra: true }] });
  assert.equal(metrics.items[0].price, 1.2);
  assert.equal(metrics.items[0].premiumPercent, 3.5);
  assert.equal(metrics.items[0].extra, true);

  const kline = normalizeKlinePayload({ candles: [{ t: '10', c: '1.1', h: '1.2', custom: 'keep' }] });
  assert.equal(kline.candles[0].close, 1.1);
  assert.equal(kline.candles[0].high, 1.2);
  assert.equal(kline.candles[0].custom, 'keep');
});

test('NAV contracts normalize single and batch response item shapes', () => {
  const single = normalizeNavHistoryPayload({ items: [{ date: '2026-07-30T00:00:00Z', unitNav: '1.05' }] });
  assert.equal(single.items[0].date, '2026-07-30');
  assert.equal(single.items[0].nav, 1.05);

  const batch = normalizeNavHistoryBatchPayload({
    items: [{ code: '000834', ok: true, data: { items: [{ date: '2026-07-30', nav: '1.2' }] } }]
  });
  assert.equal(batch.items[0].data.items[0].nav, 1.2);
});
