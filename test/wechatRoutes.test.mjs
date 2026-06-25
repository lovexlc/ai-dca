import { test } from 'node:test';
import assert from 'node:assert/strict';

import notifyWorker from '../workers/notify/src/index.js';
import { __test as wechatTest } from '../workers/notify/src/wechatRoutes.js';

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

test('wechat login exchanges code and returns signed bearer token', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /jscode2session/);
    assert.match(String(url), /js_code=code-123/);
    return new Response(JSON.stringify({
      openid: 'openid-1',
      unionid: 'unionid-1'
    }), { status: 200 });
  };

  try {
    const env = {
      NOTIFY_STATE: createMemoryKv(),
      WECHAT_APPID: 'appid',
      WECHAT_APP_SECRET: 'app-secret',
      WECHAT_SESSION_SECRET: 'session-secret'
    };
    const response = await notifyWorker.fetch(new Request('https://api.freebacktrack.tech/api/wechat/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'code-123' })
    }), env);
    const payload = await response.json();
    const session = await wechatTest.verifySessionToken(env, payload.token);

    assert.equal(response.status, 200);
    assert.equal(payload.openid, 'openid-1');
    assert.equal(payload.unionid, 'unionid-1');
    assert.equal(session.openid, 'openid-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('wechat notification prefs require token and store normalized fund codes', async () => {
  const env = {
    NOTIFY_STATE: createMemoryKv(),
    WECHAT_SESSION_SECRET: 'session-secret'
  };
  const signed = await wechatTest.signSessionToken(env, {
    openid: 'openid-2'
  });

  const response = await notifyWorker.fetch(new Request('https://api.freebacktrack.tech/api/wechat/notification-prefs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${signed.token}`
    },
    body: JSON.stringify({
      mode: 'aggressive',
      notifyEnabled: true,
      watchedCodes: ['sh513100', '513100', '159501', 'bad'],
      subscription: {
        templateId: 'tmpl-1',
        status: 'accept'
      }
    })
  }), env);

  const payload = await response.json();
  const stored = JSON.parse(await env.NOTIFY_STATE.get('wechat:user:openid-2:notification-prefs'));
  const activeUsers = JSON.parse(await env.NOTIFY_STATE.get('wechat:active-users'));

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(stored.openid, 'openid-2');
  assert.deepEqual(stored.watchedCodes, ['513100', '159501']);
  assert.deepEqual(activeUsers, ['openid-2']);
});
