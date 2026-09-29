import test from 'node:test';
import assert from 'node:assert/strict';

import { computeNasdaqRadar, NASDAQ_ETFS } from '../src/nasdaqRadar.js';

const KV_LATEST = 'nasdaq-radar:latest';
const KV_HISTORY = 'nasdaq-radar:history';

// 与 nasdaqRadar.shanghaiDateStr 等价：北京时间日期 YYYY-MM-DD
function beijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function makeEnv(seed = {}) {
  const store = new Map();
  for (const [key, value] of Object.entries(seed)) store.set(key, JSON.stringify(value));
  return {
    NOTIFY_STATE: {
      async get(key, type) {
        const raw = store.get(key);
        if (raw === undefined) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key, value) { store.set(key, value); },
    },
    store,
  };
}

function readStoredJson(env, key) {
  const raw = env.store.get(key);
  return raw === undefined ? null : JSON.parse(raw);
}

function patchFetch(handler) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    return handler(input, init);
  };
  return {
    calls: () => calls,
    restore: () => { globalThis.fetch = originalFetch; },
  };
}

// fundmob FundMNFInfo 响应：[code, name, NEWPRICE, NAV, ZJL]
// ZJL 特意给一个与NAV口径不同的值，确保计算不回退到 vendor 溢价。
function fundmobResponse(rows) {
  return new Response(JSON.stringify({
    Success: true,
    Datas: rows.map(([code, name, price, nav, zjl]) => ({
      FCODE: code,
      SHORTNAME: name,
      NEWPRICE: String(price),
      NAV: String(nav),
      ZJL: String(zjl),
      HQDATE: '2026-09-28 15:00',
    })),
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const VALID_ROWS = [
  ['159513', '大成纳指ETF', 1.10, 1.00, -2.34],
  ['513100', '国泰纳指ETF', 0.99, 1.00, -0.56],
];

test('溢价采用NAV口径 (收盘价−净值)/净值×100，忽略 vendor ZJL', async () => {
  const env = makeEnv();
  const stub = patchFetch(() => fundmobResponse(VALID_ROWS));
  try {
    const result = await computeNasdaqRadar(env);
    assert.equal(stub.calls(), 1);
    assert.equal(result.premiumSource, 'eastmoney-fundmobapi-nav');
    // 159513: (1.10−1.00)/1.00×100 = 10%；513100: (0.99−1.00)/1.00×100 = −1%
    assert.deepEqual(result.etfs.map(e => e.premium), [10, -1]);
    assert.equal(result.etfs[0].code, '159513');
    assert.equal(result.bestPair.sell.code, '159513');
    assert.equal(result.bestPair.sell.premium, 10);
    assert.equal(result.bestPair.buy.code, '513100');
    assert.equal(result.bestPair.buy.premium, -1);
    assert.equal(result.bestPair.spread, 11);
  } finally {
    stub.restore();
  }
});

test('缺收盘价或缺净值的ETF被跳过，其余正常参与排名', async () => {
  const rows = [
    ['159513', '大成纳指ETF', 1.10, 1.00, -2.34],
    ['513100', '国泰纳指ETF', 0.99, 1.00, -0.56],
    ['159632', '无净值ETF', 1.05, '--', -1.00],   // NAV 缺失
    ['159660', '无价格ETF', '--', 1.02, -1.00],   // NEWPRICE 缺失
  ];
  const env = makeEnv();
  const stub = patchFetch(() => fundmobResponse(rows));
  try {
    const result = await computeNasdaqRadar(env);
    assert.deepEqual(result.etfs.map(e => e.code), ['159513', '513100']);
    const history = readStoredJson(env, KV_HISTORY);
    assert.equal(history.length, 1);
    assert.equal(history[0].high, '159513');
    assert.equal(history[0].low, '513100');
  } finally {
    stub.restore();
  }
});

test('有效ETF不足2只时抛错且不写KV', async () => {
  const env = makeEnv();
  const stub = patchFetch(() => fundmobResponse([VALID_ROWS[0]]));
  try {
    await assert.rejects(computeNasdaqRadar(env), /有效数据不足/);
    assert.equal(env.store.has(KV_LATEST), false);
    assert.equal(env.store.has(KV_HISTORY), false);
  } finally {
    stub.restore();
  }
});

test('幂等：history 末条为今天时直接返回 KV 现有 latest，不重新计算写入', async () => {
  const today = beijingToday();
  const existing = {
    date: today,
    computedAt: '2026-09-29T13:35:00.000Z',
    premiumSource: 'eastmoney-fundmobapi-nav',
    bestPair: { spread: 9.99 },
    marker: 'existing-result',
  };
  const env = makeEnv({
    [KV_LATEST]: existing,
    [KV_HISTORY]: [{ date: today, spread: 9.99, high: '159513', low: '513100' }],
  });
  const stub = patchFetch(() => {
    throw new Error('should not fetch when already computed');
  });
  try {
    const result = await computeNasdaqRadar(env);
    assert.equal(result.marker, 'existing-result');
    assert.equal(result.bestPair.spread, 9.99);
    assert.equal(stub.calls(), 0, '幂等命中时不应发起行情请求');
    assert.equal(readStoredJson(env, KV_LATEST).marker, 'existing-result');
  } finally {
    stub.restore();
  }
});

test('history 末条非今天时不命中幂等，正常重算', async () => {
  const yesterday = '2000-01-01';
  const env = makeEnv({
    [KV_LATEST]: { date: yesterday, marker: 'stale' },
    [KV_HISTORY]: [{ date: yesterday, spread: 1, high: '159513', low: '513100' }],
  });
  const stub = patchFetch(() => fundmobResponse(VALID_ROWS));
  try {
    const result = await computeNasdaqRadar(env);
    assert.equal(result.marker, undefined);
    assert.equal(stub.calls(), 1);
  } finally {
    stub.restore();
  }
});

test('历史保留近20条：写入当天后截断最旧一条，分位数按 ≤当日价差计数', async () => {
  const today = beijingToday();
  const history = [];
  for (let i = 1; i <= 20; i++) {
    history.push({ date: `2026-08-${String(i).padStart(2, '0')}`, spread: i, high: '159513', low: '513100' });
  }
  const env = makeEnv({ [KV_HISTORY]: history });
  const stub = patchFetch(() => fundmobResponse(VALID_ROWS));
  try {
    const result = await computeNasdaqRadar(env);
    // 当日 spread=11，历史 1..20 中 ≤11 的有 11 条 → 11/20×100 = 55
    assert.equal(result.bestPair.spread, 11);
    assert.equal(result.bestPair.percentile, 55);
    assert.equal(result.bestPair.historyDays, 20);
    const stored = readStoredJson(env, KV_HISTORY);
    assert.equal(stored.length, 20, 'history 截断到近20条');
    assert.equal(stored[0].date, '2026-08-02', '最旧一条被挤掉');
    assert.equal(stored[stored.length - 1].date, today);
    assert.equal(stored[stored.length - 1].spread, 11);
    assert.equal(readStoredJson(env, KV_LATEST).date, today);
    // recentOpportunities 为最近5天倒序，最新一条是今天
    assert.equal(result.recentOpportunities.length, 5);
    assert.equal(result.recentOpportunities[0].date, today);
  } finally {
    stub.restore();
  }
});

test('NASDAQ_ETFS 为12只纳指100ETF', () => {
  assert.equal(NASDAQ_ETFS.length, 12);
  assert.deepEqual(NASDAQ_ETFS.map(e => e.code), [
    '159513', '159941', '513100', '159696', '159632', '513390',
    '513300', '159501', '513870', '159660', '513110', '159659',
  ]);
});
