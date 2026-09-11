import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sendBarkNotification } from '../workers/notify/src/channels/bark.js';
import { sendServerChan3Notification } from '../workers/notify/src/channels/serverChan3.js';

test('Bark test delivery uses a bounded abort signal', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    assert.ok(init.signal, 'expected Bark fetch to receive an abort signal');
    return new Response(JSON.stringify({ code: 200, message: 'success' }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await sendBarkNotification({ deviceKey: 'device-key', title: 'test', body: 'test' });
  assert.equal(result.status, 'delivered');
});

test('ServerChan3 test delivery uses a bounded abort signal', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    assert.ok(init.signal, 'expected ServerChan3 fetch to receive an abort signal');
    return new Response('ok', { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await sendServerChan3Notification({ uid: 'uid', sendKey: 'send-key', title: 'test', body: 'test' });
  assert.equal(result.status, 'delivered');
});

test('provider timeout is returned as a channel-specific failure', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException('timed out', 'TimeoutError'); };
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    () => sendBarkNotification({ deviceKey: 'device-key', title: 'test', body: 'test' }),
    /Bark 推送失败：上游 6 秒内未响应/
  );
  await assert.rejects(
    () => sendServerChan3Notification({ uid: 'uid', sendKey: 'send-key', title: 'test', body: 'test' }),
    /Server酱³ 推送失败：上游 6 秒内未响应/
  );
});
