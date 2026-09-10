import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleStatusSummary } from '../workers/notify/src/notifyStatusRoutes.js';
import { promoteVerifiedEmailToAccount } from '../workers/notify/src/emailRoutes.js';
import { mergeConcurrentClientState } from '../workers/notify/src/notifyStorage.js';

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

function accountHeaders() {
  return {
    'x-notify-verified-user-id': 'usr-test',
    'x-notify-verified-username': 'test-user'
  };
}

test('promoteVerifiedEmailToAccount migrates a verified device email to the account client', () => {
  const nextSettings = promoteVerifiedEmailToAccount({
    clients: {
      'account:usr-test': {
        clientId: 'account:usr-test',
        ownerUserId: 'usr-test',
        accountUsername: 'test-user',
        email: {}
      },
      'web:old-device': {
        clientId: 'web:old-device',
        ownerUserId: 'usr-test',
        accountUsername: 'test-user',
        email: {
          address: 'test@example.com',
          verified: true,
          verifiedAt: '2026-09-10T05:00:00.000Z',
          enabled: true
        }
      }
    }
  }, 'account:usr-test', { userId: 'usr-test', username: 'test-user' });

  assert.deepEqual(nextSettings.clients['account:usr-test'].email, {
    address: 'test@example.com',
    verified: true,
    verifiedAt: '2026-09-10T05:00:00.000Z',
    enabled: true
  });
});

test('mergeConcurrentClientState does not let a stale device snapshot erase account email', () => {
  const merged = mergeConcurrentClientState({
    clients: {
      'account:usr-test': {
        clientId: 'account:usr-test',
        ownerUserId: 'usr-test',
        email: {
          address: 'test@example.com',
          verified: true,
          verifiedAt: '2026-09-10T05:00:00.000Z',
          enabled: true
        }
      }
    }
  }, {
    clients: {
      'account:usr-test': {
        clientId: 'account:usr-test',
        ownerUserId: 'usr-test',
        email: {}
      }
    }
  }, { preserveStaleChannels: true });

  assert.deepEqual(merged.clients['account:usr-test'].email, {
    address: 'test@example.com',
    verified: true,
    verifiedAt: '2026-09-10T05:00:00.000Z',
    enabled: true
  });
});

test('status summary returns the canonical envelope and migrates legacy email binding', async () => {
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify({
        clients: {
          'account:usr-test': {
            clientId: 'account:usr-test',
            ownerUserId: 'usr-test',
            accountUsername: 'test-user',
            email: {}
          },
          'web:old-device': {
            clientId: 'web:old-device',
            ownerUserId: 'usr-test',
            accountUsername: 'test-user',
            email: {
              address: 'test@example.com',
              verified: true,
              verifiedAt: '2026-09-10T05:00:00.000Z',
              enabled: true
            }
          }
        },
        gcmRegistrations: []
      })
    })
  };
  const request = new Request('https://tools.freebacktrack.tech/api/notify/status?view=summary', {
    headers: accountHeaders()
  });

  const response = await handleStatusSummary(request, env);
  const payload = await response.json();
  const stored = JSON.parse(await env.NOTIFY_STATE.get('notify:settings'));

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.configured, undefined);
  assert.equal(payload.data.channels.email.configured, true);
  assert.equal(payload.data.channels.email.verified, true);
  assert.equal(payload.data.account.accountClientId, 'account:usr-test');
  assert.equal(payload.data.rules.totalRuleCount, 0);
  assert.equal(payload.data.timestamps.lastSyncedAt, null);
  assert.deepEqual(stored.clients['account:usr-test'].email, {
    address: 'test@example.com',
    verified: true,
    verifiedAt: '2026-09-10T05:00:00.000Z',
    enabled: true
  });
});
