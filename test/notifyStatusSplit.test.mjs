import { test } from 'node:test';
import assert from 'node:assert/strict';

import notifyWorker from '../workers/notify/src/index.js';
import { buildAccountClientId } from '../workers/notify/src/clientSettings.js';

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

function createSyncDb(userId, username) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return { userId, username };
            }
          };
        }
      };
    }
  };
}

async function createEnv() {
  const userId = 'usr-status';
  const username = 'status-user';
  const accountClientId = buildAccountClientId(userId);
  const deviceClientId = 'web:status-client';
  const settings = {
    clients: {
      [accountClientId]: {
        clientId: accountClientId,
        clientLabel: 'Status account',
        accountUsername: username,
        ownerUserId: userId,
        accountClientId,
        notifyGroupId: accountClientId,
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
            [`serverchan3-client:${accountClientId}`]: {
              count: 1,
              lastFailedAt: '2026-09-08T03:00:00.000Z'
            }
          }
        }
      },
      [deviceClientId]: {
        clientId: deviceClientId,
        clientLabel: 'Status browser',
        accountUsername: username,
        ownerUserId: userId,
        accountClientId,
        isDeviceOnly: true,
        notifyGroupId: accountClientId
      }
    },
    gcmRegistrations: [{
      id: `web-ws:${deviceClientId}`,
      deviceInstallationId: `web-ws:${deviceClientId}`,
      deviceName: 'Status browser',
      token: 'masked-in-storage',
      isWebClient: true,
      capabilities: ['notify', 'market'],
      createdAt: '2026-09-09T03:00:00.000Z',
      updatedAt: '2026-09-09T03:00:00.000Z',
      pairedClients: [{
        clientId: deviceClientId,
        groupId: accountClientId,
        clientName: 'Status browser',
        pairedAt: '2026-09-09T03:00:00.000Z',
        lastSeenAt: '2026-09-09T03:00:00.000Z'
      }]
    }]
  };

  return {
    accountClientId,
    deviceClientId,
    env: {
      NOTIFY_STATE: createMemoryKv({
        'notify:settings': JSON.stringify(settings)
      }),
      SYNC_DB: createSyncDb(userId, username)
    }
  };
}

async function requestStatus(path, env) {
  const url = new URL(path, 'http://notify.test');
  return notifyWorker.fetch(new Request(url, {
    headers: {
      authorization: 'Bearer status-token'
    }
  }), env);
}

test('notify status returns a compact account summary without large detail arrays', async () => {
  const { env } = await createEnv();
  const response = await requestStatus('/api/notify/status', env);
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

test('notify status details returns account diagnostic and websocket data', async () => {
  const { accountClientId, deviceClientId, env } = await createEnv();
  const response = await requestStatus('/api/notify/status?view=details', env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.eventCount, 1);
  assert.equal(payload.lastEvent.id, 'event-1');
  assert.equal(payload.deliveryFailureCount, 1);
  assert.equal(payload.deliveryFailures.length, 1);
  assert.equal(payload.setup.webWsRegistrations.length, 1);
  assert.equal(payload.setup.webWsCurrentClientRegistrations.length, 1);
  assert.equal(payload.accountClientId, accountClientId);
  assert.deepEqual(payload.setup.notifyGroupMemberClientIds.sort(), [accountClientId, deviceClientId].sort());
});
