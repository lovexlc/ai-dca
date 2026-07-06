import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  __internals,
  cacheRealtimeDirectQuotes,
  clearDirectMarketDataCaches,
  fetchDirectQuotes,
  fetchDirectKline,
  normalizeDirectSymbol,
  parseEastmoneyKlinePayload,
  parseTencentQuoteText,
  searchDirectSymbols,
  parseTencentSearchText
} from '../src/app/directMarketData.js';

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

test('direct symbol normalization maps CN ETF symbols to Tencent and Eastmoney ids', () => {
  assert.deepEqual(normalizeDirectSymbol('513100'), {
    market: 'cn',
    code: '513100',
    tencent: 'sh513100',
    eastmoneySecid: '1.513100'
  });
  assert.deepEqual(normalizeDirectSymbol('159941'), {
    market: 'cn',
    code: '159941',
    tencent: 'sz159941',
    eastmoneySecid: '0.159941'
  });
  assert.equal(normalizeDirectSymbol('AAPL').tencent, 'usAAPL');
});

test('Tencent quote text normalizes market quote fields', () => {
  const text = 'v_sh513100="1~纳指ETF国泰~513100~2.167~2.158~2.150~3356138~0~0~2.167~411~2.166~1564~2.165~5061~2.164~436~2.163~3098~2.168~2749~2.169~2746~2.170~7318~2.171~5064~2.172~1773~~20260703161434~0.009~0.42~2.175~2.140~2.151~3356138~727000000~1.2~12.3~~~~3.1~100~200~1.5~2.38~1.82";';
  const quotes = parseTencentQuoteText(text);

  assert.equal(quotes['513100'].name, '纳指ETF国泰');
  assert.equal(quotes['513100'].price, 2.167);
  assert.equal(quotes['513100'].previousClose, 2.158);
  assert.equal(quotes['513100'].changePercent, 0.42);
  assert.equal(quotes.sh513100.source, 'tencent-direct');
});

test('Tencent smartbox search parser decodes fund records', () => {
  const rows = parseTencentSearchText('v_hint="sh~513100~\\u7eb3\\u6307ETF\\u56fd\\u6cf0~nzetfgt~QDII-ETF"');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, 'sh513100');
  assert.equal(rows[0].name, '纳指ETF国泰');
  assert.equal(rows[0].assetType, 'fund');
});

test('Tencent smartbox search parser accepts raw window.v_hint body', () => {
  const rows = parseTencentSearchText('sh~513100~\\u7eb3\\u6307ETF\\u56fd\\u6cf0~nzetfgt~QDII-ETF');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, 'sh513100');
  assert.equal(rows[0].name, '纳指ETF国泰');
});

