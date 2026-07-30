import { test } from 'node:test';
import assert from 'node:assert/strict';

import { __internals, fetchKline, fetchQuotes, searchSymbols } from '../src/app/marketsApi.js';
import { fetchNavHistory } from '../src/app/navHistoryClient.js';

function mockJsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('market kline inflight key separates full-session intraday requests', () => {
  const latest = __internals.klineInflightKey('513100', {
    timeframe: '5m',
    market: 'cn',
  });
  const fullSession = __internals.klineInflightKey('513100', {
    timeframe: '5m',
    market: 'cn',
    session: 'all',
  });
  const forceLive = __internals.klineInflightKey('513100', {
    timeframe: '5m',
    market: 'cn',
    session: 'all',
    forceLive: true,
  });

  assert.notEqual(latest, fullSession);
  assert.notEqual(fullSession, forceLive);
  assert.equal(fullSession, '513100|cn|5m||0|all');
  assert.equal(forceLive, '513100|cn|5m||0|all||live');
});

test('market quotes use the Worker endpoint instead of browser direct sources', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return mockJsonResponse({
      quotes: {
        '513100': {
          code: '513100',
          price: 2.114,
          changePercent: 0.33,
          source: 'xueqiu-quote',
        },
      },
    });
  };

  try {
    __internals.clearMarketsApiInflight();
    const result = await fetchQuotes(['513100']);

    assert.equal(result.quotes['513100'].source, 'xueqiu-quote');
    assert.equal(calls.length, 1);
    const url = new URL(calls[0]);
    assert.equal(url.pathname, '/api/markets/quotes');
    assert.equal(url.searchParams.get('symbols'), '513100');
    assert.equal(calls.some((call) => call.includes('qt.gtimg.cn')), false);
  } finally {
    globalThis.fetch = originalFetch;
    __internals.clearMarketsApiInflight();
  }
});

test('market K-lines use the Worker endpoint instead of Eastmoney direct data', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return mockJsonResponse({
      symbol: '513100',
      market: 'cn',
      source: 'xueqiu-kline',
      candles: [{ t: 1781827200, o: 2.1, h: 2.2, l: 2, c: 2.15, v: 100 }],
    });
  };

  try {
    __internals.clearMarketsApiInflight();
    const result = await fetchKline('513100', { market: 'cn', timeframe: '1d', limit: 1 });

    assert.equal(result.source, 'xueqiu-kline');
    assert.equal(result.candles.length, 1);
    assert.equal(calls.length, 1);
    const url = new URL(calls[0]);
    assert.equal(url.pathname, '/api/markets/kline/513100');
    assert.equal(url.searchParams.get('tf'), '1d');
    assert.equal(url.searchParams.get('market'), 'cn');
    assert.equal(calls.some((call) => call.includes('push2his.eastmoney.com')), false);
  } finally {
    globalThis.fetch = originalFetch;
    __internals.clearMarketsApiInflight();
  }
});

test('detail K-lines can explicitly bypass browser cache and request live data', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return mockJsonResponse({
      symbol: '513100',
      market: 'cn',
      source: 'realtime+r2',
      candles: [{ t: 1781827200, o: 2.1, h: 2.2, l: 2, c: 2.15, v: 100 }],
    });
  };

  try {
    __internals.clearMarketsApiInflight();
    const result = await fetchKline('513100', {
      market: 'cn',
      timeframe: '1d',
      limit: 30,
      forceLive: true,
    });

    assert.equal(result.source, 'realtime+r2');
    assert.equal(calls.length, 1);
    const url = new URL(calls[0]);
    assert.equal(url.pathname, '/api/markets/kline/513100');
    assert.equal(url.searchParams.get('live'), '1');
  } finally {
    globalThis.fetch = originalFetch;
    __internals.clearMarketsApiInflight();
  }
});

test('detail NAV history can explicitly bypass browser cache', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return mockJsonResponse({
      ok: true,
      items: [{ date: '2026-07-29', nav: 1.23 }],
      generatedAt: '2026-07-30T01:00:00.000Z',
      expiresAt: '2026-07-30T02:00:00.000Z',
    });
  };

  try {
    const result = await fetchNavHistory({ code: '513100', days: 30, forceLive: true });

    assert.equal(result.items.length, 1);
    assert.equal(calls.length, 1);
    const url = new URL(calls[0], 'http://localhost');
    assert.equal(url.pathname.split('/').at(-1), 'nav-history');
    assert.equal(url.searchParams.get('force'), '1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('market search uses the Worker endpoint instead of browser direct sources', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return mockJsonResponse({
      market: 'cn',
      query: '161130',
      results: [{ symbol: 'sz161130', code: '161130', assetType: 'exchange_fund' }],
    });
  };

  try {
    const result = await searchSymbols('cn', '161130', { limit: 8 });

    assert.equal(result.results[0].code, '161130');
    assert.equal(calls.length, 1);
    const url = new URL(calls[0]);
    assert.equal(url.pathname, '/api/markets/search');
    assert.equal(url.searchParams.get('market'), 'cn');
    assert.equal(url.searchParams.get('q'), '161130');
    assert.equal(calls.some((call) => call.includes('smartbox.gtimg.cn')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
