import assert from 'node:assert/strict';
import test from 'node:test';
import marketsWorker from '../workers/markets/src/index.js';
import { isValidTacoPayload, parseTacoPage } from '../workers/markets/src/tacoSentiment.js';

const TACO_HTML = `
  <main>
    <div aria-label="转向分 81"></div>
    <div>⚠ 霍尔木兹封锁进行中</div>
    <div>Windward 卫星数据 · 截至 <!-- -->2026-07-26<!-- --> · 24h 过境仅 <!-- -->4<!-- --> 艘</div>
    <div>川普让步(TACO)信号 盘中实时 🟢 转向在即</div>
    <div>历史分位 前 5% 1,707 个交易日里 第 91 高</div>
    <section>布伦特原油 偏高↑ $87.3 占压力 +17%</section>
    <section>美债10Y 正常 4.64% 占压力 +4%</section>
    <section>霍尔木兹通行 极低↓↓ 4 艘/日 占压力 +82%</section>
    <section>标普500 偏高↑ 7,413 占压力 -3%</section>
  </main>
`;

test('parses the live four-factor card from the server-rendered TACO page', () => {
  const payload = parseTacoPage(TACO_HTML, { generatedAt: '2026-07-28T12:00:00.000Z' });

  assert.equal(payload.score, 81);
  assert.equal(payload.asOf, '2026-07-26');
  assert.equal(payload.status, '转向在即');
  assert.deepEqual(payload.factors.map((factor) => ({
    key: factor.key,
    value: factor.value,
    contribution: factor.contribution
  })), [
    { key: 'brent', value: 87.3, contribution: 17 },
    { key: 'ust10y', value: 4.64, contribution: 4 },
    { key: 'hormuz', value: 4, contribution: 82 },
    { key: 'sp500', value: 7413, contribution: -3 }
  ]);
  assert.equal(isValidTacoPayload(payload, { now: Date.parse('2026-07-28T12:00:00.000Z'), maxAgeMs: 90_000 }), true);
  assert.equal(isValidTacoPayload(payload, { now: Date.parse('2026-07-28T12:02:00.000Z'), maxAgeMs: 90_000 }), false);
});

test('TACO endpoint caches the parsed live payload and refresh bypasses cache', async () => {
  const values = new Map();
  const kv = {
    async get(key) {
      return values.get(key) || null;
    },
    async put(key, value) {
      values.set(key, value);
    }
  };
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(TACO_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
  };

  try {
    const env = { MARKETS_KV: kv, MARKETS_DATA_READ_MODE: 'cache-first' };
    const request = (suffix = '') => marketsWorker.fetch(
      new Request(`https://test.freebacktrack.tech/api/markets/taco${suffix}`),
      env,
      {}
    );

    const first = await (await request()).json();
    const cached = await (await request()).json();
    const refreshed = await (await request('?refresh=1')).json();

    assert.equal(first.score, 81);
    assert.equal(first.cached, false);
    assert.equal(cached.cached, true);
    assert.equal(refreshed.cached, false);
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TACO endpoint ignores a cache payload from the wrong source', async () => {
  const values = new Map([[
    'taco:live',
    JSON.stringify({
      source: 'wrong-source',
      score: 99,
      generatedAt: '2026-07-28T12:00:00.000Z',
      factors: [{ key: 'brent', value: 1 }]
    })
  ]]);
  const kv = {
    async get(key) {
      return values.get(key) || null;
    },
    async put(key, value) {
      values.set(key, value);
    }
  };
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(TACO_HTML, { status: 200 });
  };

  try {
    const response = await marketsWorker.fetch(
      new Request('https://test.freebacktrack.tech/api/markets/taco'),
      { MARKETS_KV: kv, MARKETS_DATA_READ_MODE: 'cache-first' },
      {}
    );
    const payload = await response.json();
    assert.equal(payload.score, 81);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
