import { test } from 'node:test';
import assert from 'node:assert/strict';

import notifyWorker from '../workers/notify/src/index.js';
import { handleSettings, handleUnbind } from '../workers/notify/src/notifyClientRoutes.js';
import {
  ensureAuthenticatedClient,
  hashText,
  NotifyClientError,
  resolveNotifyAccountUsername
} from '../workers/notify/src/clientSettings.js';
import { buildPublicGcmSetup } from '../workers/notify/src/gcmPresentation.js';
import { accountSettingsKey, mergeConcurrentClientState, writeSettings } from '../workers/notify/src/notifyStorage.js';

function createMemoryKv(seed = {}) {
  const memory = new Map(Object.entries(seed));

  return {
    async get(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    async put(key, value) {
      memory.set(key, String(value));
    },
    async delete(key) {
      memory.delete(key);
    },
    async list({ prefix = '' } = {}) {
      return {
        keys: [...memory.keys()]
          .filter((key) => String(key).startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true
      };
    }
  };
}

test('scheduled switch crons run strategy scan and market push only in A-share windows', async () => {
  const switchCrons = [
    '30-59 1 * * MON-FRI',
    '* 2 * * MON-FRI',
    '0-30 3 * * MON-FRI',
    '* 5 * * MON-FRI',
    '* 6 * * MON-FRI',
    '0 7 * * MON-FRI'
  ];

  for (const cron of switchCrons) {
    const waited = [];
    let listCalls = 0;
    const kv = createMemoryKv({
      'notify:settings': JSON.stringify({ clients: {}, gcmRegistrations: [] })
    });
    kv.list = async () => {
      listCalls += 1;
      return { keys: [], list_complete: true };
    };

    await notifyWorker.scheduled({
      cron,
      scheduledTime: Date.parse('2026-07-07T02:00:00.000Z')
    }, {
      NOTIFY_STATE: kv
    }, {
      waitUntil(promise) {
        waited.push(Promise.resolve(promise));
      }
    });
    await Promise.all(waited);

    assert.equal(waited.length, 2);
    assert.equal(listCalls, 1);
  }
});

test('old broad switch cron no longer dispatches the switch scan', async () => {
  const waited = [];
  let listCalls = 0;
  const kv = createMemoryKv({
    'notify:settings': JSON.stringify({ clients: {}, gcmRegistrations: [] })
  });
  kv.list = async () => {
    listCalls += 1;
    return { keys: [], list_complete: true };
  };

  await notifyWorker.scheduled({
    cron: '* 1-7 * * MON-FRI',
    scheduledTime: Date.parse('2026-07-07T02:00:00.000Z')
  }, {
    NOTIFY_STATE: kv
  }, {
    waitUntil(promise) {
      waited.push(Promise.resolve(promise));
    }
  });
  await Promise.all(waited);

  assert.equal(waited.length, 2);
  assert.equal(listCalls, 0);
});

test('scheduled US market summary cron dispatches websocket summary push', async () => {
  const waited = [];
  const kv = createMemoryKv({
    'notify:settings': JSON.stringify({ clients: {}, gcmRegistrations: [] })
  });

  await notifyWorker.scheduled({
    cron: '* 13-21 * * MON-FRI',
    scheduledTime: Date.parse('2026-07-08T14:00:00.000Z')
  }, {
    NOTIFY_STATE: kv
  }, {
    waitUntil(promise) {
      waited.push(Promise.resolve(promise));
    }
  });
  await Promise.all(waited);

  assert.equal(waited.length, 1);
});

test('scheduled US market summary cron skips outside regular session', async () => {
  const waited = [];
  const kv = createMemoryKv({
    'notify:settings': JSON.stringify({ clients: {}, gcmRegistrations: [] })
  });

  await notifyWorker.scheduled({
    cron: '* 13-21 * * MON-FRI',
    scheduledTime: Date.parse('2026-07-08T13:00:00.000Z')
  }, {
    NOTIFY_STATE: kv
  }, {
    waitUntil(promise) {
      waited.push(Promise.resolve(promise));
    }
  });
  await Promise.all(waited);

  assert.equal(waited.length, 0);
});

test('writeSettings: preserves recent events written by a concurrent notify run', async () => {
  const clientId = 'web:client-1';
  const staleSyncSettings = {
    clients: {
      [clientId]: {
        clientId,
        clientLabel: 'Web console',
        state: {
          ruleStates: {},
          deliveryFailures: {},
          recentEvents: [],
          deliveryAcks: {},
          lastRunAt: '2026-07-03T03:20:00.000Z'
        }
      }
    }
  };
  const currentSettings = {
    clients: {
      [clientId]: {
        clientId,
        clientLabel: 'Web console',
        state: {
          ruleStates: {},
          deliveryFailures: {},
          recentEvents: [{
            id: 'switch:rule-1:159501:513100:RA:2026-07-03T03:25',
            eventType: 'switch-strategy-trigger',
            title: '切换 A 低→高 | 159501→513100',
            status: 'delivered',
            channels: [{ channel: 'pc', status: 'queued' }],
            createdAt: '2026-07-03T03:28:38.441Z',
            reason: 'switch-cron'
          }],
          deliveryAcks: {},
          lastRunAt: '2026-07-03T03:28:38.441Z'
        }
      }
    }
  };
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify(currentSettings)
    })
  };

  await writeSettings(env, staleSyncSettings);
  const stored = JSON.parse(await env.NOTIFY_STATE.get('notify:settings'));

  assert.equal(stored.clients[clientId].state.recentEvents.length, 1);
  assert.equal(stored.clients[clientId].state.recentEvents[0].eventType, 'switch-strategy-trigger');
  assert.equal(stored.clients[clientId].state.lastRunAt, '2026-07-03T03:28:38.441Z');
});

