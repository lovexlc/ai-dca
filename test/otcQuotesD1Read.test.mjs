import test from 'node:test';
import assert from 'node:assert/strict';
import {
  d1RowToOtcQuote,
  loadOtcQuotesFromD1,
} from '../workers/markets/src/otcFundD1.js';
import { buildListRowFromQuote } from '../workers/markets/src/listRowsRoute.js';

test('d1RowToOtcQuote embeds fundLimit for list/quote consumers', () => {
  const quote = d1RowToOtcQuote({
    code: '110022',
    name: '易方达消费',
    latest_nav: 2.88,
    change_pct: -1.03,
    buy_status: 'open',
    buy_status_text: '开放申购',
    max_purchase_per_day: 50000,
    min_purchase: 10,
    limit_source: 'f10_html',
  });
  assert.equal(quote.latestNav, 2.88);
  assert.equal(quote.fundLimit.buyStatus, 'open');
  assert.equal(quote.fundLimit.maxPurchasePerDay, 50000);
  assert.equal(quote._d1, true);

  const row = buildListRowFromQuote({
    symbol: '110022',
    quote,
    market: 'cn',
    isOtcList: true,
  });
  assert.equal(row.fundLimit.buyStatus, 'open');
  assert.equal(row.price, 2.88);
  assert.equal(row.changePercent, -1.03);
});

test('loadOtcQuotesFromD1 returns fundLimit for batch quotes path', async () => {
  const rows = new Map([
    ['000834', {
      code: '000834',
      name: '大成纳指',
      latest_nav: 1.5,
      change_pct: 0.5,
      buy_status: 'limit_large',
      max_purchase_per_day: 100,
    }],
  ]);
  const db = {
    prepare(sql) {
      return {
        bind(...codes) {
          return {
            async all() {
              const results = codes.map((c) => rows.get(c)).filter(Boolean);
              return { results };
            },
          };
        },
      };
    },
  };
  const map = await loadOtcQuotesFromD1(db, ['000834', '999999']);
  assert.ok(map['000834']);
  assert.equal(map['000834'].fundLimit.maxPurchasePerDay, 100);
  assert.equal(map['999999'], undefined);
});
