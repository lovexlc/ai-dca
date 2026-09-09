import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleEmailSave } from '../workers/notify/src/emailRoutes.js';

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
    }
  };
}

test('saving a newly verified email replaces the previous account binding', async () => {
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify({
        clients: {
          'account:user-1': {
            clientId: 'account:user-1',
            clientLabel: '账号通知 · snow',
            accountUsername: 'snow',
            ownerUserId: 'user-1',
            accountClientId: 'account:user-1',
            isDeviceOnly: false,
            notifyGroupId: 'account:user-1',
            email: {
              address: 'old@example.com',
              verified: true,
              verifiedAt: '2026-09-09T06:00:00.000Z',
              enabled: true
            }
          }
        }
      }),
      'email-verification:user-1': JSON.stringify({
        email: 'new@example.com',
        verifiedAt: '2026-09-09T07:00:00.000Z',
        expiresAt: '2099-09-09T07:00:00.000Z'
      })
    })
  };
  const request = new Request('http://notify.test/api/notify/email/save', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-notify-verified-user-id': 'user-1',
      'x-notify-verified-username': 'snow'
    },
    body: JSON.stringify({ email: 'new@example.com' })
  });

  const response = await handleEmailSave(request, env);
  const payload = await response.json();
  const settings = JSON.parse(await env.NOTIFY_STATE.get('notify:settings'));
  const accountEmail = settings.clients['account:user-1'].email;

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(accountEmail.address, 'new@example.com');
  assert.equal(accountEmail.verified, true);
  assert.equal(accountEmail.enabled, true);
  assert.notEqual(accountEmail.address, 'old@example.com');
  assert.equal(await env.NOTIFY_STATE.get('email-verification:user-1'), null);
});
