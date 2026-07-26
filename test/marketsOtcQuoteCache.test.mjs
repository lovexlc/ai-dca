import { test } from 'node:test';
import assert from 'node:assert/strict';

import marketsWorker from '../workers/markets/src/index.js';
import { quoteCacheKey } from '../workers/markets/src/quoteCache.js';
import { getOtcFundFromCache } from '../workers/markets/src/otcFundSync.js';
import { createCacheEnvelope } from '../workers/markets/src/cachePolicy.js';

function createEnv(entries = {}) {
  const normalizedEntries = Object.entries(entries).map(([key, value]) => {
    if (!key.startsWith('quote:')) return [key, value];
    const payload = typeof value === 'string' ? JSON.parse(value) : value;
    if (payload?.version === 2) return [key, value];
    const fetchedAt = Date.parse(String(payload?.asOf || payload?.cachedAt || '')) || Date.now();
    return [key, JSON.stringify(createCacheEnvelope({
      key,
      market: 'otc',
      fundKind: 'otc',
      source: payload?.source || 'danjuan',
      fetchedAt: new Date(fetchedAt),
      asOf: payload?.asOf || payload?.cachedAt || new Date(fetchedAt),
      validUntil: new Date(fetchedAt + 24 * 3600 * 1000),
      staleUntil: new Date(fetchedAt + 7 * 24 * 3600 * 1000),
      payload
    }))];
  });
  const store = new Map(normalizedEntries);
  return {
    store,
    MARKETS_KV: {
      async get(key, options) {
        if (Array.isArray(key)) {
          const out = new Map();
          for (const item of key) {
            const raw = store.get(item);
            if (raw != null) out.set(item, JSON.parse(raw));
          }
          return out;
        }
        const raw = store.get(key);
        if (raw == null) return null;
        return options?.type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key, value) {
        store.set(key, value);
      }
    }
  };
}

async function requestQuotes(env) {
  const response = await marketsWorker.fetch(
    new Request('https://api.example.test/api/markets/quotes?symbols=000834'),
    env,
    {}
  );
  return response.json();
}

function mockDanjuanFetch(navDate) {
  return async (input) => {
    const path = new URL(input).pathname;
    if (path.includes('/derived/')) {
      return new Response(JSON.stringify({
        result_code: 0,
        data: {
          fd_name: '测试场外基金',
          unit_nav: '1.234',
          nav_grtd: '0.2',
          end_date: navDate
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (path.includes('/achievement/')) {
      return new Response(JSON.stringify({ result_code: 0, data: { annual_performance_list: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ result_code: 0, data: { fund_position: {} } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
}

test('batch OTC quotes skips fresh Danjuan KV without calling upstream', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    throw new Error('upstream must not be called for a fresh OTC quote');
  };
  const env = createEnv({
    [quoteCacheKey('000834')]: JSON.stringify({
      symbol: '000834',
      code: '000834',
      latestNav: 1.234,
      source: 'danjuan',
      asOf: new Date().toISOString()
    })
  });

  try {
    const payload = await requestQuotes(env);
    assert.equal(payload.quotes['000834'].latestNav, 1.234);
    assert.deepEqual(payload.quotes['000834'].cache, { hit: true, source: 'kv', status: 'fresh' });
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('batch OTC quotes does not use an old quote cache even when cachedAt was renewed', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({ result_code: 1, message: 'unavailable' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const env = createEnv({
    [quoteCacheKey('000834')]: JSON.stringify({
      symbol: '000834',
      code: '000834',
      latestNav: 1.234,
      source: 'danjuan',
      asOf: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      cachedAt: new Date().toISOString()
    })
  });

  try {
    const payload = await requestQuotes(env);
    assert.equal(payload.quotes['000834'].error, 'OTC fund data unavailable');
    assert.equal(payload.quotes['000834'].cache, undefined);
    assert.equal(upstreamCalls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('batch OTC quotes does not rewrite cache when source repeats the old NAV date', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockDanjuanFetch('2026-07-21');
  const oldQuote = {
    symbol: '000834',
    code: '000834',
    latestNav: 1.2,
    latestNavDate: '2026-07-21',
    source: 'danjuan',
    asOf: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
    cachedAt: new Date().toISOString()
  };
  const env = createEnv({ [quoteCacheKey('000834')]: JSON.stringify(oldQuote) });
  const storedBefore = JSON.parse(env.store.get(quoteCacheKey('000834')));

  try {
    const payload = await requestQuotes(env);
    assert.equal(payload.quotes['000834'].cache.status, 'delayed');
    assert.equal(payload.quotes['000834'].stale, undefined);
    assert.deepEqual(JSON.parse(env.store.get(quoteCacheKey('000834'))), storedBefore);
    assert.equal(env.store.has('otc_fund:000834'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('overlapping OTC requests share one Danjuan fetch per code', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  const sourceFetch = mockDanjuanFetch('2026-07-22');
  globalThis.fetch = async (...args) => {
    upstreamCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return sourceFetch(...args);
  };
  const env = createEnv();

  try {
    const [first, second] = await Promise.all([requestQuotes(env), requestQuotes(env)]);
    assert.equal(first.quotes['000834'].latestNav, 1.234);
    assert.equal(second.quotes['000834'].latestNav, 1.234);
    assert.equal(upstreamCalls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OTC legacy key is ignored after the test cache cutover', async () => {
  const legacy = {
    code: '000834',
    timestamp: Date.now(),
    derived: { fd_name: '测试基金', unit_nav: '1.2', nav_grtd: '0.1', end_date: '2026-07-22' },
    achievement: { annual_performance_list: [] },
    detail: { fund_position: {} }
  };
  const env = createEnv({ 'otc_fund:000834': JSON.stringify(legacy) });
  const quote = await getOtcFundFromCache('000834', env.MARKETS_KV);
  assert.equal(quote, null);
  assert.equal(env.store.has('otc-raw:000834'), false);
  assert.equal(env.store.has('otc_fund:000834'), true);
  assert.equal(env.store.has(quoteCacheKey('000834')), false);
});
