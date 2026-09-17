import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deliverNotification } from '../workers/notify/src/deliveryEngine.js';
import { sendBarkNotification } from '../workers/notify/src/channels/bark.js';
import { runNotificationCycle } from '../workers/notify/src/evaluator.js';

function buildEnv() {
  return {
    __notifyCurrentClientId: 'web:client-1',
    EMAIL_FROM: 'notify@freebacktrack.tech',
    EMAIL_FROM_NAME: '美股策略助手',
    EMAIL: {
      async send() {
        return { messageId: 'test-email-message' };
      }
    },
    __notifySettings: {
      barkDeviceKey: 'bark-device-key',
      serverChan3: {
        uid: 'uid-test',
        sendKey: 'send-key-test'
      },
      email: {
        address: 'user@example.com',
        verified: true,
        verifiedAt: '2026-09-09T00:00:00.000Z',
        enabled: true
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

function buildEmailQuotaDb() {
  const rows = [];
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...input) { values = input; return this; },
        async all() { return { results: [] }; },
        async first() {
          if (!sql.includes('FROM notify_email_daily_quota')) return null;
          const [owner, date, eventId] = values;
          return rows.find((row) => row.owner === owner && row.date === date && row.eventId === eventId) || null;
        },
        async run() {
          if (sql.startsWith('WITH slots(slot)')) {
            const [owner, date, eventId] = values;
            if (rows.some((row) => row.owner === owner && row.date === date && row.eventId === eventId)) return { meta: { changes: 0 } };
            const used = new Set(rows.filter((row) => row.owner === owner && row.date === date).map((row) => row.slot));
            const slot = [1, 2, 3, 4, 5].find((candidate) => !used.has(candidate));
            if (!slot) return { meta: { changes: 0 } };
            rows.push({ owner, date, eventId, slot, status: 'reserved' });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE notify_email_daily_quota')) {
            const [, owner, date, eventId] = values;
            const row = rows.find((item) => item.owner === owner && item.date === date && item.eventId === eventId);
            if (row) row.status = 'delivered';
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.startsWith('DELETE FROM notify_email_daily_quota') && sql.includes("status='reserved'") && values.length === 3) {
            const [owner, date] = values;
            for (let index = rows.length - 1; index >= 0; index -= 1) {
              if (rows[index].owner === owner && rows[index].date === date && rows[index].status === 'reserved') rows.splice(index, 1);
            }
          }
          if (sql.startsWith('DELETE FROM notify_email_daily_quota') && values.length === 3) {
            const [owner, date, eventId] = values;
            const index = rows.findIndex((row) => row.owner === owner && row.date === date && row.eventId === eventId && row.status === 'reserved');
            if (index >= 0) rows.splice(index, 1);
          }
          return { meta: { changes: 0 } };
        }
      };
    }
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

test('deliverNotification: targetChannels email only sends to the verified server-side email', async () => {
  const env = buildEnv();
  const sent = [];
  env.EMAIL = {
    async send(message) {
      sent.push(message);
      return { messageId: 'email-test-1' };
    }
  };

  const result = await deliverNotification(env, buildNotification(), {
    targetChannels: ['email']
  });

  assert.equal(result.status, 'delivered');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'user@example.com');
  assert.deepEqual(result.results.map((item) => `${item.channel}:${item.status}`), ['email:delivered']);
});

test('deliverNotification: targetChannels email skips an unverified server-side email', async () => {
  const env = buildEnv();
  env.__notifySettings.email = {
    address: 'user@example.com',
    verified: false,
    verifiedAt: '',
    enabled: false
  };
  let sendCount = 0;
  env.EMAIL = {
    async send() {
      sendCount += 1;
      return { messageId: 'unexpected' };
    }
  };

  const result = await deliverNotification(env, buildNotification(), {
    targetChannels: ['email']
  });

  assert.equal(result.status, 'skipped');
  assert.equal(sendCount, 0);
  assert.deepEqual(result.results.map((item) => `${item.channel}:${item.status}`), ['email:skipped']);
});

test('deliverNotification: email sends at most five times per account and marks the fifth email in red', async () => {
  const env = buildEnv();
  env.__notifySettings.ownerUserId = 'user-email-limit';
  env.SYNC_DB = buildEmailQuotaDb();
  const sent = [];
  env.EMAIL = {
    async send(message) {
      sent.push(message);
      return { messageId: `email-limit-${sent.length}` };
    }
  };

  const results = [];
  for (let index = 1; index <= 6; index += 1) {
    results.push(await deliverNotification(env, { ...buildNotification(), eventId: `email-limit-event-${index}` }, { targetChannels: ['email'] }));
  }

  assert.equal(sent.length, 5);
  assert.doesNotMatch(sent[3].html, /已达到邮件推荐限制/);
  assert.match(sent[4].html, /color:#dc2626[^>]*>已达到邮件推荐限制</);
  assert.match(sent[4].text, /已达到邮件推荐限制/);
  assert.deepEqual(results.map((result) => result.results[0].status), ['delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'skipped']);
  assert.match(results[5].results[0].detail, /每天 5 次/);
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
  assert.deepEqual(result.results.map((item) => `${item.channel}:${item.status}`), ['ws:delivered']);
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
