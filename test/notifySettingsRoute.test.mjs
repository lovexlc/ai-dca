import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleSettings } from '../workers/notify/src/notifyClientRoutes.js';
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
