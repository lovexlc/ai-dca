import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deliverNotification } from '../workers/notify/src/deliveryEngine.js';

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
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response('ok', { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await deliverNotification(buildEnv(), buildNotification(), {
    targetChannels: ['bark']
  });

  assert.equal(result.status, 'delivered');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/api\.day\.app\//);
  assert.deepEqual(result.results.map((item) => item.channel), ['bark']);
});

test('deliverNotification: graylist blocks non-lovexl accounts without network calls', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response('ok', { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const env = buildEnv();
  env.__notifySettings.accountUsername = 'someone-else';

  const result = await deliverNotification(env, buildNotification(), {
    targetChannels: ['bark', 'serverchan3']
  });

  assert.equal(result.status, 'skipped');
  assert.equal(calls.length, 0);
  assert.deepEqual(result.results.map((item) => `${item.channel}:${item.status}`), ['graylist:skipped']);
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
