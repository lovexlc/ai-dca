import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import marketsWorker from '../workers/markets/src/index.js';
import {
  TACO_CACHE_KEY,
  TACO_MODEL,
  calculateTacoSentiment,
  computeTacoSentiment,
  fetchWindwardLatest,
  isValidTacoPayload
} from '../workers/markets/src/tacoSentiment.js';

const FACTORS = [
  { key: 'brent', label: '布伦特原油', value: 87.64, displayValue: '$87.64', source: 'yahoo-chart', asOf: '2026-07-28T05:48:16.000Z', tone: 'rose', direction: '正向项', note: 'Yahoo Brent 期货' },
  { key: 'ust10y', label: '美债10Y', value: 4.641, displayValue: '4.641%', source: 'yahoo-chart', asOf: '2026-07-27T18:59:52.000Z', tone: 'amber', direction: '正向项', note: 'Yahoo 10Y 指数' },
  { key: 'hormuz', label: '霍尔木兹通行', value: 6, displayValue: '6 艘/日', source: 'windward-browser-run', asOf: '2026-07-27', tone: 'emerald', direction: '反向项', note: 'Windward 24h crossings' },
  { key: 'sp500', label: '标普500', value: 7413.18, displayValue: '7,413.18', source: 'yahoo-chart', asOf: '2026-07-27T20:52:41.000Z', tone: 'slate', direction: '缓冲项', note: 'Yahoo S&P 500 指数' }
];

function createKv(initial = new Map()) {
  const values = initial;
  return {
    values,
    async get(key) {
      return values.get(key) || null;
    },
    async put(key, value) {
      values.set(key, value);
    }
  };
}

