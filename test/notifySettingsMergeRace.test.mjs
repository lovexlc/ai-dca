import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeConcurrentClientState,
  writeSettings
} from '../workers/notify/src/notifyStorage.js';

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

const accountClientId = 'account:usr_alice';

function accountSettings(serverChan3) {
  return {
    clients: {
      [accountClientId]: {
        clientId: accountClientId,
        ownerUserId: 'usr_alice',
        accountUsername: 'alice',
        isDeviceOnly: false,
        serverChan3,
        state: {
          recentEvents: [],
          deliveryFailures: {},
          deliveryAcks: {},
          lastRunAt: ''
        }
      }
    }
  };
}

test('writeSettings preserves a configured channel from a stale account snapshot', async () => {
  const currentSettings = accountSettings({ uid: '18912', sendKey: 'saved-secret' });
  const staleSettings = accountSettings({ uid: '', sendKey: '' });
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify(currentSettings)
    })
  };

  await writeSettings(env, staleSettings);

  const stored = JSON.parse(await env.NOTIFY_STATE.get('notify:settings'));
  assert.deepEqual(stored.clients[accountClientId].serverChan3, {
    uid: '18912',
    sendKey: 'saved-secret'
  });
});

test('mergeConcurrentClientState can still honor an explicit channel clear', () => {
  const merged = mergeConcurrentClientState(
    accountSettings({ uid: '18912', sendKey: 'saved-secret' }),
    accountSettings({ uid: '', sendKey: '' }),
    { preserveStaleChannels: false }
  );

  assert.deepEqual(merged.clients[accountClientId].serverChan3, {
    uid: '',
    sendKey: ''
  });
});

test('writeSettings preserves the current Bark key when a stale snapshot is empty', async () => {
  const currentSettings = {
    clients: {
      [accountClientId]: {
        clientId: accountClientId,
        barkDeviceKey: 'bark-saved',
        serverChan3: { uid: '', sendKey: '' }
      }
    }
  };
  const staleSettings = {
    clients: {
      [accountClientId]: {
        clientId: accountClientId,
        barkDeviceKey: '',
        serverChan3: { uid: '', sendKey: '' }
      }
    }
  };
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify(currentSettings)
    })
  };

  await writeSettings(env, staleSettings);

  const stored = JSON.parse(await env.NOTIFY_STATE.get('notify:settings'));
  assert.equal(stored.clients[accountClientId].barkDeviceKey, 'bark-saved');
});
