import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAccountNotifyTestRequest } from '../workers/notify/src/accountEntry.js';

test('signed-in notify test drops stale device identity when client secret is missing', async () => {
  const request = new Request('https://api.example.com/api/notify/test?clientId=web%3Astale', {
    method: 'POST',
    headers: {
      authorization: 'Bearer account-token',
      'content-type': 'application/json',
      'x-notify-verified-user-id': 'user-1',
      'x-notify-verified-username': 'tester'
    },
    body: JSON.stringify({
      clientId: 'web:stale',
      notifyClientId: 'web:stale',
      title: '测试通知',
      body: '测试内容',
      targetChannel: 'bark'
    })
  });

  const normalized = await normalizeAccountNotifyTestRequest(request);
  const payload = await normalized.json();

  assert.equal(new URL(normalized.url).searchParams.has('clientId'), false);
  assert.equal('clientId' in payload, false);
  assert.equal('notifyClientId' in payload, false);
  assert.equal(payload.title, '测试通知');
  assert.equal(payload.targetChannel, 'bark');
  assert.equal(normalized.headers.get('authorization'), 'Bearer account-token');
});

test('notify test keeps device identity when a client secret is present', async () => {
  const request = new Request('https://api.example.com/api/notify/test?clientId=web%3Acurrent', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-notify-client-secret': 'device-secret'
    },
    body: JSON.stringify({ clientId: 'web:current', title: '测试通知' })
  });

  const normalized = await normalizeAccountNotifyTestRequest(request);

  assert.equal(normalized, request);
  assert.equal(new URL(normalized.url).searchParams.get('clientId'), 'web:current');
});

test('non-test routes are not rewritten', async () => {
  const request = new Request('https://api.example.com/api/notify/settings?clientId=web%3Astale', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: 'web:stale' })
  });

  const normalized = await normalizeAccountNotifyTestRequest(request);
  assert.equal(normalized, request);
});