function yahooChartResponse(symbol, price, timestamp = 1783030000) {
  return new Response(JSON.stringify({
    chart: {
      result: [{
        meta: {
          symbol,
          regularMarketPrice: price,
          chartPreviousClose: price - 1,
          regularMarketTime: timestamp
        },
        timestamp: [timestamp],
        indicators: { quote: [{ close: [price] }] }
      }]
    }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function browserScrapeResponse() {
  return new Response(JSON.stringify({
    success: true,
    result: [
      {
        selector: '.dmap-panel.dmap-in .dmap-sub',
        results: [{ text: '3 transits · 3 North' }]
      },
      {
        selector: '.dmap-panel.dmap-out .dmap-sub',
        results: [{ text: '3 transits · 3 North' }]
      },
      {
        selector: '.dmap-panel-footer',
        results: [{ text: 'Source: Windward AI · July 27, 2026 windward.ai' }]
      }
    ]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('calculates the score from local factors using the fitted formula', () => {
  const payload = calculateTacoSentiment(FACTORS, { generatedAt: '2026-07-28T06:00:00.000Z' });
  const expectedRaw = 9.7727
    + 0.611395 * 87.64
    + 5.89306 * 4.641
    - 0.00144492 * 7413.18
    - 0.765978 * 6;

  assert.equal(payload.source, 'local-four-factor-model');
  assert.equal(payload.modelVersion, TACO_MODEL.version);
  assert.equal(payload.rawScore, Math.round(expectedRaw * 10000) / 10000);
  assert.equal(payload.score, Math.max(0, Math.min(100, Math.round(expectedRaw))));
  assert.equal(payload.factors.find((factor) => factor.key === 'brent').modelTerm, 53.58);
  assert.equal(isValidTacoPayload(payload, { now: Date.parse('2026-07-28T06:01:00.000Z') }), true);
});

test('Browser Run scrape parses Windward inbound and outbound transits', async () => {
  const calls = [];
  const latest = await fetchWindwardLatest({
    browser: {
      async quickAction(action, options) {
        calls.push({ action, options });
        return browserScrapeResponse();
      }
    }
  });

  assert.equal(latest.value, 6);
  assert.equal(latest.inbound, 3);
  assert.equal(latest.outbound, 3);
  assert.equal(latest.date, '2026-07-27');
  assert.equal(latest.source, 'windward-browser-run');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'scrape');
  assert.equal(calls[0].options.url, 'https://insights.windward.ai/');
  assert.equal(calls[0].options.elements.length, 3);
});

test('scheduled recompute fetches four local factors, writes KV, and API only reads KV', async () => {
  const kv = createKv();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async (input) => {
    fetchCount += 1;
    const url = String(input);
    if (url.includes('/BZ%3DF?')) return yahooChartResponse('BZ=F', 87.64);
    if (url.includes('/%5ETNX?')) return yahooChartResponse('^TNX', 4.641);
    if (url.includes('/%5EGSPC?')) return yahooChartResponse('^GSPC', 7413.18);
    throw new Error(`unexpected upstream ${url}`);
  };

  try {
    const env = {
      MARKETS_KV: kv,
      MARKETS_DATA_READ_MODE: 'cache-first',
      BROWSER: { async quickAction() { return browserScrapeResponse(); } }
    };
    const pending = [];
    await marketsWorker.scheduled(
      { cron: '0 */2 * * *', scheduledTime: Date.parse('2026-07-28T06:00:00.000Z') },
      env,
      { waitUntil(promise) { pending.push(promise); } }
    );
    await Promise.all(pending);

    const cachedPayload = JSON.parse(kv.values.get(TACO_CACHE_KEY));
    assert.equal(cachedPayload.source, 'local-four-factor-model');
    assert.equal(cachedPayload.factors.find((factor) => factor.key === 'hormuz').value, 6);
    assert.equal(cachedPayload.factors.find((factor) => factor.key === 'hormuz').source, 'windward-browser-run');
    assert.equal(fetchCount, 3);

    const response = await marketsWorker.fetch(
      new Request('https://test.freebacktrack.tech/api/markets/taco'),
      env,
      {}
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.cached, true);
    assert.equal(payload.score, cachedPayload.score);
    assert.equal(fetchCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TACO API never fetches upstream on a cache miss or stale cache', async () => {
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('upstream must not be called by the API route');
  };

  try {
    const emptyResponse = await marketsWorker.fetch(
      new Request('https://test.freebacktrack.tech/api/markets/taco'),
      { MARKETS_KV: createKv(), MARKETS_DATA_READ_MODE: 'cache-first' },
      {}
    );
    assert.equal(emptyResponse.status, 503);

    const stale = calculateTacoSentiment(FACTORS, { generatedAt: '2026-07-27T00:00:00.000Z' });
    const staleResponse = await marketsWorker.fetch(
      new Request('https://test.freebacktrack.tech/api/markets/taco'),
      { MARKETS_KV: createKv(new Map([[TACO_CACHE_KEY, JSON.stringify(stale)]])), MARKETS_DATA_READ_MODE: 'cache-first' },
      {}
    );
    assert.equal(staleResponse.status, 503);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TACO API rejects a cache payload with a mismatched factor source', async () => {
  const invalid = calculateTacoSentiment(FACTORS, { generatedAt: '2026-07-28T06:00:00.000Z' });
  invalid.factors[2] = { ...invalid.factors[2], source: 'windward-page' };
  const response = await marketsWorker.fetch(
    new Request('https://test.freebacktrack.tech/api/markets/taco'),
    { MARKETS_KV: createKv(new Map([[TACO_CACHE_KEY, JSON.stringify(invalid)]])), MARKETS_DATA_READ_MODE: 'cache-first' },
    {}
  );
  assert.equal(response.status, 503);
});

test('test Worker config schedules local TACO recompute every two hours', () => {
  const config = fs.readFileSync('workers/markets/wrangler.test.toml', 'utf8');
  assert.match(config, /\[browser\]\s+binding = "BROWSER"/);
  assert.match(config, /"0 \*\/2 \* \* \*"/);
});