test('mergeConcurrentClientState: keeps incoming config while merging event state', () => {
  const clientId = 'web:client-1';
  const merged = mergeConcurrentClientState({
    clients: {
      [clientId]: {
        clientId,
        accountUsername: 'lovexl',
        state: {
          recentEvents: [{
            id: 'event-current',
            createdAt: '2026-07-03T03:28:38.441Z',
            status: 'delivered'
          }],
          deliveryFailures: {},
          deliveryAcks: {}
        }
      }
    }
  }, {
    clients: {
      [clientId]: {
        clientId,
        accountUsername: 'new-account',
        state: {
          recentEvents: [{
            id: 'event-incoming',
            createdAt: '2026-07-03T03:29:38.441Z',
            status: 'delivered'
          }],
          deliveryFailures: {},
          deliveryAcks: {}
        }
      }
    }
  });

  assert.equal(merged.clients[clientId].accountUsername, 'new-account');
  assert.equal(Object.prototype.hasOwnProperty.call(merged.clients[clientId], 'serverChan3'), false);
  assert.deepEqual(
    merged.clients[clientId].state.recentEvents.map((event) => event.id),
    ['event-incoming']
  );
});

test('handleSettings: returns public ServerChan3 setup without leaking SendKey', async () => {
  const clientSecret = 'secret-1';
  const clientSecretHash = await hashText(clientSecret);
  const storedSettings = {
    clients: {
      'web:client-1': {
        clientId: 'web:client-1',
        clientLabel: 'Web console',
        clientSecretHash,
        accountUsername: 'lovexl'
      }
    }
  };
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify(storedSettings),
      [accountSettingsKey('lovexl')]: JSON.stringify({
        username: 'lovexl',
        barkDeviceKey: '',
        serverChan3: {
          uid: 'uid-123',
          sendKey: 'sendkey-secret-1234'
        }
      })
    })
  };
  const request = new Request('https://tools.freebacktrack.tech/api/notify/settings?clientId=web%3Aclient-1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-notify-client-secret': clientSecret,
      'x-notify-account-username': 'lovexl'
    },
    body: JSON.stringify({
      clientLabel: 'Web console'
    })
  });

  const response = await handleSettings(request, env);
  const payload = await response.json();

  assert.equal(payload.ok, true);
  assert.deepEqual(payload.setup.serverChan3, {
    uid: 'uid-123',
    sendKeyMasked: 'sendke...1234',
    configured: true
  });
  assert.equal(JSON.stringify(payload).includes('sendkey-secret-1234'), false);
});

