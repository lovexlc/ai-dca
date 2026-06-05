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
      clientLabel: 'Web console'
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
