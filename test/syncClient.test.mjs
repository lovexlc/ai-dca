import test from 'node:test';
import assert from 'node:assert/strict';
import { getClientEnd, getClientId } from '../src/app/syncClient.js';

const originalWindow = globalThis.window;

function makeStorage(values = {}) {
  const store = new Map(Object.entries(values));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    }
  };
}

function installWindow(storage) {
  globalThis.window = {
    localStorage: storage,
    innerWidth: 1280,
    navigator: { userAgent: 'Mozilla/5.0' }
  };
}

test.afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

test('uses the logged-in username as the sync end id', () => {
  installWindow(makeStorage({
    aiDcaCloudSyncSession: JSON.stringify({ username: 'lovexl', accessToken: 'token' }),
    aiDcaSyncClientId: 'legacy-device-id'
  }));

  assert.equal(getClientId(), 'lovexl');
  assert.equal(getClientEnd().id, 'lovexl');
});

test('the same username is stable across device localStorage instances', () => {
  installWindow(makeStorage({
    aiDcaCloudSyncSession: JSON.stringify({ username: 'lovexl' })
  }));
  const firstDeviceId = getClientEnd().id;

  installWindow(makeStorage({
    aiDcaCloudSyncSession: JSON.stringify({ username: 'lovexl' })
  }));
  const secondDeviceId = getClientEnd().id;

  assert.equal(firstDeviceId, 'lovexl');
  assert.equal(secondDeviceId, firstDeviceId);
});

test('different usernames do not share a sync end id on one device', () => {
  const storage = makeStorage({
    aiDcaCloudSyncSession: JSON.stringify({ username: 'alice' })
  });
  installWindow(storage);
  const firstAccountId = getClientId();

  storage.setItem('aiDcaCloudSyncSession', JSON.stringify({ username: 'bob' }));
  const secondAccountId = getClientId();

  assert.equal(firstAccountId, 'alice');
  assert.equal(secondAccountId, 'bob');
  assert.notEqual(secondAccountId, firstAccountId);
});

test('falls back to anonymous without a valid session', () => {
  installWindow(makeStorage({ aiDcaCloudSyncSession: '{not-json' }));
  assert.equal(getClientId(), 'anonymous');

  delete globalThis.window;
  assert.equal(getClientId(), 'anonymous');
});