test('handleSettings: a new device reads account channels by username', async () => {
  const clientSecret = 'new-device-secret';
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify({
        clients: {
          'web:new-device': {
            clientId: 'web:new-device',
            clientLabel: 'New device',
            accountUsername: 'lovexl',
            clientSecretHash: await hashText(clientSecret)
          }
        }
      }),
      [accountSettingsKey('lovexl')]: JSON.stringify({
        username: 'lovexl',
        barkDeviceKey: 'account-bark-key',
        serverChan3: { uid: 'account-uid', sendKey: 'account-send-key' }
      })
    })
  };
  const response = await handleSettings(
    new Request('https://tools.freebacktrack.tech/api/notify/settings?clientId=web%3Anew-device', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-notify-client-secret': clientSecret,
        'x-notify-account-username': 'lovexl'
      },
      body: JSON.stringify({ clientLabel: 'New device' })
    }),
    env
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.setup.barkDeviceKey, 'account-bark-key');
  assert.equal(payload.setup.serverChan3.uid, 'account-uid');
  assert.equal(payload.setup.serverChan3.configured, true);
  assert.equal(JSON.stringify(payload).includes('account-send-key'), false);
});

test('ensureAuthenticatedClient: reports missing and invalid secrets as client errors', async () => {
  const clientSecretHash = await hashText('secret-ok');
  const settings = {
    clients: {
      'web:client-1': {
        clientId: 'web:client-1',
        clientSecretHash
      }
    }
  };

  await assert.rejects(
    () => ensureAuthenticatedClient(
      new Request('https://tools.freebacktrack.tech/api/notify/status?clientId=web%3Aclient-1'),
      settings
    ),
    (error) => error instanceof NotifyClientError
      && error.status === 401
      && /缺少浏览器鉴权信息/.test(error.message)
  );

  await assert.rejects(
    () => ensureAuthenticatedClient(
      new Request('https://tools.freebacktrack.tech/api/notify/status?clientId=web%3Aclient-1', {
        headers: { 'x-notify-client-secret': 'secret-bad' }
      }),
      settings
    ),
    (error) => error instanceof NotifyClientError
      && error.status === 401
      && /浏览器鉴权失败/.test(error.message)
  );
});

test('ensureAuthenticatedClient: bootstraps a new browser client with a secret hash', async () => {
  const auth = await ensureAuthenticatedClient(
    new Request('https://tools.freebacktrack.tech/api/notify/status?clientId=web%3Aclient-new', {
      headers: { 'x-notify-client-secret': 'secret-new' }
    }),
    { clients: {} }
  );

  assert.equal(auth.didUpdate, true);
  assert.equal(auth.clientId, 'web:client-new');
  assert.equal(auth.clientRecord.clientSecretHash, await hashText('secret-new'));
});

test('ensureAuthenticatedClient: stores normalized account username', async () => {
  const auth = await ensureAuthenticatedClient(
    new Request('https://tools.freebacktrack.tech/api/notify/status?clientId=web%3Alovexl', {
      headers: { 'x-notify-client-secret': 'secret-lovexl' }
    }),
    { clients: {} },
    {
      payload: {
        clientId: 'web:lovexl',
        accountUsername: ' LoveXL '
      }
    }
  );

  assert.equal(auth.didUpdate, true);
  assert.equal(auth.clientRecord.accountUsername, 'lovexl');
});

