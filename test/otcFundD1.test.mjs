import test from 'node:test';
import assert from 'node:assert/strict';
import {
  d1RowToFundLimit,
  d1RowToOtcListRow,
  d1RowToOtcQuote,
  hasOtcD1,
  upsertOtcFundLimit,
  upsertOtcFundQuote,
  loadOtcQuotesFromD1,
  loadOtcFundRowsByCodes,
  queryOtcFundListPage,
} from '../workers/markets/src/otcFundD1.js';

function makeMemoryDb() {
  /** @type {Map<string, Record<string, unknown>>} */
  const store = new Map();

  function applyUpsert(sql, binds) {
    const s = String(sql);
    if (s.includes('INSERT INTO otc_funds') && s.includes('latest_nav')) {
      // quote upsert bind order from upsertOtcFundQuote
      const [
        code, name, symbol,
        latest_nav, latest_nav_date, change_pct,
        ytd_return, return_1w, return_1m, return_3m, return_6m, return_1y, return_base,
        max_drawdown, fund_size, fund_type_code,
        source, as_of, quote_updated_at, quote_synced_at,
        quote_json, raw_json,
      ] = binds;
      const prev = store.get(code) || { code };
      store.set(code, {
        ...prev,
        code,
        name,
        symbol,
        latest_nav,
        latest_nav_date,
        change_pct,
        ytd_return,
        return_1w,
        return_1m,
        return_3m,
        return_6m,
        return_1y,
        return_base,
        max_drawdown,
        fund_size,
        fund_type_code,
        source,
        as_of,
        quote_updated_at,
        quote_synced_at,
        quote_json,
        raw_json: raw_json != null ? raw_json : prev.raw_json ?? null,
        updated_at: 'now',
      });
      return;
    }
    if (s.includes('INSERT INTO otc_funds') && s.includes('buy_status')) {
      const [
        code, name,
        buy_status, buy_status_text, min_purchase, max_purchase_per_day,
        limit_channel, redeem_status, fixed_invest, fixed_invest_min, confirm_days,
        limit_source, limit_json, limit_synced_at,
      ] = binds;
      const prev = store.get(code) || { code, name: name || code };
      store.set(code, {
        ...prev,
        code,
        name: prev.name || name,
        buy_status,
        buy_status_text,
        min_purchase,
        max_purchase_per_day,
        limit_channel,
        redeem_status,
        fixed_invest,
        fixed_invest_min,
        confirm_days,
        limit_source,
        limit_json,
        limit_synced_at,
        updated_at: 'now',
      });
      return;
    }
    throw new Error('unexpected sql: ' + s.slice(0, 80));
  }

  return {
    store,
    prepare(sql) {
      const s = String(sql);
      return {
        bind(...binds) {
          return {
            async run() {
              applyUpsert(s, binds);
              return { success: true };
            },
            async all() {
              if (s.includes('WHERE code IN')) {
                const results = binds.map((c) => store.get(c)).filter(Boolean);
                return { results };
              }
              return { results: [...store.values()] };
            },
            async first() {
              if (s.includes('COUNT')) return { n: store.size };
              return null;
            },
          };
        },
        async run() {
          return { success: true };
        },
        async all() {
          return { results: [...store.values()] };
        },
        async first() {
          if (s.includes('COUNT')) return { n: store.size };
          return null;
        },
      };
    },
  };
}

test('hasOtcD1 detects prepare', () => {
  assert.equal(hasOtcD1({}), false);
  assert.equal(hasOtcD1({ DB: {} }), false);
  assert.equal(hasOtcD1({ DB: { prepare() {} } }), true);
});

