import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchXueqiuQuotesBatch } from '../workers/markets/src/fetchers.js';

test('xueqiu batch quotes skip order book requests by default', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(JSON.stringify({
      data: {
        quote: {
          symbol: 'SH513500',
          code: '513500',
          name: '标普500ETF博时',
          current: 2.5,
          last_close: 2.48,
          unit_nav: 2.4,
          premium_rate: 3.8,
          timestamp: Date.UTC(2026, 6, 7, 3, 0, 0)
        }
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const quotes = await fetchXueqiuQuotesBatch(['sh513500'], { cookie: 'xq_a_token=test' });
    assert.equal(quotes.sh513500.price, 2.5);
    assert.equal(quotes.sh513500.premiumPercent, 3.8);
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /\/v5\/stock\/quote\.json/);
    assert.doesNotMatch(requestedUrls.join('\n'), /pankou/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