test('ensureAuthenticatedClient: accepts account username from request header', async () => {
  const auth = await ensureAuthenticatedClient(
    new Request('https://tools.freebacktrack.tech/api/notify/status?clientId=web%3Alovexl-header', {
      headers: {
        'x-notify-client-secret': 'secret-lovexl-header',
        'x-notify-account-username': 'LoveXL'
      }
    }),
    { clients: {} }
  );

  assert.equal(auth.didUpdate, true);
  assert.equal(auth.clientRecord.accountUsername, 'lovexl');
  assert.equal(auth.requestAccountUsername, 'lovexl');
});

test('notify account identity: uses request username or current clientId fallback', async () => {
  const loggedIn = await ensureAuthenticatedClient(
    new Request('https://tools.freebacktrack.tech/api/notify/status?clientId=web%3Ashared-device', {
      headers: {
        'x-notify-client-secret': 'secret-shared-device',
        'x-notify-account-username': 'LoveXL'
      }
    }),
    { clients: {} }
  );
  assert.equal(resolveNotifyAccountUsername(loggedIn), 'lovexl');

  const loggedOut = await ensureAuthenticatedClient(
    new Request('https://tools.freebacktrack.tech/api/notify/status?clientId=web%3Ashared-device', {
      headers: { 'x-notify-client-secret': 'secret-shared-device' }
    }),
    loggedIn.settings
  );
  assert.equal(loggedOut.clientRecord.accountUsername, '');
  assert.equal(loggedOut.requestAccountUsername, '');
  assert.equal(resolveNotifyAccountUsername(loggedOut), 'webshared-device');
});

test('handleUnbind: logout clears the device account binding and runtime state without deleting account config', async () => {
  const clientId = 'web:logout-device';
  const clientSecret = 'logout-secret';
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify({
        clients: {
          [clientId]: {
            clientId,
            clientLabel: 'Logout device',
            accountUsername: 'lovexl',
            clientSecretHash: await hashText(clientSecret),
            state: {
              ruleStates: { 'rule-1': { level: 2 } },
              deliveryFailures: { bark: { lastFailedAt: '2026-07-01T00:00:00.000Z' } },
              recentEvents: [{ id: 'old-event', createdAt: '2026-07-01T00:00:00.000Z' }],
              deliveryAcks: { 'old-event': { bark: 'delivered' } },
              lastRunAt: '2026-07-01T00:00:00.000Z'
            },
            meta: {
              counts: { totalRuleCount: 3 },
              lastSyncedAt: '2026-07-01T00:00:00.000Z'
            }
          }
        }
      }),
      [accountSettingsKey('lovexl')]: JSON.stringify({
        username: 'lovexl',
        barkDeviceKey: 'account-bark-key'
      }),
      'switch:config:lovexl': JSON.stringify({ enabled: true, rules: [{ id: 'rule-1' }] }),
      [`switch:snapshot:${clientId}`]: JSON.stringify({ computedAt: '2026-07-01T00:00:00.000Z' }),
      [`switch:run-result:${clientId}`]: JSON.stringify({ clientId, status: 'success' }),
      [`switch:run:${clientId}:run-1`]: JSON.stringify({ clientId, runId: 'run-1' }),
      [`switch:recommendation:${clientId}:rec-1`]: JSON.stringify({ clientId, recommendationId: 'rec-1' })
    })
  };

  const response = await handleUnbind(
    new Request(`https://tools.freebacktrack.tech/api/notify/unbind?clientId=${encodeURIComponent(clientId)}`, {
      method: 'POST',
      headers: {
        'x-notify-client-secret': clientSecret,
        // The endpoint must not use this value to decide which account to clear.
        'x-notify-account-username': 'lovexl'
      },
      body: JSON.stringify({ clientId })
    }),
    env
  );
  const payload = await response.json();
  const storedSettings = JSON.parse(await env.NOTIFY_STATE.get('notify:settings'));
  const detachedClient = storedSettings.clients[clientId];

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    ok: true,
    clientId,
    accountUsername: '',
    anonymousAccountUsername: 'weblogout-device'
  });
  assert.equal(detachedClient.accountUsername, '');
  assert.deepEqual(detachedClient.state, {
    ruleStates: {},
    deliveryFailures: {},
    recentEvents: [],
    deliveryAcks: {},
    lastRunAt: ''
  });
  assert.equal(detachedClient.meta.lastSyncedAt, '');
  assert.ok(await env.NOTIFY_STATE.get(accountSettingsKey('lovexl')));
  assert.ok(await env.NOTIFY_STATE.get('switch:config:lovexl'));
  assert.equal(await env.NOTIFY_STATE.get(`switch:snapshot:${clientId}`), null);
  assert.equal(await env.NOTIFY_STATE.get(`switch:run-result:${clientId}`), null);
  assert.equal(await env.NOTIFY_STATE.get(`switch:run:${clientId}:run-1`), null);
  assert.equal(await env.NOTIFY_STATE.get(`switch:recommendation:${clientId}:rec-1`), null);
});

