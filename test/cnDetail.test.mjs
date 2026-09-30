import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCnDetail } from '../workers/markets/src/cnDetailRoutes.js';
import worker from '../workers/markets/src/index.js';
import { shouldFetchCnDetail } from '../src/pages/markets/marketDetailDataPolicy.js';

function fixture() {
  const fields = Array(69).fill('');
  Object.assign(fields, { 0: '51', 1: 'ETF', 2: '159632', 3: '2', 4: '1.9', 5: '1.95', 6: '123', 31: '0.1', 32: '5.26', 33: '2.1', 34: '1.8', 45: '100', 67: '3', 68: '1' });
  for (let i = 0; i < 5; i++) {
    fields[9 + i * 2] = String(1.99 - i * .01); fields[10 + i * 2] = String(100 + i);
    fields[19 + i * 2] = String(2.01 + i * .01); fields[20 + i * 2] = String(200 + i);
  }
  return `v_sz159632="${fields.join('~')}";`;
}

async function withSources(run, { failExtras = false } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input); calls.push(url);
    assert.equal(init?.headers?.cookie, undefined);
    if (url.hostname === 'qt.gtimg.cn') return new Response(fixture());
    if (url.pathname === '/api/qt/stock/get') {
      assert.equal(url.searchParams.get('secid'), '0.159632');
      if (failExtras) return new Response('', { status: 503 });
      return Response.json({ data: { f62: 100, f184: 2, f66: 30, f69: 70, f72: -40, f75: -60, f78: .6, f81: 1.4, f84: -.8, f87: -1.2 } });
    }
    if (url.hostname === 'quotes.sina.cn') {
      assert.equal(url.searchParams.get('datalen'), '10');
      if (failExtras) return Response.json(null);
      return Response.json(Array.from({ length: 10 }, (_, i) => ({ day: `2026-09-${10 + i}`, open: 2, high: 2, low: 2, close: 2, volume: (i + 1) * 100 })));
    }
    if (url.hostname === 'push2delay.eastmoney.com') return Response.json({ data: { diff: [{ f12: '159632', f441: 1.98, f402: -1 }] } });
    if (url.hostname === 'fundmobapi.eastmoney.com') return Response.json({ Datas: [{ FCODE: '159632', NAV: 1.97, HQDATE: '2026-09-29' }] });
    throw new Error('Unexpected URL ' + url);
  };
  try { await run(calls); } finally { globalThis.fetch = original; }
}

function kv(initial = null) {
  const values = new Map(initial ? [['cn-detail:159632', JSON.stringify(initial)]] : []);
  const writes = [];
  return { writes, MARKETS_KV: {
    get: async (key) => values.get(key) || null,
    put: async (key, value, opts) => { writes.push({ key, opts }); values.set(key, value); }
  } };
}

test('GET cn-detail returns quote, five levels, flow, premium and ten-day volume with 5-minute KV cache', async () => {
  await withSources(async (calls) => {
    const env = kv();
    const response = await worker.fetch(new Request('https://markets.test/cn-detail/159632'), env, {});
    assert.equal(response.status, 200);
    const item = await response.json();
    for (const key of ['code', 'symbol', 'name', 'market', 'price', 'open', 'high', 'low', 'previousClose', 'volume', 'marketCapital', 'high52w', 'low52w', 'avgVolume', 'change', 'changePercent', 'premiumPercent', 'premiumSource', 'premiumEngine', 'iopv', 'latestNav', 'latestNavDate', 'vendorPremiumPercent', 'orderBook', 'capitalFlow', 'finance', 'source', 'cached']) assert.ok(Object.hasOwn(item, key), key);
    assert.equal(item.code, '159632'); assert.equal(item.symbol, 'sz159632');
    assert.equal(item.source, 'cn-detail'); assert.equal(item.cached, false);
    assert.equal(item.orderBook.source, 'tencent-pankou'); assert.equal(item.orderBook.levels.length, 5);
    assert.equal(item.orderBook.levels[4].bidVolume, 104);
    assert.equal(item.capitalFlow.mainNetInflow, 100); assert.equal(item.capitalFlow.smallPct, -1.2);
    assert.equal(item.avgVolume, 550); assert.equal(item.finance, null);
    assert.equal(item.premiumEngine, 'collector'); assert.equal(item.premiumSource, 'iopv');
    assert.deepEqual(env.writes[0], { key: 'cn-detail:159632', opts: { expirationTtl: 300 } });
    const count = calls.length;
    assert.equal((await (await handleCnDetail(env, 'sz159632')).json()).cached, true);
    assert.equal(calls.length, count);
    assert.equal((await (await handleCnDetail(env, '159632', new URLSearchParams('refresh=1'))).json()).cached, false);
    assert.ok(calls.length > count);
  });
});

test('optional source failures return null while retaining quote and order book', async () => {
  await withSources(async () => {
    const item = await (await handleCnDetail({}, '159632')).json();
    assert.equal(item.capitalFlow, null); assert.equal(item.avgVolume, null);
    assert.equal(item.finance, null); assert.equal(item.orderBook.levels.length, 5);
  }, { failExtras: true });
});

test('stale, wrong-source and wrong-code cached objects fetch live and use normalized write key', async () => {
  for (const overrides of [ { generatedAt: new Date(Date.now() - 301000).toISOString() }, { source: 'wrong' }, { code: '513100' } ]) {
    await withSources(async (calls) => {
      const env = kv({ code: '159632', symbol: 'sz159632', price: 2, source: 'cn-detail', generatedAt: new Date().toISOString(), capitalFlow: null, finance: null, orderBook: null, ...overrides });
      const item = await (await handleCnDetail(env, '159632')).json();
      assert.equal(item.cached, false); assert.ok(calls.length); assert.equal(env.writes[0].key, 'cn-detail:159632');
    });
  }
});

test('invalid symbols and unavailable financial report tab never fetch detail sources', async () => {
  assert.equal((await handleCnDetail({}, 'AAPL')).status, 400);
  assert.equal(shouldFetchCnDetail({ market: 'cn', symbol: '159632', activeTab: 'fundReport' }), false);
  assert.equal(shouldFetchCnDetail({ market: 'cn', symbol: '159632', activeTab: 'overview' }), true);
  assert.equal(shouldFetchCnDetail({ market: 'cn', symbol: '159632', activeTab: 'fundFlow' }), true);
  assert.equal(shouldFetchCnDetail({ market: 'cn', symbol: '159632', activeTab: 'overview', isOtcList: true }), false);
});


test('Shanghai funds use 1.xxxxxx secid, including bare 50-prefix codes', async () => {
  const original = globalThis.fetch;
  const secids = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/api/qt/stock/get') secids.push(url.searchParams.get('secid'));
    return new Response('', { status: 500 });
  };
  try {
    for (const code of ['513100', '501312', 'sh000001']) {
      assert.equal((await handleCnDetail({}, code)).status, 502);
    }
    assert.deepEqual(secids, ['1.513100', '1.501312', '1.000001']);
  } finally { globalThis.fetch = original; }
});
