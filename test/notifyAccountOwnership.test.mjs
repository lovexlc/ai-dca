import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  authenticateNotifyAccountRequest,
  NotifyAccountAuthError,
  VERIFIED_NOTIFY_USER_ID_HEADER,
  VERIFIED_NOTIFY_USERNAME_HEADER
} from '../workers/notify/src/notifyAccountAuth.js';
import {
  buildAccountClientId,
  ensureAuthenticatedClient,
  hashText,
  NotifyClientError
} from '../workers/notify/src/clientSettings.js';
import { prepareUniqueChannelSettings } from '../workers/notify/src/notifyClientRoutes.js';

function accountRequest(clientId, secret, userId = 'usr_alice', username = 'alice') {
  return new Request(`https://api.freebacktrack.tech/api/notify/status?clientId=${encodeURIComponent(clientId)}`, {
    headers: {
      'x-notify-client-secret': secret,
      [VERIFIED_NOTIFY_USER_ID_HEADER]: userId,
      [VERIFIED_NOTIFY_USERNAME_HEADER]: username
    }
  });
}

test('account auth requires a bearer token', async () => {
  await assert.rejects(
    () => authenticateNotifyAccountRequest(
      new Request('https://api.freebacktrack.tech/api/notify/settings'),
      { SYNC_DB: {} }
    ),
    (error) => error instanceof NotifyAccountAuthError
      && error.status === 401
      && error.code === 'AUTH_REQUIRED'
  );
});

test('two browser ids resolve to one account notification record', async () => {
  const firstSecretHash = await hashText('secret-one');
  const secondSecretHash = await hashText('secret-two');
  const settings = {
    clients: {
      'web:one': {
        clientId: 'web:one',
        accountUsername: 'alice',
        clientSecretHash: firstSecretHash,
        barkDeviceKey: 'bark-alice'
      },
      'web:two': {
        clientId: 'web:two',
        accountUsername: 'alice',
        clientSecretHash: secondSecretHash
      }
    }
  };

  const first = await ensureAuthenticatedClient(
    accountRequest('web:one', 'secret-one'),
    settings
  );
  const second = await ensureAuthenticatedClient(
    accountRequest('web:two', 'secret-two'),
    first.settings
  );
  const accountClientId = buildAccountClientId('usr_alice');

  assert.equal(first.clientId, accountClientId);
  assert.equal(second.clientId, accountClientId);
  assert.equal(second.clientRecord.barkDeviceKey, 'bark-alice');
  assert.equal(second.settings.clients['web:one'].isDeviceOnly, true);
  assert.equal(second.settings.clients['web:two'].isDeviceOnly, true);
  assert.equal(second.settings.clients[accountClientId].ownerUserId, 'usr_alice');
});

test('same account duplicate channel is cleaned from an old client', () => {
  const settings = {
    clients: {
      'account:usr_alice': {
        clientId: 'account:usr_alice',
        ownerUserId: 'usr_alice'
      },
      'web:old': {
        clientId: 'web:old',
        ownerUserId: 'usr_alice',
        barkDeviceKey: 'bark-alice'
      }
    }
  };

  const next = prepareUniqueChannelSettings(
    settings,
    'account:usr_alice',
    { ownerUserId: 'usr_alice', accountUsername: 'alice' },
    'bark-alice',
    {}
  );

  assert.equal(next.clients['web:old'].barkDeviceKey, '');
});

test('channel already owned by another account returns 409', () => {
  const settings = {
    clients: {
      'account:usr_alice': {
        clientId: 'account:usr_alice',
        ownerUserId: 'usr_alice',
        barkDeviceKey: 'shared-bark'
      },
      'account:usr_bob': {
        clientId: 'account:usr_bob',
        ownerUserId: 'usr_bob'
      }
    }
  };

  assert.throws(
    () => prepareUniqueChannelSettings(
      settings,
      'account:usr_bob',
      { ownerUserId: 'usr_bob', accountUsername: 'bob' },
      'shared-bark',
      {}
    ),
    (error) => error instanceof NotifyClientError
      && error.status === 409
      && error.code === 'CHANNEL_ALREADY_BOUND'
  );
});
