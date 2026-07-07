import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deliverNotification } from '../workers/notify/src/deliveryEngine.js';
import { sendBarkNotification } from '../workers/notify/src/channels/bark.js';
import { runNotificationCycle } from '../workers/notify/src/evaluator.js';

function buildEnv() {
  return {
    __notifyCurrentClientId: 'web:client-1',
    __notifySettings: {
      barkDeviceKey: 'bark-device-key',
      serverChan3: {
        uid: 'uid-test',
        sendKey: 'send-key-test'
      },
      clientLabel: 'Web console',
      accountUsername: 'lovexl'
    }
  };
}

function buildNotification() {
  return {
    eventId: 'target-channel-test',
    eventType: 'notify-channel-test',
    title: '消息推送测试',
    body: '用于检查配置是否正确'
  };
}

function buildWsEnv({ capabilities = ['notify', 'market'], delivered = 1 } = {}) {
  let publishCalls = 0;
  return {
    env: {
      __notifyCurrentClientId: 'web:client-1',
      __notifySettings: {
        clientLabel: 'Web console',
        accountUsername: 'lovexl',
        gcmRegistrations: [{
          id: 'web-ws:web:client-1',
          deviceInstallationId: 'web-ws:web:client-1',
          deviceName: 'Current browser',
          token: 'ws-token',
          isWebClient: true,
          capabilities,
          pairedClients: [{ clientId: 'web:client-1', groupId: 'web:client-1' }]
        }]
      },
      WS_HUB: {
        idFromName(name) {
          return name;
        },
        get() {
          return {
            async fetch() {
              publishCalls += 1;
              return new Response(JSON.stringify({ delivered, failed: 0, total: delivered }), {
                headers: { 'content-type': 'application/json' }
              });
            }
          };
        }
      }
    },
    getPublishCalls() {
      return publishCalls;
    }
  };
}

test('deliverNotification: targetChannels bark only skips ServerChan3 and PC', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ code: 200, message: 'success' }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await deliverNotification(buildEnv(), buildNotification(), {
    targetChannels: ['bark']
  });

  assert.equal(result.status, 'delivered');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.day.app/push');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(result.results.map((item) => item.channel), ['bark']);
});

test('sendBarkNotification: extracts device key from full Bark URL before posting', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ code: 200, message: 'success' }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await sendBarkNotification({
    deviceKey: 'https://api.day.app/device-key-1/old-title/old-body',
    title: '测试标题',
    body: '测试内容',
    url: 'https://example.com/detail'
  });
  const postedPayload = JSON.parse(calls[0].init.body);

  assert.equal(result.status, 'delivered');
  assert.equal(calls[0].url, 'https://api.day.app/push');
  assert.equal(postedPayload.device_key, 'device-key-1');
  assert.equal(postedPayload.title, '测试标题');
  assert.equal(postedPayload.body, '测试内容');
  assert.equal(postedPayload.url, 'https://example.com/detail');
});

test('sendBarkNotification: treats Bark JSON code failures as failed delivery', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: 400,
    message: 'failed to get device token: failed to get [bad-key] device token from database'
  }), { status: 200 });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => sendBarkNotification({ deviceKey: 'bad-key', title: '测试标题', body: '测试内容' }),
    /Device Key 不存在或未在 Bark 服务端注册/
  );
});

test('sendBarkNotification: surfaces Bark HTTP failure message', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: 400,
    message: 'invalid request'
  }), { status: 400 });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => sendBarkNotification({ deviceKey: 'bad-key', title: '测试标题', body: '测试内容' }),
    /Bark 推送失败：invalid request/
  );
});

test('deliverNotification: non-lovexl accounts can deliver notifications', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ code: 200, message: 'success' }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const env = buildEnv();
  env.__notifySettings.accountUsername = 'someone-else';

  const result = await deliverNotification(env, buildNotification(), {
    targetChannels: ['bark', 'serverchan3']
  });

  assert.equal(result.status, 'delivered');
  assert.equal(calls.length, 2);
  assert.deepEqual(result.results.map((item) => `${item.channel}:${item.status}`), ['bark:delivered', 'serverchan3:delivered']);
});

test('deliverNotification: targetChannels serverchan3 only skips Bark and PC', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response('ok', { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await deliverNotification(buildEnv(), buildNotification(), {
    targetChannels: ['serverchan3']
  });

  assert.equal(result.status, 'delivered');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/uid-test\.push\.ft07\.com\/send\//);
  assert.deepEqual(result.results.map((item) => item.channel), ['serverchan3']);
});

test('deliverNotification: market-only websocket registration is not used for PC notifications', async () => {
  const { env, getPublishCalls } = buildWsEnv({ capabilities: ['market'] });

  const result = await deliverNotification(env, buildNotification(), {
    targetChannels: ['pc']
  });

  assert.equal(getPublishCalls(), 0);
  assert.equal(result.status, 'delivered');
  assert.deepEqual(result.results.map((item) => `${item.channel}:${item.status}`), ['pc:queued']);
});

test('deliverNotification: notify-capable websocket registration receives PC notifications', async () => {
  const { env, getPublishCalls } = buildWsEnv({ capabilities: ['notify', 'market'] });

  const result = await deliverNotification(env, buildNotification(), {
    targetChannels: ['pc']
  });

  assert.equal(getPublishCalls(), 1);
  assert.equal(result.status, 'delivered');
  assert.deepEqual(result.results.map((item) => `${item.channel}:${item.status}`), ['ws:delivered', 'ws:delivered']);
});

test('runNotificationCycle: counts queued PC test notification as delivered', async () => {
  const result = await runNotificationCycle(buildEnv(), {}, {}, {
    reason: 'manual-test',
    testPayload: buildNotification(),
    targetChannels: ['pc']
  });

  assert.equal(result.summary.deliveredCount, 1);
  assert.equal(result.summary.events[0].status, 'delivered');
  assert.deepEqual(result.summary.events[0].channels.map((item) => `${item.channel}:${item.status}`), ['pc:queued']);
});
