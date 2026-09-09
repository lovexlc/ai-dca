import { test } from 'node:test';
import assert from 'node:assert/strict';

import notifyWorker from '../workers/notify/src/index.js';
import { hashText } from '../workers/notify/src/clientSettings.js';

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

async function createEnv() {
  const clientId = 'web:status-client';
  const clientSecret = 'status-secret';
  const settings = {
    clients: {
      [clientId]: {
        clientId,
        clientLabel: 'Status client',
        clientSecretHash: await hashText(clientSecret),
        notifyGroupId: clientId,
        barkDeviceKey: '',
        serverChan3: { uid: '18912', sendKey: 'saved-secret' },
        state: {
          recentEvents: [{
            id: 'event-1',
            title: 'test',
            status: 'delivered',
            createdAt: '2026-09-09T03:00:00.000Z'
          }],
          deliveryFailures: {
            'serverchan3-client:web:status-client': {
              count: 1,
              lastFailedAt: '2026-09-08T03:00:00.000Z'
            }
          }
        }
      }
    },
    gcmRegistrations: [{
      id: `web-ws:${clientId}`,
      deviceInstallationId: `web-ws:${clientId}`,
      deviceName: 'Status client',
      token: 'masked-in-storage',
      isWebClient: true,
      capabilities: ['notify', 'market'],
      createdAt: '2026-09-09T03:00:00.000Z',
      updatedAt: '2026-09-09T03:00:00.000Z',
      pairedClients: [{
        clientId,
        groupId: clientId,
        clientName: 'Status client',
        pairedAt: '2026-09-09T03:00:00.000Z',
        lastSeenAt: '2026-09-09T03:00:00.000Z'
      }]
    }]
  };

  return {
    clientId,
    clientSecret,
    env: {
      NOTIFY_STATE: createMemoryKv({
        'notify:settings': JSON.stringify(settings)
      })
    }
  };
}

async function requestStatus(path, clientId, clientSecret, env) {
  const url = new URL(path, 'http://notify.test');
  url.searchParams.set('clientId', clientId);
  return notifyWorker.fetch(new Request(url, {
    headers: {
      'x-notify-client-secret': clientSecret
    }
  }), env);
}

test('notify status returns a compact summary without large detail arrays', async () => {
  const { clientId, clientSecret, env } = await createEnv();
  const response = await requestStatus('/api/notify/status', clientId, clientSecret, env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.configured.serverChan3, true);
  assert.equal(payload.setup.serverChan3.configured, true);
  assert.equal(payload.setup.webWsRegistrationCount, 1);
  assert.equal(payload.setup.webWsCurrentClientRegistrationCount, 1);
  assert.equal('webWsRegistrations' in payload.setup, false);
  assert.equal('webWsCurrentClientRegistrations' in payload.setup, false);
  assert.equal('notifyGroupMemberClientIds' in payload.setup, false);
  assert.equal('lastEvent' in payload, false);
  assert.equal('deliveryFailures' in payload, false);
});

test('notify status details returns the split diagnostic and websocket data', async () => {
  const { clientId, clientSecret, env } = await createEnv();
  const response = await requestStatus('/api/notify/status?view=details', clientId, clientSecret, env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.eventCount, 1);
  assert.equal(payload.lastEvent.id, 'event-1');
  assert.equal(payload.deliveryFailureCount, 1);
  assert.equal(payload.deliveryFailures.length, 1);
  assert.equal(payload.setup.webWsRegistrations.length, 1);
  assert.equal(payload.setup.webWsCurrentClientRegistrations.length, 1);
  assert.deepEqual(payload.setup.notifyGroupMemberClientIds, [clientId]);
});