test('handleSettings: unauthenticated request uses current clientId instead of stored account username', async () => {
  const clientSecret = 'anonymous-device-secret';
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify({
        clients: {
          'web:anonymous': {
            clientId: 'web:anonymous',
            accountUsername: 'lovexl',
            clientSecretHash: await hashText(clientSecret)
          }
        }
      }),
      [accountSettingsKey('lovexl')]: JSON.stringify({
        username: 'lovexl',
        barkDeviceKey: 'logged-in-account-key',
        serverChan3: { uid: 'logged-in-uid', sendKey: 'logged-in-send-key' }
      }),
      [accountSettingsKey('web:anonymous')]: JSON.stringify({
        username: 'webanonymous',
        barkDeviceKey: 'anonymous-account-key',
        serverChan3: { uid: 'anonymous-uid', sendKey: 'anonymous-send-key' }
      })
    })
  };
  const response = await handleSettings(
    new Request('https://tools.freebacktrack.tech/api/notify/settings?clientId=web%3Aanonymous', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-notify-client-secret': clientSecret
      },
      body: JSON.stringify({})
    }),
    env
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.setup.barkDeviceKey, 'anonymous-account-key');
  assert.equal(payload.setup.serverChan3.uid, 'anonymous-uid');
});

test('notify CORS preflight allows account username client header', async () => {
  const response = await notifyWorker.fetch(new Request('https://api.freebacktrack.tech/api/notify/switch/config', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://freebacktrack.tech',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type, x-notify-client-secret, x-notify-account-username'
    }
  }), { NOTIFY_STATE: createMemoryKv() });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://freebacktrack.tech');
  const allowHeaders = String(response.headers.get('access-control-allow-headers') || '').toLowerCase();
  assert.ok(allowHeaders.includes('x-notify-client-secret'));
  assert.ok(allowHeaders.includes('x-notify-account-username'));
});

test('buildPublicGcmSetup: returns current browser registrations plus a bounded recent sample', () => {
  const currentClientId = 'web:client-current';
  const staleRegistrations = Array.from({ length: 40 }, (_, index) => ({
    id: `web-ws:web:client-${index}`,
    deviceInstallationId: `web-ws:web:client-${index}`,
    deviceName: `Web ${index}`,
    token: `token-${index}`,
    isWebClient: true,
    createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    pairedClients: [{ clientId: `web:client-${index}`, groupId: `web:client-${index}` }]
  }));
  const settings = {
    clients: {
      [currentClientId]: {
        clientId: currentClientId,
        notifyGroupId: currentClientId
      }
    },
    gcmRegistrations: [
      ...staleRegistrations,
      {
        id: `web-ws:${currentClientId}`,
        deviceInstallationId: `web-ws:${currentClientId}`,
        deviceName: 'Current browser',
        token: 'token-current',
        isWebClient: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
        pairedClients: [{ clientId: currentClientId, groupId: currentClientId }]
      }
    ]
  };

  const setup = buildPublicGcmSetup(settings, {}, { clientId: currentClientId });

  assert.equal(setup.webWsRegistrationCount, 41);
  assert.equal(setup.webWsCurrentClientRegistrationCount, 1);
  assert.equal(setup.webWsRegistrations.length, 20);
  assert.equal(setup.webWsRegistrations[0].deviceInstallationId, `web-ws:${currentClientId}`);
  assert.deepEqual(setup.webWsRegistrations[0].capabilities, ['notify', 'market']);
});

