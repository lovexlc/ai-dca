import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getFundMetricsForNotify,
  getKlineForNotify,
  getQuotesForNotify
} from '../workers/notify/src/marketsClient.js';

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

test('notify markets client centralizes service binding request construction', async () => {
  const requests = [];
  const env = {
    MARKETS: {
      async fetch(request) {
        requests.push(request);
        if (request.method === 'POST') return jsonResponse({ items: [] });
        return jsonResponse({ quotes: {}, candles: [] });
      }
    }
  };

  await getFundMetricsForNotify(env, ['000834'], { refresh: true, fundKinds: { '000834': 'otc' } });
  await getQuotesForNotify(env, ['AAPL']);
  await getKlineForNotify(env, '513100', { timeframe: '1d', includeR2: true });

  assert.equal(requests.length, 3);
  assert.equal(new URL(requests[0].url).pathname, '/api/markets/fund-metrics');
  assert.equal(JSON.parse(await requests[0].clone().text()).refresh, true);
  assert.equal(new URL(requests[1].url).pathname, '/api/markets/quotes');
  assert.equal(new URL(requests[2].url).pathname, '/api/markets/kline/513100');
  assert.equal(new URL(requests[2].url).searchParams.get('includeR2'), '1');
});