test('upsert quote + limit round-trip to list quote shape', async () => {
  const db = makeMemoryDb();
  const quote = {
    code: '110022',
    name: '易方达消费',
    latestNav: 1.23,
    latestNavDate: '2026-07-24',
    changePercent: 0.5,
    ytdReturn: 10.1,
    return1w: 0.2,
    return1m: 1.1,
    return3m: 3.3,
    return6m: 5.5,
    return1y: 12.0,
    returnBase: 80,
    maxDrawdown: -25.5,
    fundSize: 100.5,
    fundTypeCode: '2',
    source: 'danjuan',
    asOf: '2026-07-24T12:00:00.000Z',
    updatedAt: 1720000000,
  };
  const r = await upsertOtcFundQuote(db, quote, { derived: { unit_nav: '1.23' } });
  assert.equal(r.ok, true);
  assert.equal(r.code, '110022');

  const lim = await upsertOtcFundLimit(db, {
    code: '110022',
    buyStatus: '1',
    buyStatusText: '可购',
    minPurchase: 10,
    maxPurchasePerDay: 50000,
    source: 'test',
  });
  assert.equal(lim.ok, true);

  const map = await loadOtcFundRowsByCodes(db, ['110022', '999999']);
  assert.equal(map.size, 1);
  const row = map.get('110022');
  assert.equal(row.latest_nav, 1.23);
  assert.equal(row.max_purchase_per_day, 50000);

  const quotes = await loadOtcQuotesFromD1(db, ['110022']);
  const q = quotes['110022'];
  assert.ok(q);
  assert.equal(q.latestNav, 1.23);
  assert.equal(q.return1m, 1.1);
  assert.equal(q.fundLimit.maxPurchasePerDay, 50000);
  assert.equal(q._d1, true);
});

test('d1RowToOtcQuote falls back to columns without quote_json', () => {
  const q = d1RowToOtcQuote({
    code: '000001',
    name: 'demo',
    change_pct: 1.2,
    latest_nav: 1.01,
    return_1y: 8,
    buy_status: '1',
    max_purchase_per_day: 1000,
  });
  assert.equal(q.code, '000001');
  assert.equal(q.changePercent, 1.2);
  assert.equal(q.fundLimit.maxPurchasePerDay, 1000);
});

test('d1RowToFundLimit returns null when empty', () => {
  assert.equal(d1RowToFundLimit({ code: '1' }), null);
});

test('d1RowToOtcListRow restores catalog name when D1 snapshot only has code', () => {
  const row = d1RowToOtcListRow({ code: '000834', name: '000834', latest_nav: 6.1 });
  assert.equal(row.name, '大成纳斯达克100ETF联接(QDII)A');
  assert.equal(row.fundKind, 'otc');
});

test('queryOtcFundListPage builds allowlisted SQL ORDER BY and stable cursor', async () => {
  const calls = [];
  const rows = [
    { code: '000001', name: 'A', change_pct: 3, latest_nav: 1.1 },
    { code: '000002', name: 'B', change_pct: 2, latest_nav: 1.2 },
    { code: '000003', name: 'C', change_pct: 1, latest_nav: 1.3 },
  ];
  const db = {
    prepare(sql) {
      return {
        bind(...bindings) {
          calls.push({ sql: String(sql), bindings });
          return {
            async all() { return { results: rows }; },
            async first() { return { n: rows.length }; },
          };
        },
      };
    },
  };

  const page = await queryOtcFundListPage(db, {
    symbols: ['000001', '000002', '000003'],
    heldSymbols: ['000002'],
    orderBy: [{ field: 'changePercent', dir: 'desc' }],
    limit: 2,
  });

  assert.match(calls[0].sql, /ORDER BY \(change_pct IS NULL\) ASC, change_pct DESC/);
  assert.match(calls[0].sql, /code COLLATE NOCASE ASC/);
  assert.match(calls[0].sql, /LIMIT \?/);
  assert.equal(calls[0].bindings.at(-1), 3);
  assert.equal(page.rows.length, 2);
  assert.equal(page.total, 3);
  assert.ok(page.nextCursor);

  const fallback = await queryOtcFundListPage(db, {
    symbols: ['000001'],
    orderBy: [{ field: 'changePercent; DROP TABLE otc_funds', dir: 'desc' }],
    limit: 1,
  });
  assert.match(calls.at(-2).sql, /ORDER BY \(held_rank IS NULL\) ASC, held_rank DESC/);
  assert.equal(fallback.orderBy[0].field, 'heldRank');
});
