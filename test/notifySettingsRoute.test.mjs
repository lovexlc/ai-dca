import { test } from 'node:test';
import assert from 'node:assert/strict';

import notifyWorker from '../workers/notify/src/index.js';
import { handleSettings } from '../workers/notify/src/notifyClientRoutes.js';
import {
  ensureAuthenticatedClient,
  hashText,
  NotifyClientError
} from '../workers/notify/src/clientSettings.js';
import { buildPublicGcmSetup } from '../workers/notify/src/gcmPresentation.js';

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

test('handleSettings: returns public ServerChan3 setup without leaking SendKey', async () => {
  const clientSecret = 'secret-1';
  const clientSecretHash = await hashText(clientSecret);
  const storedSettings = {
    clients: {
      'web:client-1': {
        clientId: 'web:client-1',
        clientLabel: 'Web console',
        clientSecretHash,
        barkDeviceKey: '',
        serverChan3: {
          uid: 'uid-123',
          sendKey: 'sendkey-secret-1234'
        }
      }
    }
  };
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify(storedSettings)
    })
  };
  const request = new Request('https://tools.freebacktrack.tech/api/notify/settings?clientId=web%3Aclient-1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-notify-client-secret': clientSecret
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
      'x-notify-client-secret': 'secret-alerts'
    },
    body: JSON.stringify({
      clientId: 'web:alerts',
      clientSecret: 'secret-alerts',
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
  const exchangeAlerts = JSON.parse(await env.NOTIFY_STATE.get('notify:market-alerts:web:alerts:exchange'));
  const otcAlerts = JSON.parse(await env.NOTIFY_STATE.get('notify:market-alerts:web:alerts:otc'));

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(exchangeAlerts.map((alert) => alert.symbol), ['159509']);
  assert.deepEqual(otcAlerts.map((alert) => alert.symbol), ['021000']);
});
