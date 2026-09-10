import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  authenticateNotifyAccountRequest,
  NotifyAccountAuthError,
  requiresNotifyAccountAuth,
  VERIFIED_NOTIFY_USER_ID_HEADER,
  VERIFIED_NOTIFY_USERNAME_HEADER
} from '../workers/notify/src/notifyAccountAuth.js';
import {
  buildAccountClientId,
  ensureAuthenticatedAccountClient,
  ensureAuthenticatedClient,
  hashText,
  NotifyClientError
} from '../workers/notify/src/clientSettings.js';
import { prepareUniqueChannelSettings } from '../workers/notify/src/notifyClientRoutes.js';

function accountRequest(clientId, secret, userId = 'usr_alice', username = 'alice') {
  return new Request(
    'https://api.freebacktrack.tech/api/notify/status?clientId=' + encodeURIComponent(clientId),
    {
      headers: {
        'x-notify-client-secret': secret,
        [VERIFIED_NOTIFY_USER_ID_HEADER]: userId,
        [VERIFIED_NOTIFY_USERNAME_HEADER]: username
      }
    }
  );
}

function verifiedAccountRequest(path = '/api/notify/settings', userId = 'usr_alice', username = 'alice') {
  return new Request(`https://api.freebacktrack.tech${path}`, {
    headers: {
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

test('same authenticated username with stale ownerUserId is treated as same channel owner', () => {
  const settings = {
    clients: {
      'account:usr_old': {
        clientId: 'account:usr_old',
        ownerUserId: 'usr_old',
        accountUsername: 'lovexl',
        serverChan3: { uid: '18912', sendKey: 'same-send-key' }
      },
      'account:usr_current': {
        clientId: 'account:usr_current',
        ownerUserId: 'usr_current',
        accountUsername: 'lovexl'
      }
    }
  };

  const next = prepareUniqueChannelSettings(
    settings,
    'account:usr_current',
    { ownerUserId: 'usr_current', accountUsername: 'lovexl' },
    '',
    { uid: '18912', sendKey: 'same-send-key' }
  );

  assert.equal(next.clients['account:usr_old'].serverChan3.uid, '');
  assert.equal(next.clients['account:usr_old'].serverChan3.sendKey, '');
});

test('Bark owned by another account requires explicit verified rebind', () => {
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
      && error.code === 'CHANNEL_REBIND_REQUIRED'
      && error.channel === 'bark'
      && error.canRebind === true
  );

  const rebound = prepareUniqueChannelSettings(
    settings,
    'account:usr_bob',
    { ownerUserId: 'usr_bob', accountUsername: 'bob' },
    'shared-bark',
    {},
    { rebindChannel: 'bark' }
  );
  assert.equal(rebound.clients['account:usr_alice'].barkDeviceKey, '');
});

test('ServerChan3 takeover requires exact UID and SendKey match', () => {
  const settings = {
    clients: {
      'account:usr_alice': {
        clientId: 'account:usr_alice',
        ownerUserId: 'usr_alice',
        serverChan3: { uid: '18912', sendKey: 'send-key-alice' }
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
      '',
      { uid: '18912', sendKey: 'wrong-key' },
      { rebindChannel: 'serverchan3' }
    ),
    (error) => error instanceof NotifyClientError
      && error.status === 409
      && error.code === 'CHANNEL_BINDING_MISMATCH'
      && error.canRebind === false
  );

  assert.throws(
    () => prepareUniqueChannelSettings(
      settings,
      'account:usr_bob',
      { ownerUserId: 'usr_bob', accountUsername: 'bob' },
      '',
      { uid: '18912', sendKey: 'send-key-alice' }
    ),
    (error) => error instanceof NotifyClientError
      && error.code === 'CHANNEL_REBIND_REQUIRED'
      && error.channel === 'serverchan3'
      && error.canRebind === true
  );

  const rebound = prepareUniqueChannelSettings(
    settings,
    'account:usr_bob',
    { ownerUserId: 'usr_bob', accountUsername: 'bob' },
    '',
    { uid: '18912', sendKey: 'send-key-alice' },
    { rebindChannel: 'serverchan3' }
  );
  assert.equal(rebound.clients['account:usr_alice'].serverChan3.uid, '');
  assert.equal(rebound.clients['account:usr_alice'].serverChan3.sendKey, '');
});

test('account notification config resolves from verified user without browser client identity', async () => {
  const settings = {
    clients: {
      'web:legacy': {
        clientId: 'web:legacy',
        accountUsername: 'alice',
        barkDeviceKey: 'bark-alice'
      }
    }
  };
  const auth = await ensureAuthenticatedAccountClient(verifiedAccountRequest(), settings);
  const accountClientId = buildAccountClientId('usr_alice');

  assert.equal(auth.clientId, accountClientId);
  assert.equal(auth.deviceClientId, '');
  assert.equal(auth.ownerUserId, 'usr_alice');
  assert.equal(auth.clientRecord.barkDeviceKey, 'bark-alice');
});

test('device registration routes also require bearer account authentication', () => {
  assert.equal(requiresNotifyAccountAuth(new Request('https://api.freebacktrack.tech/api/notify/ws/register', { method: 'POST' })), true);
  assert.equal(requiresNotifyAccountAuth(new Request('https://api.freebacktrack.tech/api/notify/ws/unregister', { method: 'POST' })), true);
});
