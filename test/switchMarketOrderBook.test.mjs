import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchSwitchCollectorSnapshot,
  fetchSwitchOrderBooks,
  parseFundMobApiReferences,
  parseSinaQuoteText,
  parseTencentQuoteText
} from '../workers/notify/src/switchMarketCollector.js';

function currentShanghaiDigits() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function currentShanghaiText() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function currentEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function tencentPayload(code = '159632', { withBook = true } = {}) {
  const fields = Array(41).fill('');
  fields[0] = '51';
  fields[1] = 'ETF';
  fields[2] = code;
  fields[3] = '2.600';
  fields[30] = currentShanghaiDigits();
  for (let level = 1; level <= 5; level += 1) {
    const bidIndex = 9 + (level - 1) * 2;
    const askIndex = 19 + (level - 1) * 2;
    if (withBook) {
      fields[bidIndex] = (2.601 - level * 0.001).toFixed(3);
      fields[bidIndex + 1] = String(120000 - (level - 1) * 1000);
      fields[askIndex] = (2.600 + level * 0.001).toFixed(3);
      fields[askIndex + 1] = String(98000 - (level - 1) * 1000);
    }
  }
  return 'v_' + (code.startsWith('5') || code.startsWith('6') ? 'sh' : 'sz') + code + '="' + fields.join('~') + '";';
}

function sinaPayload(code = '159659') {
  const fields = Array(33).fill('');
  fields[0] = 'ETF';
  fields[3] = '1.102';
  fields[30] = '2026-09-17';
  fields[31] = '10:33:54';
  for (let level = 1; level <= 5; level += 1) {
    const bidVolumeIndex = 10 + (level - 1) * 2;
    const askVolumeIndex = 20 + (level - 1) * 2;
    fields[bidVolumeIndex] = String(76000 - (level - 1) * 1000);
    fields[bidVolumeIndex + 1] = (1.102 - (level - 1) * 0.001).toFixed(3);
    fields[askVolumeIndex] = String(88000 - (level - 1) * 1000);
    fields[askVolumeIndex + 1] = (1.103 + (level - 1) * 0.001).toFixed(3);
  }
  return 'var hq_str_sz' + code + '="' + fields.join(',') + '";';
}

