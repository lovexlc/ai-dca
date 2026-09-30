import { test } from 'node:test';
import assert from 'node:assert/strict';

import marketsWorker from '../workers/markets/src/index.js';
import { isAuthorizedMarketsAdminRequest } from '../workers/markets/src/marketRuntime.js';

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

test('removed xueqiu endpoint returns 404', async () => {
  const response = await marketsWorker.fetch(
    new Request('https://api.test/api/markets/xueqiu-fund-data/513100?raw=1'),
    {},
    { waitUntil() {} }
  );
  const body = await jsonOf(response);

  assert.equal(response.status, 404);
  assert.ok(body.error);
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
