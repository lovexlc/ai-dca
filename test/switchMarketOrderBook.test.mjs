import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchSwitchOrderBooks,
  parseSinaQuoteText,
  parseTencentQuoteText
} from '../workers/notify/src/switchMarketCollector.js';

function tencentPayload(code = '159632', { withBook = true } = {}) {
  const fields = Array(41).fill('');
  fields[0] = '51';
  fields[1] = 'ETF';
  fields[2] = code;
  fields[3] = '1.233';
  fields[30] = '20260917103352';
  for (let level = 1; level <= 5; level += 1) {
    const bidIndex = 9 + (level - 1) * 2;
    const askIndex = 19 + (level - 1) * 2;
    if (withBook) {
      fields[bidIndex] = (1.234 - level * 0.001).toFixed(3);
      fields[bidIndex + 1] = String(120000 - (level - 1) * 1000);
      fields[askIndex] = (1.233 + level * 0.001).toFixed(3);
      fields[askIndex + 1] = String(98000 - (level - 1) * 1000);
    }
  }
  return `v_sz${code}="${fields.join('~')}";`;
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
  return `var hq_str_sz${code}="${fields.join(',')}";`;
}

function textResponse(value, status = 200) {
  return new Response(new TextEncoder().encode(value), {
    status,
    headers: { 'content-type': 'text/plain' }
  });
}

test('Tencent quote parser returns five-level order book', () => {
  const parsed = parseTencentQuoteText(tencentPayload());
  const quote = parsed['159632'];
  assert.equal(quote.source, 'tencent');
  assert.equal(quote.orderBook.source, 'tencent');
  assert.equal(quote.orderBook.levels.length, 5);
  assert.equal(quote.orderBook.bidPrice, 1.233);
  assert.equal(quote.orderBook.bidVolume, 120000);
  assert.equal(quote.orderBook.askPrice, 1.234);
  assert.equal(quote.orderBook.askVolume, 98000);
  assert.equal(quote.orderBook.levels[4].bidPrice, 1.229);
  assert.equal(quote.orderBook.levels[4].askPrice, 1.238);
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

test('switch order book uses Tencent without calling Sina when Tencent has depth', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('qt.gtimg.cn')) return textResponse(tencentPayload('159632'));
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const result = await fetchSwitchOrderBooks(['159632']);
    assert.equal(result.successCount, 1);
    assert.equal(result.failureCount, 0);
    assert.equal(result.books['159632'].source, 'tencent');
    assert.equal(result.books['159632'].orderBook.bidPrice, 1.233);
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
    throw new Error(`unexpected fetch ${url}`);
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
