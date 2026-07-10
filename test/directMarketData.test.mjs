import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchDirectKline,
  normalizeDirectSymbol,
  parseEastmoneyKlinePayload,
  parseTencentQuoteText,
  parseTencentSearchText
} from '../src/app/directMarketData.js';

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

test('Tencent smartbox normalizes OTC jj records to six-digit fund codes', () => {
  const rows = parseTencentSearchText('v_hint="jj~539001~u5efau4fe1u7eb3u6307u6570u636eu5e7fu573a"');

  assert.equal(rows[0].symbol, '539001');
  assert.equal(rows[0].code, '539001');
  assert.equal(rows[0].exchange, '场外基金');
  assert.equal(rows[0].fundKind, 'otc');
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
    globalThis.fetch = originalFetch;
  }
});
