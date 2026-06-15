/* global Request */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import notifyWorker from '../workers/notify/src/index.js';
import {
  enforceClientAndIpRateLimit,
  isValidAdminToken,
  requireAdminToken
} from '../workers/notify/src/security.js';

function createMemoryKv(seed = {}) {
  const memory = new Map(Object.entries(seed));
  return {
    async get(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    async put(key, value) {
      memory.set(key, String(value));
    }
  };
}

test('admin token rejects when no server-side secret is configured', async () => {
  const request = new Request('https://tools.freebacktrack.tech/api/notify/admin/alert', {
    method: 'POST',
    headers: {
      'x-admin-token': 'anything'
    }
  });

  const response = requireAdminToken(request, {}, { origin: 'https://tools.freebacktrack.tech' });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'admin_auth_not_configured' });
});

test('admin token accepts bearer and x-admin-token headers', () => {
  const bearerRequest = new Request('https://tools.freebacktrack.tech/api/notify/admin/alert', {
    headers: {
      authorization: 'Bearer secret-admin-token'
    }
  });
  const headerRequest = new Request('https://tools.freebacktrack.tech/api/notify/admin/alert', {
    headers: {
      'x-admin-token': 'secret-admin-token'
    }
  });

  assert.equal(isValidAdminToken(bearerRequest, { ADMIN_TOKEN: 'secret-admin-token' }), true);
  assert.equal(isValidAdminToken(bearerRequest, { NOTIFY_ADMIN_TOKEN: 'secret-admin-token' }), true);
  assert.equal(isValidAdminToken(headerRequest, { ADMIN_TOKEN: 'secret-admin-token' }), true);
  assert.equal(isValidAdminToken(headerRequest, { ADMIN_TOKEN: 'different' }), false);
});

test('client and IP rate limit blocks repeated non-admin requests', async () => {
  const env = { NOTIFY_STATE: createMemoryKv() };
  const request = new Request('https://tools.freebacktrack.tech/api/notify/quant/premium/strategies/default/backtest', {
    method: 'POST',
    headers: {
      'cf-connecting-ip': '203.0.113.8'
    }
  });

  const first = await enforceClientAndIpRateLimit(request, env, {
    scope: 'test-backtest',
    clientId: 'web:test-client',
    clientLimit: 2,
    clientWindowSeconds: 3600,
    ipLimit: 10,
    ipWindowSeconds: 3600
  });
  const second = await enforceClientAndIpRateLimit(request, env, {
    scope: 'test-backtest',
    clientId: 'web:test-client',
    clientLimit: 2,
    clientWindowSeconds: 3600,
    ipLimit: 10,
    ipWindowSeconds: 3600
  });
  const third = await enforceClientAndIpRateLimit(request, env, {
    scope: 'test-backtest',
    clientId: 'web:test-client',
    clientLimit: 2,
    clientWindowSeconds: 3600,
    ipLimit: 10,
    ipWindowSeconds: 3600
  });

  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(third.status, 429);
  assert.equal((await third.json()).error, 'rate_limited');
});

test('admin token bypasses usage rate limits', async () => {
  const env = {
    ADMIN_TOKEN: 'secret-admin-token',
    NOTIFY_STATE: createMemoryKv()
  };
  const request = new Request('https://tools.freebacktrack.tech/api/notify/quant/premium/strategies/default/backtest', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-admin-token',
      'cf-connecting-ip': '203.0.113.9'
    }
  });

  const result = await enforceClientAndIpRateLimit(request, env, {
    scope: 'test-admin-bypass',
    clientId: 'web:test-client',
    clientLimit: 0,
    ipLimit: 0
  });

  assert.equal(result, null);
});

test('full manual notify run requires admin auth when no clientId is scoped', async () => {
  const response = await notifyWorker.fetch(new Request('https://tools.freebacktrack.tech/api/notify/run', {
    method: 'POST'
  }), {
    NOTIFY_STATE: createMemoryKv()
  });

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'admin_auth_not_configured');
});
