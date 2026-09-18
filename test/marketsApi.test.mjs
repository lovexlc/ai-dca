import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  __internals,
  fetchFundFees,
  fetchFundMetrics,
  fetchFundVenues,
  fetchKline,
  fetchQuotes,
} from '../src/app/marketsApi.js';
import { fetchNavHistory } from '../src/app/navHistoryClient.js';

function mockJsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('configured CN market base replaces the Worker route without changing the default', () => {
  const cnBase = 'https://cn.freebacktrack.tech:5000/api/market-collector/';

  assert.equal(
    __internals.resolveBase({ runtimeBase: '', configuredBase: cnBase }),
    'https://cn.freebacktrack.tech:5000/api/market-collector',
  );
  assert.equal(
    __internals.resolveFundFeeUrl(true, { runtimeBase: '', configuredBase: cnBase }),
    'https://cn.freebacktrack.tech:5000/api/market-collector/fund-fee?refresh=1',
  );
  assert.equal(
    __internals.resolveBase({ runtimeBase: '', configuredBase: '' }),
    'https://api.freebacktrack.tech/api/markets',
  );
});

test('fund fee uses the dedicated market API when CN runtime override is present', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    __MARKETS_API_BASE__: 'https://cn.freebacktrack.tech:5000/api/market-collector/',
  };
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return mockJsonResponse({ items: [], successCount: 0, failureCount: 0 });
  };

  try {
    await fetchFundFees(['000001'], { refresh: true });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0],
      'https://cn.freebacktrack.tech:5000/api/market-collector/fund-fee?refresh=1',
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

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
  assert.equal(forceLive, '513100|cn|5m||0|all|live');
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

test('fund venue classification uses the configured market API', async () => {
  __internals.clearMarketsApiInflight();
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    __MARKETS_API_BASE__: 'https://api.freebacktrack.tech/api/markets'
  };
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    return mockJsonResponse({
      items: [
        {
          code: '539001',
          fundVenue: 'otc',
          fundCategory: 'qdii',
          fundKind: 'qdii',
          candidates: []
        },
        {
          code: '513100',
          fundVenue: 'exchange',
          fundCategory: 'qdii',
          fundKind: 'exchange',
          candidates: []
        }
      ]
    });
  };

  try {
    const result = await fetchFundVenues(['539001', 'sh513100']);
    assert.deepEqual(result.items.map((item) => item.code), ['539001', '513100']);
    assert.equal(result.items[0].fundKind, 'qdii');
    assert.equal(new URL(calls[0].input).pathname, '/api/markets/fund-venue');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body).codes, ['539001', '513100']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    __internals.clearMarketsApiInflight();
  }
});

test('fund metrics forwards a definitive venue classification as its kind hint', async () => {
  __internals.clearMarketsApiInflight();
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];
  globalThis.window = {
    __MARKETS_API_BASE__: 'https://api.freebacktrack.tech/api/markets'
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.endsWith('/fund-venue')) {
      return mockJsonResponse({
        items: [{
          code: '539001',
          fundVenue: 'otc',
          fundCategory: 'qdii',
          fundKind: 'qdii',
          candidates: []
        }]
      });
    }
    const body = JSON.parse(init.body);
    assert.equal(body.fundKinds['539001'], 'qdii');
    return mockJsonResponse({ items: [{ code: '539001', latestNav: 1.2 }] });
  };

  try {
    const result = await fetchFundMetrics(['539001']);
    assert.equal(result.items[0].latestNav, 1.2);
    assert.deepEqual(requests.map(({ url }) => url.pathname), [
      '/api/markets/fund-venue',
      '/api/markets/fund-metrics'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    __internals.clearMarketsApiInflight();
  }
});

test('fetchFundMetrics retries one transient browser fetch failure', async () => {
  __internals.clearMarketsApiInflight();
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls = [];
  let metricsAttempt = 0;
  globalThis.window = {
    __MARKETS_API_BASE__: 'https://api.freebacktrack.tech/api/markets'
  };
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    if (new URL(String(input)).pathname.endsWith('/fund-venue')) {
      return mockJsonResponse({ items: [] });
    }
    metricsAttempt += 1;
    if (metricsAttempt === 1) throw new TypeError('Failed to fetch');
    return mockJsonResponse({
      items: [{ code: '513100', latestNav: 2.1, price: 2.2 }],
    });
  };

  try {
    const result = await fetchFundMetrics(['513100']);
    assert.equal(result.items[0].code, '513100');
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
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
