import test from 'node:test';
import assert from 'node:assert/strict';
import {
  limitPayloadForD1,
  pushFundLimitsToMarketsD1,
} from '../workers/ocr-proxy/src/fundLimit.js';

test('limitPayloadForD1 strips cache noise and keeps sort fields', () => {
  const p = limitPayloadForD1({
    code: '110022',
    buyStatus: '1',
    maxPurchasePerDay: 50000,
    minPurchase: 10,
    cached: true,
    tried: [{ source: 'x' }],
    source: 'announcement',
  });
  assert.equal(p.code, '110022');
  assert.equal(p.maxPurchasePerDay, 50000);
  assert.equal(p.cached, undefined);
  assert.equal(p.tried, undefined);
  assert.equal(p.source, 'announcement');
});

test('limitPayloadForD1 rejects bad code', () => {
  assert.equal(limitPayloadForD1({ code: 'abc' }), null);
});

test('pushFundLimitsToMarketsD1 skips without service or token', async () => {
  const a = await pushFundLimitsToMarketsD1({}, [{ ok: true, data: { code: '110022', buyStatus: '1' } }]);
  assert.equal(a.skipped, true);
  assert.equal(a.reason, 'MARKETS_service_missing');

  const b = await pushFundLimitsToMarketsD1(
    { MARKETS: { fetch() {} } },
    [{ ok: true, data: { code: '110022', buyStatus: '1' } }]
  );
  assert.equal(b.skipped, true);
  assert.equal(b.reason, 'MARKETS_ADMIN_TOKEN_missing');
});

test('pushFundLimitsToMarketsD1 POSTs limits map to markets', async () => {
  let seen;
  const env = {
    MARKETS_ADMIN_TOKEN: 'tok',
    MARKETS: {
      async fetch(req) {
        seen = {
          url: String(req.url),
          method: req.method,
          auth: req.headers.get('authorization'),
          body: await req.json(),
        };
        return new Response(JSON.stringify({ ok: true, okCount: 1, total: 1, errors: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  };
  const out = await pushFundLimitsToMarketsD1(env, [
    { ok: true, data: { code: '110022', maxPurchasePerDay: 1e4, buyStatus: '1' } },
    { ok: false, data: null },
  ]);
  assert.equal(out.ok, true);
  assert.equal(out.okCount, 1);
  assert.ok(seen.url.includes('/api/markets/otc-d1-limits'));
  assert.equal(seen.method, 'POST');
  assert.equal(seen.auth, 'Bearer tok');
  assert.equal(seen.body.limits['110022'].maxPurchasePerDay, 10000);
});
