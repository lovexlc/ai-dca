import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isXueqiuHalted,
  normalizeXueqiuTradeStatus,
  fetchXueqiuQuote,
} from '../workers/markets/src/fetchers.js';

test('normalizeXueqiuTradeStatus reads numeric and string status', () => {
  assert.equal(normalizeXueqiuTradeStatus({ status: 1 }), 1);
  assert.equal(normalizeXueqiuTradeStatus({ status: '3' }), 3);
  assert.equal(normalizeXueqiuTradeStatus({ market_status: 0 }), 0);
  assert.equal(normalizeXueqiuTradeStatus({}), null);
});

test('isXueqiuHalted treats status 1 as trading and others as halted', () => {
  assert.equal(isXueqiuHalted({ status: 1 }), false);
  assert.equal(isXueqiuHalted({ status: 0 }), true);
  assert.equal(isXueqiuHalted({ status: 2 }), true);
  assert.equal(isXueqiuHalted({ status: 3 }), true);
  assert.equal(isXueqiuHalted({}), false);
});

test('fetchXueqiuQuote exposes tradeStatus and isHalted from xueqiu status', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      quote: {
        symbol: 'SH600145',
        code: '600145',
        name: '退市新亿',
        current: 0.34,
        last_close: 0.34,
        status: 3,
        timestamp: Date.UTC(2026, 6, 22, 3, 0, 0)
      }
    }
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const quote = await fetchXueqiuQuote('600145', { cookie: 'xq_a_token=test', includeOrderBook: false });
    assert.equal(quote.tradeStatus, 3);
    assert.equal(quote.isHalted, true);
    assert.equal(quote.marketState, 'CLOSED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchXueqiuQuote marks status 1 as not halted', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      quote: {
        symbol: 'SH513050',
        code: '513050',
        name: '中概互联网ETF易方达',
        current: 1.1,
        last_close: 1.13,
        status: 1,
        premium_rate: 12.5,
        timestamp: Date.UTC(2026, 6, 22, 3, 0, 0)
      }
    }
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const quote = await fetchXueqiuQuote('513050', { cookie: 'xq_a_token=test', includeOrderBook: false });
    assert.equal(quote.tradeStatus, 1);
    assert.equal(quote.isHalted, false);
    assert.equal(quote.marketState, 'REGULAR');
    assert.equal(quote.premiumPercent, 12.5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
