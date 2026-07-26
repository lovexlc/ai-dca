import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fundLimitApiBase,
  limitRowFromFundLimitResponse,
  syncOtcFundLimitsFromCache,
} from '../workers/markets/src/otcFundLimitSync.js';

test('fundLimitApiBase prefers env override', () => {
  assert.equal(fundLimitApiBase({ FUND_LIMIT_API_BASE: 'https://x.example/' }), 'https://x.example');
  assert.match(fundLimitApiBase({}), /freebacktrack/);
});

test('limitRowFromFundLimitResponse maps cache payload', () => {
  const row = limitRowFromFundLimitResponse({
    code: '110022',
    buyStatus: '1',
    maxPurchasePerDay: 50000,
    source: 'announcement',
    error: undefined,
  });
  assert.equal(row.code, '110022');
  assert.equal(row.maxPurchasePerDay, 50000);
});

test('limitRowFromFundLimitResponse rejects pure error body', () => {
  assert.equal(
    limitRowFromFundLimitResponse({ code: '110022', error: 'cache miss' }, '110022'),
    null
  );
});

test('syncOtcFundLimitsFromCache upserts hits and counts misses', async () => {
  const originalFetch = globalThis.fetch;
  const store = new Map();
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('code=110022')) {
      return new Response(JSON.stringify({
        code: '110022',
        buyStatus: '1',
        maxPurchasePerDay: 1000,
        source: 'f10_html',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'miss', code: '999999' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };

  const db = {
    prepare(sql) {
      return {
        bind(...binds) {
          return {
            async run() {
              store.set(binds[0], binds);
              return { success: true };
            },
          };
        },
      };
    },
  };

  try {
    const summary = await syncOtcFundLimitsFromCache(
      { DB: db, FUND_LIMIT_API_BASE: 'https://example.test' },
      ['110022', '999999'],
      { concurrency: 2 }
    );
    assert.equal(summary.total, 2);
    assert.equal(summary.cacheHit, 1);
    assert.equal(summary.miss, 1);
    assert.equal(summary.d1Ok, 1);
    assert.equal(store.has('110022'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('syncOtcFundLimitsFromCache skips without DB', async () => {
  const summary = await syncOtcFundLimitsFromCache({}, ['110022']);
  assert.equal(summary.skippedNoDb, true);
  assert.equal(summary.d1Ok, 0);
});
