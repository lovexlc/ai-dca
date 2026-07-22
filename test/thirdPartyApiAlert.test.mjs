import { test } from 'node:test';
import assert from 'node:assert/strict';

import marketsWorker from '../workers/markets/src/index.js';
import notifyWorker from '../workers/notify/src/index.js';
import {
  THIRD_PARTY_API_ERROR_KEY,
  markThirdPartyApiFailure,
  recordThirdPartyApiError,
  resetThirdPartyApiErrorStreak,
  runThirdPartyApiOperation
} from '../workers/markets/src/thirdPartyApiAlert.js';

function createEnv() {
  const store = new Map();
  return {
    MARKETS_ENV: 'test',
    MARKETS_ADMIN_NOTIFY_ENDPOINT: 'https://test.example/api/notify/admin/alert',
    MARKETS_ADMIN_NOTIFY_TOKEN: 'test-token',
    store,
    MARKETS_KV: {
      async get(key) {
        return store.get(key) || null;
      },
      async put(key, value) {
        store.set(key, value);
      },
      async delete(key) {
        store.delete(key);
      }
    }
  };
}

test('third-party alert triggers at the tenth failure and only once per streak', async () => {
  const env = createEnv();
  const originalFetch = globalThis.fetch;
  const notifications = [];
  const startMs = 1_750_000_000_000;
  globalThis.fetch = async (input, init) => {
    notifications.push({ url: String(input), init });
    return new Response('{}', { status: 200 });
  };

  try {
    for (let index = 1; index <= 9; index += 1) {
      const result = await recordThirdPartyApiError(env, {
        endpoint: '/quote/AAPL',
        error: new Error('upstream unavailable'),
        nowMs: startMs + index * 1000
      });
      assert.equal(result.alerted, false);
      assert.equal(result.count, index);
    }

    const thresholdResult = await recordThirdPartyApiError(env, {
      endpoint: '/quote/AAPL',
      error: new Error('upstream unavailable'),
      nowMs: startMs + 10_000
    });
    assert.equal(thresholdResult.alerted, true);
    assert.equal(thresholdResult.count, 10);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].init.headers['x-admin-token'], 'test-token');
    const notificationBody = JSON.parse(notifications[0].init.body);
    assert.equal(notificationBody.errorCount, 10);
    assert.equal(notificationBody.ruleId, 'third-party-api-error-burst');

    for (let index = 11; index <= 20; index += 1) {
      const continuedResult = await recordThirdPartyApiError(env, {
        endpoint: '/quote/AAPL',
        error: new Error('upstream unavailable'),
        nowMs: startMs + index * 1000
      });
      assert.equal(continuedResult.alerted, false);
      assert.equal(continuedResult.count, index);
    }
    assert.equal(notifications.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('successful request clears the streak and a five-minute gap starts a new streak', async () => {
  const env = createEnv();
  const startMs = 1_750_000_000_000;

  await recordThirdPartyApiError(env, { nowMs: startMs + 1000, error: 'failed' });
  await recordThirdPartyApiError(env, { nowMs: startMs + 2000, error: 'failed' });
  assert.equal(await resetThirdPartyApiErrorStreak(env), true);
  assert.equal(env.store.has(THIRD_PARTY_API_ERROR_KEY), false);

  const afterSuccess = await recordThirdPartyApiError(env, {
    nowMs: startMs + 301_000,
    error: 'failed'
  });
  assert.equal(afterSuccess.count, 1);
  assert.equal(JSON.parse(env.store.get(THIRD_PARTY_API_ERROR_KEY)).failures.length, 1);
});

test('worker records an upstream error and notifies after ten failed requests', async () => {
  const env = createEnv();
  const originalFetch = globalThis.fetch;
  const notifications = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === env.MARKETS_ADMIN_NOTIFY_ENDPOINT) {
      notifications.push({ url, init });
      return new Response('{}', { status: 200 });
    }
    return new Response('upstream unavailable', { status: 503 });
  };

  try {
    for (let index = 0; index < 10; index += 1) {
      const response = await marketsWorker.fetch(
        new Request('https://test.example/api/markets/quote/AAPL'),
        env,
        {}
      );
      assert.equal(response.status, 500);
    }
    assert.equal(notifications.length, 1);
    assert.equal(JSON.parse(notifications[0].init.body).errorCount, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('monitored successful operation clears a previous error streak', async () => {
  const env = createEnv();
  await recordThirdPartyApiError(env, { nowMs: 1_750_000_000_001, error: 'failed' });
  const response = await runThirdPartyApiOperation(env, {
    endpoint: '/quote/AAPL',
    operation: async () => new Response('{}', { status: 200 })
  });

  assert.equal(response.status, 200);
  assert.equal(env.store.has(THIRD_PARTY_API_ERROR_KEY), false);
});

test('a partial 200 response keeps the failure streak instead of clearing it', async () => {
  const env = createEnv();
  await recordThirdPartyApiError(env, { nowMs: Date.now(), error: 'failed' });
  const response = await runThirdPartyApiOperation(env, {
    endpoint: '/quotes',
    operation: async () => {
      markThirdPartyApiFailure(env, { source: 'markets quotes', error: 'one quote failed' });
      return new Response(JSON.stringify({ quotes: {} }), { status: 200 });
    }
  });

  assert.equal(response.status, 200);
  assert.equal(JSON.parse(env.store.get(THIRD_PARTY_API_ERROR_KEY)).count, 2);
});

test('test notify binding resolves lovexl and uses Android ServerChan3 only', async (t) => {
  const settings = {
    clients: {
      'web:other': {
        clientId: 'web:other',
        accountUsername: 'other',
        clientLabel: '其他账号',
        serverChan3: { uid: 'other-uid', sendKey: 'other-send-key' },
        payload: {},
        state: { recentEvents: [] }
      },
      'web:lovexl': {
        clientId: 'web:lovexl',
        accountUsername: 'lovexl',
        clientLabel: '控制台账号',
        serverChan3: { uid: 'lovexl-uid', sendKey: 'lovexl-send-key' },
        payload: {},
        state: { recentEvents: [] }
      }
    },
    gcmRegistrations: []
  };
  const store = new Map([['notify:settings', JSON.stringify(settings)]]);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return new Response('ok', { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await notifyWorker.fetch(
    new Request('https://notify.internal/internal/third-party-alert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '第三方 API 连续异常', body: 'test alert' })
    }),
    {
      NOTIFY_STATE: {
        async get(key) {
          return store.get(key) || null;
        },
        async put(key, value) {
          store.set(key, String(value));
        }
      },
      ADMIN_NOTIFY_USERNAME: 'lovexl'
    }
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/lovexl-uid\.push\.ft07\.com\/send\//);
});