function textResponse(value, status = 200) {
  return new Response(new TextEncoder().encode(value), {
    status,
    headers: { 'content-type': 'text/plain' }
  });
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function fundMobItem(code, { price = '2.600', zjl = '-9.59', nav = '2.450', asOf = currentShanghaiText() } = {}) {
  return {
    FCODE: code,
    SHORTNAME: '测试基金' + code,
    NEWPRICE: price,
    NAV: nav,
    ZJL: zjl,
    HQDATE: asOf
  };
}

function eastmoneyItem(code, { discount = -3.5, iopv = null } = {}) {
  return {
    f12: code,
    f14: 'fallback基金' + code,
    f2: '2.600',
    f3: '0.5',
    f124: currentEpochSeconds(),
    f402: discount,
    f441: iopv
  };
}

test('Tencent quote parser returns five-level order book', () => {
  const parsed = parseTencentQuoteText(tencentPayload());
  const quote = parsed['159632'];
  assert.equal(quote.source, 'tencent');
  assert.equal(quote.orderBook.source, 'tencent');
  assert.equal(quote.orderBook.levels.length, 5);
  assert.equal(quote.orderBook.bidPrice, 2.6);
  assert.equal(quote.orderBook.bidVolume, 120000);
  assert.equal(quote.orderBook.askPrice, 2.601);
  assert.equal(quote.orderBook.askVolume, 98000);
  assert.equal(quote.orderBook.levels[4].bidPrice, 2.596);
  assert.equal(quote.orderBook.levels[4].askPrice, 2.605);
});

test('Sina quote parser returns five-level order book', () => {
  const parsed = parseSinaQuoteText(sinaPayload());
  const quote = parsed['159659'];
  assert.equal(quote.source, 'sina');
  assert.equal(quote.orderBook.source, 'sina');
  assert.equal(quote.orderBook.levels.length, 5);
  assert.equal(quote.orderBook.bidPrice, 1.102);
  assert.equal(quote.orderBook.bidVolume, 76000);
  assert.equal(quote.orderBook.askPrice, 1.103);
  assert.equal(quote.orderBook.askVolume, 88000);
});

test('fundmobapi parser inverts ZJL and derives IOPV from NEWPRICE', () => {
  const parsed = parseFundMobApiReferences({
    Success: true,
    Datas: [fundMobItem('513300', { price: '2.5632', zjl: '-9.59', nav: '2.4088' })]
  });
  const item = parsed['513300'];
  assert.equal(item.price, 2.5632);
  assert.equal(item.latestNav, 2.4088);
  assert.equal(item.vendorPremiumPct, 9.59);
  assert.equal(item.premiumSource, 'eastmoney-fundmobapi-zjl');
  assert.ok(Math.abs(item.iopv - (2.5632 / 1.0959)) < 0.0001);
  assert.match(item.asOf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
});

test('fundmobapi is primary for switch snapshot and avoids push2 when ZJL is present', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('qt.gtimg.cn')) return textResponse(tencentPayload('513300'));
    if (url.includes('FundMNewApi/FundMNFInfo')) {
      const parsedUrl = new URL(url);
      assert.equal(parsedUrl.searchParams.get('Fcodes'), '513300');
      return jsonResponse({ Success: true, Datas: [fundMobItem('513300')] });
    }
    throw new Error('unexpected fetch ' + url);
  };
  try {
    const result = await fetchSwitchCollectorSnapshot({}, ['513300']);
    const item = result.funds['513300'];
    assert.equal(result.successCount, 1);
    assert.equal(item.price, 2.6);
    assert.equal(item.premiumPct, 9.59);
    assert.equal(item.premiumSource, 'eastmoney-fundmobapi-zjl');
    assert.equal(item.valid, true);
    assert.equal(calls.filter((url) => url.includes('FundMNewApi/FundMNFInfo')).length, 1);
    assert.equal(calls.some((url) => url.includes('ulist.np/get')), false);
    assert.equal(calls.some((url) => url.includes('clist/get')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fundmobapi gaps fall through ulist and clist without failing the whole snapshot', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('qt.gtimg.cn')) return textResponse(tencentPayload('161125'));
    if (url.includes('FundMNewApi/FundMNFInfo')) {
      return jsonResponse({ Success: true, Datas: [fundMobItem('161125', { price: '--', zjl: '--' })] });
    }
    if (url.includes('ulist.np/get')) return jsonResponse({ data: { diff: [] } });
    if (url.includes('clist/get')) return jsonResponse({ data: { total: 1, diff: [eastmoneyItem('161125')] } });
    throw new Error('unexpected fetch ' + url);
  };
  try {
    const result = await fetchSwitchCollectorSnapshot({}, ['161125']);
    const item = result.funds['161125'];
    assert.equal(item.premiumPct, 3.5);
    assert.equal(item.premiumSource, 'eastmoney-vendor-premium');
    assert.equal(item.valid, true);
    assert.equal(calls.some((url) => url.includes('ulist.np/get')), true);
    assert.equal(calls.some((url) => url.includes('clist/get')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a push2 502 for an uncovered LOF does not discard fundmobapi ETF premium', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('qt.gtimg.cn')) {
      const code = new URL(url).searchParams.get('q').split(',')[0].slice(2);
      return textResponse(tencentPayload(code));
    }
    if (url.includes('FundMNewApi/FundMNFInfo')) {
      return jsonResponse({
        Success: true,
        Datas: [
          fundMobItem('513300'),
          fundMobItem('161125', { price: '--', zjl: '--' })
        ]
      });
    }
    if (url.includes('ulist.np/get')) return jsonResponse({}, 502);
    if (url.includes('clist/get')) return jsonResponse({}, 502);
    throw new Error('unexpected fetch ' + url);
  };
  try {
    const result = await fetchSwitchCollectorSnapshot({}, ['513300', '161125']);
    assert.equal(result.funds['513300'].premiumPct, 9.59);
    assert.equal(result.funds['513300'].valid, true);
    assert.equal(result.funds['161125'].valid, false);
    assert.ok(result.failureCount >= 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('switch order book uses Tencent without calling Sina when Tencent has depth', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('qt.gtimg.cn')) return textResponse(tencentPayload('159632'));
    throw new Error('unexpected fetch ' + url);
  };
  try {
    const result = await fetchSwitchOrderBooks(['159632']);
    assert.equal(result.successCount, 1);
    assert.equal(result.failureCount, 0);
    assert.equal(result.books['159632'].source, 'tencent');
    assert.equal(result.books['159632'].orderBook.bidPrice, 2.6);
    assert.equal(calls.filter((url) => url.includes('hq.sinajs.cn')).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('switch order book falls back to Sina only for symbols missing Tencent depth', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('qt.gtimg.cn')) return textResponse(tencentPayload('159659', { withBook: false }));
    if (url.includes('hq.sinajs.cn')) return textResponse(sinaPayload('159659'));
    throw new Error('unexpected fetch ' + url);
  };
  try {
    const result = await fetchSwitchOrderBooks(['159659']);
    assert.equal(result.successCount, 1);
    assert.equal(result.failureCount, 0);
    assert.equal(result.books['159659'].source, 'sina');
    assert.equal(result.books['159659'].orderBook.askPrice, 1.103);
    assert.equal(calls.filter((url) => url.includes('qt.gtimg.cn')).length, 1);
    assert.equal(calls.filter((url) => url.includes('hq.sinajs.cn')).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