test('notify ws register: bootstraps new web client and prunes old websocket registrations', async () => {
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify({
        clients: {},
        gcmRegistrations: Array.from({ length: 80 }, (_, index) => ({
          id: `web-ws:web:old-${index}`,
          deviceInstallationId: `web-ws:web:old-${index}`,
          deviceName: `Old ${index}`,
          token: `old-token-${index}`,
          isWebClient: true,
          createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
          updatedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
          pairedClients: [{ clientId: `web:old-${index}`, groupId: `web:old-${index}` }]
        }))
      })
    })
  };
  const response = await notifyWorker.fetch(new Request('https://tools.freebacktrack.tech/api/notify/ws/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientId: 'web:new-client',
      clientSecret: 'new-client-secret',
      clientLabel: 'New Client'
    })
  }), env);
  const payload = await response.json();
  const storedSettings = JSON.parse(await env.NOTIFY_STATE.get('notify:settings'));

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.deviceInstallationId, 'web-ws:web:new-client');
  assert.equal(storedSettings.clients['web:new-client'].clientLabel, 'New Client');
  assert.equal(storedSettings.gcmRegistrations.length, 64);
  const storedRegistration = storedSettings.gcmRegistrations.find((registration) => registration.deviceInstallationId === 'web-ws:web:new-client');
  assert.ok(storedRegistration);
  assert.deepEqual(storedRegistration.capabilities, ['notify', 'market']);
});

test('notify ws register: stores market-only capability for realtime market data', async () => {
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify({
        clients: {},
        gcmRegistrations: []
      })
    })
  };
  const response = await notifyWorker.fetch(new Request('https://tools.freebacktrack.tech/api/notify/ws/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientId: 'web:market-client',
      clientSecret: 'market-client-secret',
      clientLabel: 'Market Client',
      capabilities: ['market']
    })
  }), env);
  const payload = await response.json();
  const storedSettings = JSON.parse(await env.NOTIFY_STATE.get('notify:settings'));
  const storedRegistration = storedSettings.gcmRegistrations.find((registration) => registration.deviceInstallationId === 'web-ws:web:market-client');

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.ok(storedRegistration);
  assert.deepEqual(storedRegistration.capabilities, ['market']);
});

test('notify sync: stores exchange and otc market alerts in separate KV keys', async () => {
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify({
        clients: {},
        gcmRegistrations: []
      })
    })
  };

  const response = await notifyWorker.fetch(new Request('https://tools.freebacktrack.tech/api/notify/sync?clientId=web%3Aalerts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-notify-client-secret': 'secret-alerts',
      'x-notify-account-username': 'lovexl'
    },
    body: JSON.stringify({
      clientId: 'web:alerts',
      clientSecret: 'secret-alerts',
      accountUsername: 'lovexl',
      marketAlerts: [
        {
          id: 'market-alert:159509:premium-below',
          symbol: '159509',
          name: '纳指科技ETF景顺',
          alertType: 'premium-below',
          threshold: 15,
          fundKind: 'exchange',
          enabled: true
        },
        {
          id: 'market-alert:021000:gain',
          symbol: '021000',
          name: '南方纳指 I',
          alertType: 'gain',
          threshold: 3,
          fundKind: 'qdii',
          enabled: true
        }
      ]
    })
  }), env);

  const payload = await response.json();
  const exchangeAlerts = JSON.parse(await env.NOTIFY_STATE.get('notify:market-alerts:lovexl:exchange'));
  const otcAlerts = JSON.parse(await env.NOTIFY_STATE.get('notify:market-alerts:lovexl:otc'));

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(exchangeAlerts.map((alert) => alert.symbol), ['159509']);
  assert.deepEqual(otcAlerts.map((alert) => alert.symbol), ['021000']);
});
