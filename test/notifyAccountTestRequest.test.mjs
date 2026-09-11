import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stripDeviceIdentityFromAccountTestRequest } from '../workers/notify/src/accountEntry.js';

test('account notification test drops legacy device credentials but keeps channel payload', async () => {
  const request = new Request('https://api.freebacktrack.tech/api/notify/test', {
    method: 'POST',
    headers: {
      authorization: 'Bearer account-token',
      'content-type': 'application/json',
      'x-notify-verified-user-id': 'usr-test',
      'x-notify-verified-username': 'test-user',
    },
    body: JSON.stringify({
      clientId: 'web:legacy-device',
      notifyClientId: 'web:legacy-device',
      clientSecret: 'legacy-secret',
      notifyClientSecret: 'legacy-secret',
      targetChannel: 'serverchan3',
      serverChan3: { uid: '10001', sendKey: 'test-send-key' },
      title: '测试通知',
    }),
  });

  const normalized = await stripDeviceIdentityFromAccountTestRequest(request);
  const payload = await normalized.json();

  assert.equal(payload.clientId, undefined);
  assert.equal(payload.notifyClientId, undefined);
  assert.equal(payload.clientSecret, undefined);
  assert.equal(payload.notifyClientSecret, undefined);
  assert.equal(payload.targetChannel, 'serverchan3');
  assert.deepEqual(payload.serverChan3, { uid: '10001', sendKey: 'test-send-key' });
  assert.equal(normalized.headers.get('authorization'), 'Bearer account-token');
  assert.equal(normalized.headers.get('x-notify-verified-user-id'), 'usr-test');
});