test('direct Tencent quotes reuse fresh localStorage cache without network', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const storage = createStorage();
  globalThis.window = { localStorage: storage };
  storage.setItem(__internals.LOCAL_QUOTE_CACHE_KEY, JSON.stringify({
    sh513100: {
      quote: {
        symbol: '513100',
        code: '513100',
        name: '纳指ETF国泰',
        market: 'cn',
        price: 2.167,
        currentPrice: 2.167,
        close: 2.167,
        source: 'tencent-direct'
      },
      expiresAt: Date.now() + 30_000,
      cachedAtMs: Date.now(),
      source: 'tencent-direct'
    }
  }));
  globalThis.fetch = async () => {
    throw new Error('network should not be called');
  };

  try {
    const payload = await fetchDirectQuotes(['513100']);

    assert.equal(payload.quotes['513100'].price, 2.167);
    assert.equal(payload.source, 'tencent-direct-cache');
  } finally {
    clearDirectMarketDataCaches();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test('direct Tencent quotes write normalized localStorage cache after network fetch', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const storage = createStorage();
  globalThis.window = { localStorage: storage };
  globalThis.fetch = async () => new Response(
    'v_sh513100="1~纳指ETF国泰~513100~2.167~2.158~2.150~3356138~0~0~2.167~411~2.166~1564~2.165~5061~2.164~436~2.163~3098~2.168~2749~2.169~2746~2.170~7318~2.171~5064~2.172~1773~~20260703161434~0.009~0.42~2.175~2.140~2.151~3356138~727000000~1.2~12.3~~~~3.1~100~200~1.5~2.38~1.82";',
    { status: 200 }
  );

  try {
    const payload = await fetchDirectQuotes(['513100']);
    const cached = JSON.parse(storage.getItem(__internals.LOCAL_QUOTE_CACHE_KEY));

    assert.equal(payload.quotes['513100'].price, 2.167);
    assert.equal(cached.sh513100.quote.price, 2.167);
    assert.equal(cached.sh513100.source, 'tencent-direct');
    assert.ok(cached.sh513100.expiresAt > Date.now());
  } finally {
    clearDirectMarketDataCaches();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test('direct Tencent quotes reuse one inflight request for duplicate concurrent batches', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const storage = createStorage();
  let fetchCount = 0;
  globalThis.window = { localStorage: storage };
  globalThis.fetch = async () => {
    fetchCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(
      'v_sh513100="1~纳指ETF国泰~513100~2.167~2.158~2.150~3356138~0~0~2.167~411~2.166~1564~2.165~5061~2.164~436~2.163~3098~2.168~2749~2.169~2746~2.170~7318~2.171~5064~2.172~1773~~20260703161434~0.009~0.42~2.175~2.140~2.151~3356138~727000000~1.2~12.3~~~~3.1~100~200~1.5~2.38~1.82";',
      { status: 200 }
    );
  };

  try {
    const [first, second] = await Promise.all([
      fetchDirectQuotes(['513100']),
      fetchDirectQuotes(['513100']),
    ]);

    assert.equal(fetchCount, 1);
    assert.equal(first.quotes['513100'].price, 2.167);
    assert.equal(second.quotes['513100'].price, 2.167);
    assert.equal(__internals.inflightSizes().quotes, 0);
  } finally {
    clearDirectMarketDataCaches();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test('direct Tencent quote local cache rejects expired or mismatched-source entries', () => {
  const now = Date.now();
  const quote = {
    symbol: '513100',
    code: '513100',
    market: 'cn',
    price: 2.167,
    source: 'tencent-direct'
  };

  assert.equal(__internals.isValidLocalQuote({ quote, expiresAt: now - 1, source: 'tencent-direct' }, now), false);
  assert.equal(__internals.isValidLocalQuote({
    quote: { ...quote, source: 'worker-cache' },
    expiresAt: now + 30_000,
    source: 'worker-cache'
  }, now), false);
  assert.equal(__internals.isValidLocalQuote({
    quote,
    expiresAt: now + 30_000,
    source: 'worker-cache'
  }, now), false);
  assert.equal(__internals.isValidLocalQuote({ quote, expiresAt: now + 30_000, source: 'tencent-direct' }, now), true);
});

test('direct Tencent quote local cache write ignores blank keys', () => {
  const originalWindow = globalThis.window;
  const storage = createStorage();
  globalThis.window = { localStorage: storage };

  try {
    __internals.writeCachedDirectQuotes([
      { key: '', quote: { price: 9, source: 'tencent-direct' } },
      { key: 'sh513100', quote: { price: 2.167, source: 'tencent-direct' } }
    ], Date.now());
    const cached = JSON.parse(storage.getItem(__internals.LOCAL_QUOTE_CACHE_KEY));

    assert.deepEqual(Object.keys(cached), ['sh513100']);
    assert.equal(cached.sh513100.quote.price, 2.167);
  } finally {
    clearDirectMarketDataCaches();
    globalThis.window = originalWindow;
  }
});

test('realtime price push writes direct quote cache for later fetchDirectQuotes reads', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const storage = createStorage();
  globalThis.window = { localStorage: storage };
  globalThis.fetch = async () => {
    throw new Error('network should not be called');
  };

  try {
    const count = cacheRealtimeDirectQuotes([{
      code: '513100',
      name: '纳指ETF国泰',
      price: 2.365,
      prevClose: 2.273,
      changePercent: 4.05,
      volume: 12345678,
      turnover: 29382745.67,
      quoteAt: '2026-06-03T10:12:03+08:00'
    }]);
    const payload = await fetchDirectQuotes(['513100']);

    assert.equal(count, 1);
    assert.equal(payload.source, 'tencent-direct-cache');
    assert.equal(payload.quotes['513100'].price, 2.365);
    assert.equal(payload.quotes['513100'].source, 'market-realtime');
  } finally {
    clearDirectMarketDataCaches();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test('direct Tencent search reuses fresh localStorage cache without script request', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const storage = createStorage();
  const key = __internals.searchCacheKey('cn', '513100', 8);
  globalThis.window = { localStorage: storage };
  globalThis.document = {
    createElement() {
      throw new Error('script should not be created');
    }
  };
  storage.setItem(__internals.LOCAL_SEARCH_CACHE_KEY, JSON.stringify({
    [key]: {
      payload: {
        market: 'cn',
        query: '513100',
        results: [{ symbol: 'sh513100', code: '513100', source: 'tencent-smartbox' }],
        source: 'tencent-smartbox-direct'
      },
      expiresAt: Date.now() + 30_000,
      cachedAtMs: Date.now(),
      source: 'tencent-smartbox-direct'
    }
  }));

  try {
    const payload = await searchDirectSymbols('cn', '513100', { limit: 8 });

    assert.equal(payload.results[0].symbol, 'sh513100');
    assert.equal(payload.cache.source, 'localStorage');
  } finally {
    clearDirectMarketDataCaches();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test('direct Tencent search writes localStorage cache after script result', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const storage = createStorage();
  globalThis.window = { localStorage: storage, v_hint: '' };
  globalThis.document = {
    createElement() {
      return { src: '', charset: '', remove() {} };
    },
    body: {
      appendChild(script) {
        globalThis.window.v_hint = 'sh~513100~\\u7eb3\\u6307ETF\\u56fd\\u6cf0~nzetfgt~QDII-ETF';
        script.onload?.();
      }
    }
  };

  try {
    const payload = await searchDirectSymbols('cn', '513100', { limit: 8 });
    const cached = JSON.parse(storage.getItem(__internals.LOCAL_SEARCH_CACHE_KEY));
    const key = __internals.searchCacheKey('cn', '513100', 8);

    assert.equal(payload.results[0].symbol, 'sh513100');
    assert.equal(cached[key].payload.results[0].symbol, 'sh513100');
    assert.equal(cached[key].source, 'tencent-smartbox-direct');
  } finally {
    clearDirectMarketDataCaches();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test('direct Tencent search reuses one inflight script request for duplicate queries', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const storage = createStorage();
  let appendCount = 0;
  globalThis.window = { localStorage: storage, v_hint: '' };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'script');
      return {
        charset: '',
        src: '',
        remove() {}
      };
    },
    body: {
      appendChild(script) {
        appendCount += 1;
        setTimeout(() => {
          globalThis.window.v_hint = 'sh~513100~\\u7eb3\\u6307ETF\\u56fd\\u6cf0~nzetfgt~QDII-ETF';
          script.onload?.();
        }, 20);
      }
    }
  };

  try {
    const [first, second] = await Promise.all([
      searchDirectSymbols('cn', '513100', { limit: 8 }),
      searchDirectSymbols('cn', '513100', { limit: 8 }),
    ]);

    assert.equal(appendCount, 1);
    assert.equal(first.results[0].symbol, 'sh513100');
    assert.equal(second.results[0].symbol, 'sh513100');
    assert.equal(__internals.inflightSizes().search, 0);
  } finally {
    clearDirectMarketDataCaches();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test('direct Tencent search local cache rejects expired or mismatched-source entries', () => {
  const payload = {
    source: 'tencent-smartbox-direct',
    results: [{ symbol: 'sh513100' }]
  };

  assert.equal(__internals.isValidLocalSearchEntry({
    payload,
    expiresAt: Date.now() - 1,
    source: 'tencent-smartbox-direct'
  }), false);
  assert.equal(__internals.isValidLocalSearchEntry({
    payload,
    expiresAt: Date.now() + 30_000,
    source: 'worker-cache'
  }), false);
  assert.equal(__internals.isValidLocalSearchEntry({
    payload: { ...payload, source: 'worker-cache' },
    expiresAt: Date.now() + 30_000,
    source: 'tencent-smartbox-direct'
  }), false);
  assert.equal(__internals.isValidLocalSearchEntry({
    payload,
    expiresAt: Date.now() + 30_000,
    source: 'tencent-smartbox-direct'
  }), true);
});

test('Eastmoney kline payload maps csv rows to candle schema', () => {
  const payload = {
    rc: 0,
    data: {
      code: '513100',
      name: '纳指ETF国泰',
      klines: [
        '2026-07-01,2.100,2.120,2.130,2.090,12345,2600000.0,1.2,0.9,0.02,0.5'
      ]
    }
  };
  const normalized = parseEastmoneyKlinePayload(payload, { symbol: '513100', timeframe: '1d' });

  assert.equal(normalized.symbol, '513100');
  assert.equal(normalized.candles.length, 1);
  assert.equal(normalized.candles[0].o, 2.1);
  assert.equal(normalized.candles[0].c, 2.12);
  assert.equal(normalized.source, 'eastmoney-direct');
});

test('direct Eastmoney kline limit does not truncate memory cache payload', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      rc: 0,
      data: {
        code: '513111',
        name: '测试ETF',
        klines: [
          '2026-07-01,1.000,1.010,1.020,0.990,100,1000,0,0,0,0',
          '2026-07-02,1.010,1.020,1.030,1.000,100,1000,0,0,0,0',
          '2026-07-03,1.020,1.030,1.040,1.010,100,1000,0,0,0,0'
        ]
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const limited = await fetchDirectKline('513111', { timeframe: '1d', limit: 2 });
    const cachedFull = await fetchDirectKline('513111', { timeframe: '1d' });

    assert.equal(calls, 1);
    assert.equal(limited.candles.length, 2);
    assert.equal(cachedFull.candles.length, 3);
  } finally {
    clearDirectMarketDataCaches();
    globalThis.fetch = originalFetch;
  }
});

test('direct Eastmoney kline reuses one inflight request and applies per-caller limits', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(JSON.stringify({
      rc: 0,
      data: {
        code: '513111',
        name: '测试ETF',
        klines: [
          '2026-06-01,1.000,1.010,1.020,0.990,1000,10000',
          '2026-06-02,1.010,1.020,1.030,1.000,1200,12000',
          '2026-06-03,1.020,1.030,1.040,1.010,1300,13000',
        ]
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    clearDirectMarketDataCaches();
    const [limited, full] = await Promise.all([
      fetchDirectKline('513111', { timeframe: '1d', limit: 2 }),
      fetchDirectKline('513111', { timeframe: '1d' }),
    ]);

    assert.equal(fetchCount, 1);
    assert.equal(limited.candles.length, 2);
    assert.equal(full.candles.length, 3);
    assert.equal(limited.candles[0].date, '2026-06-02');
    assert.equal(__internals.inflightSizes().kline, 0);
  } finally {
    clearDirectMarketDataCaches();
    globalThis.fetch = originalFetch;
  }
});
