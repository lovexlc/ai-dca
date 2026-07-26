import test from 'node:test';
import assert from 'node:assert/strict';

test('matchD1ProbeRequest: only probe paths', async () => {
  const { matchD1ProbeRequest } = await import('../workers/markets/src/d1Probe.js');
  assert.equal(await matchD1ProbeRequest(new Request('https://x/'), {}, '/other'), null);
});

test('matchD1ProbeRequest: requires admin when unbound', async () => {
  const { matchD1ProbeRequest } = await import('../workers/markets/src/d1Probe.js');
  const denied = await matchD1ProbeRequest(
    new Request('https://x/api/markets/d1-probe'),
    {},
    '/d1-probe'
  );
  assert.ok(denied);
  assert.equal(denied.status, 503);
});

test('matchD1ProbeRequest: unbound returns setup with admin', async () => {
  const { matchD1ProbeRequest } = await import('../workers/markets/src/d1Probe.js');
  const res = await matchD1ProbeRequest(
    new Request('https://x/api/markets/d1-probe', {
      headers: { authorization: 'Bearer test-token' }
    }),
    { MARKETS_ADMIN_TOKEN: 'test-token' },
    '/d1-probe'
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.bound, false);
  assert.equal(body.engine, 'd1');
});

test('matchD1ProbeRequest: mock DB returns otc_funds sample', async () => {
  const { matchD1ProbeRequest } = await import('../workers/markets/src/d1Probe.js');
  const rows = [
    { code: '161725', name: 'demo-c', latest_nav: 0.98, change_pct: 2.1, quote_synced_at: 't' },
    { code: '000001', name: 'demo-a', latest_nav: 1.2, change_pct: 1.25, quote_synced_at: 't' }
  ];
  const db = {
    prepare(sql) {
      const s = String(sql);
      return {
        bind(..._args) {
          return this;
        },
        async first() {
          if (s.includes('SELECT 1')) return { ok: 1 };
          if (s.includes('COUNT')) return { n: rows.length };
          return null;
        },
        async all() {
          return { results: rows };
        }
      };
    }
  };
  const res = await matchD1ProbeRequest(
    new Request('https://x/api/markets/d1-probe', {
      headers: { authorization: 'Bearer t' }
    }),
    { MARKETS_ADMIN_TOKEN: 't', DB: db },
    '/d1-probe'
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.bound, true);
  assert.equal(body.otcFundsCount, 2);
  assert.equal(body.sample[0].code, '161725');
  assert.equal(body.table, 'otc_funds');
});

test('matchD1ProbeRequest: otc-d1-limits upserts', async () => {
  const { matchD1ProbeRequest } = await import('../workers/markets/src/d1Probe.js');
  const store = new Map();
  const db = {
    prepare(sql) {
      return {
        bind(...binds) {
          return {
            async run() {
              const code = binds[0];
              store.set(code, true);
              return { success: true };
            }
          };
        }
      };
    }
  };
  const res = await matchD1ProbeRequest(
    new Request('https://x/api/markets/otc-d1-limits', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({
        limits: {
          '110022': { code: '110022', maxPurchasePerDay: 10000, buyStatus: '1' }
        }
      })
    }),
    { MARKETS_ADMIN_TOKEN: 't', DB: db },
    '/otc-d1-limits'
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.okCount, 1);
  assert.equal(store.has('110022'), true);
});
