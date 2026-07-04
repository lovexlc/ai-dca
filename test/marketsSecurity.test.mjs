import { test } from 'node:test';
import assert from 'node:assert/strict';

import marketsWorker from '../workers/markets/src/index.js';
import { isAuthorizedMarketsAdminRequest } from '../workers/markets/src/marketRuntime.js';
import { sanitizeXueqiuPublicPayload } from '../workers/markets/src/fetchers.js';

function jsonOf(response) {
  return response.json();
}

test('markets admin authorization requires bearer token match', () => {
  const env = { MARKETS_ADMIN_TOKEN: 'secret-token' };

  assert.equal(isAuthorizedMarketsAdminRequest(new Request('https://api.test'), env), false);
  assert.equal(isAuthorizedMarketsAdminRequest(new Request('https://api.test', {
    headers: { authorization: 'Bearer wrong-token' }
  }), env), false);
  assert.equal(isAuthorizedMarketsAdminRequest(new Request('https://api.test', {
    headers: { authorization: 'Bearer secret-token' }
  }), env), true);
});

test('xueqiu raw payload endpoint is admin-only', async () => {
  const response = await marketsWorker.fetch(
    new Request('https://api.test/api/markets/xueqiu-fund-data/513100?raw=1'),
    { XUEQIU_COOKIE: 'xq_a_token=fake', MARKETS_ADMIN_TOKEN: 'secret-token' },
    { waitUntil() {} }
  );
  const body = await jsonOf(response);

  assert.equal(response.status, 401);
  assert.equal(body.error, 'admin authorization required');
});

test('manual refresh endpoint is admin-only before doing work', async () => {
  const response = await marketsWorker.fetch(
    new Request('https://api.test/api/markets/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'cn-indices' })
    }),
    { MARKETS_ADMIN_TOKEN: 'secret-token' },
    { waitUntil() {} }
  );
  const body = await jsonOf(response);

  assert.equal(response.status, 401);
  assert.equal(body.error, 'admin authorization required');
});

test('kline batch endpoint is admin-only before scheduling background work', async () => {
  let scheduled = false;
  const response = await marketsWorker.fetch(
    new Request('https://api.test/api/markets/kline-batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ market: 'cn' })
    }),
    { MARKETS_ADMIN_TOKEN: 'secret-token' },
    { waitUntil() { scheduled = true; } }
  );
  const body = await jsonOf(response);

  assert.equal(response.status, 401);
  assert.equal(body.error, 'admin authorization required');
  assert.equal(scheduled, false);
});

test('xueqiu public payload exposes whitelisted data instead of raw response', () => {
  const data = sanitizeXueqiuPublicPayload('quote_detail', {
    data: {
      quote: {
        symbol: 'SH513100',
        name: '纳指ETF',
        current: 2.3,
        high: 2.4,
        secretField: 'do-not-return'
      }
    }
  });

  assert.deepEqual(data, {
    quote: {
      symbol: 'SH513100',
      name: '纳指ETF',
      current: 2.3,
      high: 2.4
    }
  });
});
