import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fillCnBatchQuotes } from '../workers/markets/src/cnBatchQuotes.js';
import { attachHistoricalPercentile, __internals } from '../workers/markets/src/historicalPercentile.js';
import { marketDateString } from '../workers/markets/src/storage.js';

function navEnvelope(key, month, items, { envelope = {}, payload = {} } = {}) {
  return {
    version: 2,
    key,
    market: 'cn',
    fundKind: 'otc',
    source: 'nav-history',
    fetchedAt: '2026-07-07T00:00:00.000Z',
    asOf: `${month}-07`,
    validUntil: '2026-08-07T00:00:00.000Z',
    staleUntil: '2026-09-07T00:00:00.000Z',
    payload: {
      version: 1,
      code: '159659',
      month,
      items,
      ...payload
    },
    ...envelope
  };
}

test('NAV history reader unwraps the stored envelope payload', async () => {
  const key = 'navhist:v1:159659:2026-07';
  const rows = await __internals.readNavHistoryRows({
    NAV_HISTORY_KV: {
      async get(requestedKey) {
        if (requestedKey === key) {
          return navEnvelope(key, '2026-07', [
            { date: '2026-07-01', nav: 2.1 },
            { date: '2026-07-02', nav: 2.2 }
          ]);
        }
        return null;
      }
    }
  }, '159659', '2026-07-07');

  assert.deepEqual(rows, [
    { date: '2026-07-01', value: 2.1 },
    { date: '2026-07-02', value: 2.2 }
  ]);
});

test('NAV history reader rejects wrong key, source, expired, and malformed envelopes', async () => {
  const baseKey = 'navhist:v1:159659:2026-07';
  const validItems = [{ date: '2026-07-01', nav: 2.1 }, { date: '2026-07-02', nav: 2.2 }];
  const cases = [
    ['wrong-key', navEnvelope('navhist:v1:other:2026-07', '2026-07', validItems)],
    ['wrong-source', navEnvelope(baseKey, '2026-07', validItems, { envelope: { source: 'not-nav-history' } })],
    ['malformed-payload', navEnvelope(baseKey, '2026-07', validItems, { payload: { items: 'not-an-array' } })],
    ['expired', navEnvelope(baseKey, '2026-07', validItems, { envelope: { staleUntil: '2026-07-06T00:00:00.000Z' } })]
  ];

  for (const [label, value] of cases) {
    const rows = await __internals.readNavHistoryRows({
      NAV_HISTORY_KV: {
        async get(key) { return key === baseKey ? value : null; }
      }
    }, '159659', '2026-07-07');
    assert.deepEqual(rows, [], label);
  }
});

test('batch historical percentile uses NAV history envelope data', async () => {
  const month = marketDateString('cn').slice(0, 7);
  const key = `navhist:v1:159659:${month}`;
  const quote = {
    symbol: 'sh159659',
    code: '159659',
    market: 'cn',
    price: 2.2,
    latestNav: 2.2,
    source: 'xueqiu-quote'
  };
  const result = await attachHistoricalPercentile({
    NAV_HISTORY_KV: {
      async get(requestedKey) {
        if (requestedKey === key) {
          return navEnvelope(key, month, [
            { date: `${month}-01`, nav: 1.8 },
            { date: `${month}-02`, nav: 2.0 },
            { date: `${month}-03`, nav: 2.4 }
          ]);
        }
        return null;
      }
    }
  }, quote, 'cn');

  assert.equal(result.historicalPercentile, 66.67);
});

test('CN batch live quote exposes the repaired historical percentile before cache write', async () => {
  const month = marketDateString('cn').slice(0, 7);
  const historyKey = `navhist:v1:159659:${month}`;
  const originalFetch = globalThis.fetch;
  const out = {};
  globalThis.fetch = async (url) => {
    if (String(url).includes('/v5/stock/quote.json')) {
      return new Response(JSON.stringify({ data: { quote: {
        symbol: 'SH159659',
        code: '159659',
        name: '159659 ETF',
        current: 2.2,
        last_close: 2.1,
        unit_nav: 2.2,
        nav_date: Date.parse('2026-07-03T00:00:00.000Z'),
        premium_rate: 0
      } } }), { status: 200 });
    }
    return new Response('order book unavailable', { status: 503 });
  };
  try {
    await fillCnBatchQuotes({
      MARKETS_KV: { async get() { return null; }, async put() {} },
      NAV_HISTORY_KV: {
        async get(key) {
          return key === historyKey
            ? navEnvelope(historyKey, month, [
              { date: `${month}-01`, nav: 1.8 },
              { date: `${month}-02`, nav: 2.0 },
              { date: `${month}-03`, nav: 2.4 }
            ])
            : null;
        }
      },
      XUEQIU_COOKIE: 'test'
    }, [{ raw: '159659', code: 'sh159659' }], out);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(out['159659'].historicalPercentile, 66.67);
});
