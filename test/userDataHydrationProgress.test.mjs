import assert from 'node:assert/strict';
import test from 'node:test';

import { USER_DATA_HYDRATION_EVENT, UserDataStore, userDataStore } from '../src/app/userDataStore.js';

class MemoryStorage {
  #values = new Map();

  get length() {
    return this.#values.size;
  }

  key(index) {
    return [...this.#values.keys()][index] ?? null;
  }

  getItem(key) {
    return this.#values.has(String(key)) ? this.#values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.#values.set(String(key), String(value));
  }

  removeItem(key) {
    this.#values.delete(String(key));
  }
}

test('user data commits serialize writes for the same resource', async () => {
  const store = new UserDataStore();
  const key = 'aiDcaNotifyClientConfig';
  const started = [];
  let active = 0;
  let maxActive = 0;

  store.mode = 'remote';
  store.session = { userId: 'user-commit-queue', accessToken: 'access-token' };
  store.values.set(key, 'initial');
  store.revisions.set(key, 56);
  store.putRemote = async (resourceId, value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    started.push({ resourceId, value, revision: store.revisions.get(resourceId) });
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.revisions.set(resourceId, Number(store.revisions.get(resourceId)) + 1);
    active -= 1;
    return { revision: store.revisions.get(resourceId) };
  };

  store.setItem(key, 'first', { persist: false });
  const first = store.commit(key, { previous: 'initial' });
  await new Promise((resolve) => setImmediate(resolve));
  store.setItem(key, 'second', { persist: false });
  const second = store.commit(key, { previous: 'first' });

  await Promise.all([first, second]);

  assert.equal(maxActive, 1);
  assert.deepEqual(started, [
    { resourceId: key, value: 'first', revision: 56 },
    { resourceId: key, value: 'second', revision: 57 }
  ]);
  assert.equal(store.getItem(key), 'second');
});

test('generated notify client identity does not count as local business data', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const store = new UserDataStore();
  const windowLike = Object.assign(new EventTarget(), {
    __AI_DCA_SYNC_BASE__: 'https://sync.test',
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    navigator: { userAgent: 'node-test' },
    innerWidth: 1200
  });
  const encrypted = {
    version: 3,
    source: 'ai-dca-secure-sync',
    crypto: { wrappedDek: 'dek', iv: 'iv' },
    ciphertext: 'ciphertext'
  };

  try {
    globalThis.window = windowLike;
    windowLike.localStorage.setItem('aiDcaNotifyClientConfig', JSON.stringify({
      barkDeviceKey: '',
      serverChan3Uid: '',
      serverChan3SendKey: '',
      notifyClientId: 'web:generated',
      notifyClientSecret: 'generated-secret'
    }));
    store.decryptResource = async () => ({ payload: { aiDcaWorkspacePrefs: JSON.stringify({ remote: true }) } });
    globalThis.fetch = async (url) => {
      if (/\/data\/manifest/.test(String(url))) {
        return new Response(JSON.stringify({
          resources: [{ resourceId: 'aiDcaWorkspacePrefs', revision: 1, contentHash: 'workspace-hash' }]
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ encrypted }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const result = await store.startSession({ userId: 'user-generated-notify', accessToken: 'access-token' });
    assert.deepEqual(result.local.keys, []);
    assert.equal(store.getItem('aiDcaWorkspacePrefs'), JSON.stringify({ remote: true }));
  } finally {
    store.setAnonymous();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('user data hydration reports meaningful staged progress', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const localStorage = new MemoryStorage();
  const windowLike = Object.assign(new EventTarget(), {
    __AI_DCA_SYNC_BASE__: 'https://sync.test',
    localStorage,
    sessionStorage: new MemoryStorage(),
    navigator: { userAgent: 'node-test' },
    innerWidth: 1200
  });
  const progress = [];

  try {
    globalThis.window = windowLike;
    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/data\/manifest/);
      return new Response(JSON.stringify({ resources: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
    windowLike.addEventListener(USER_DATA_HYDRATION_EVENT, (event) => progress.push(event.detail));

    await userDataStore.startSession({ userId: 'user-progress', accessToken: 'access-token' });

    assert.deepEqual(progress.map((item) => item.stage), [
      'connecting',
      'manifest',
      'resources',
      'finalizing',
      'complete'
    ]);
    assert.equal(progress[2].message, '云端暂无业务数据，正在完成初始化…');
    assert.equal(progress.at(-1).progress, 100);
    assert.equal(progress.at(-1).message, '云端数据恢复完成');
  } finally {
    userDataStore.setAnonymous();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('user data hydration reports resource counts while restoring cloud data', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalDecryptResource = userDataStore.decryptResource;
  const windowLike = Object.assign(new EventTarget(), {
    __AI_DCA_SYNC_BASE__: 'https://sync.test',
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    navigator: { userAgent: 'node-test' },
    innerWidth: 1200
  });
  const progress = [];

  try {
    globalThis.window = windowLike;
    userDataStore.decryptResource = async () => ({
      payload: { aiDcaWorkspacePrefs: JSON.stringify({ restored: true }) }
    });
    globalThis.fetch = async (url) => {
      if (/\/data\/manifest/.test(String(url))) {
        return new Response(JSON.stringify({
          resources: [{ resourceId: 'aiDcaWorkspacePrefs', revision: 3 }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      assert.match(String(url), /\/data\/aiDcaWorkspacePrefs$/);
      return new Response(JSON.stringify({ encrypted: { version: 3 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
    windowLike.addEventListener(USER_DATA_HYDRATION_EVENT, (event) => progress.push(event.detail));

    await userDataStore.startSession({ userId: 'user-resource-progress', accessToken: 'access-token' });

    const resourceEvents = progress.filter((item) => item.stage === 'resources');
    assert.equal(resourceEvents[0].total, 1);
    assert.equal(resourceEvents.at(-1).current, 1);
    assert.equal(resourceEvents.at(-1).total, 1);
    assert.equal(userDataStore.getItem('aiDcaWorkspacePrefs'), JSON.stringify({ restored: true }));
  } finally {
    userDataStore.decryptResource = originalDecryptResource;
    userDataStore.setAnonymous();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('user data hydration reuses encrypted resources when the manifest hash is unchanged', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalDecryptResource = userDataStore.decryptResource;
  const windowLike = Object.assign(new EventTarget(), {
    __AI_DCA_SYNC_BASE__: 'https://sync.test',
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    navigator: { userAgent: 'node-test' },
    innerWidth: 1200
  });
  const progress = [];
  let resourceFetches = 0;
  let contentHash = 'hash-v1';
  let revision = 1;
  let resourceValue = 'remote-v1';

  try {
    globalThis.window = windowLike;
    userDataStore.decryptResource = async () => ({
      payload: { aiDcaWorkspacePrefs: JSON.stringify({ marker: resourceValue }) }
    });
    globalThis.fetch = async (url) => {
      if (/\/data\/manifest/.test(String(url))) {
        return new Response(JSON.stringify({
          resources: [{ resourceId: 'aiDcaWorkspacePrefs', revision, contentHash }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      resourceFetches += 1;
      return new Response(JSON.stringify({
        encrypted: {
          version: 3,
          source: 'ai-dca-secure-sync',
          crypto: { wrappedDek: 'dek', iv: 'iv' },
          ciphertext: 'ciphertext'
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
    windowLike.addEventListener(USER_DATA_HYDRATION_EVENT, (event) => progress.push(event.detail));

    const session = { userId: 'user-cache-progress', accessToken: 'access-token' };
    await userDataStore.startSession(session);
    revision = 2;
    await userDataStore.startSession(session);
    assert.equal(resourceFetches, 1, 'same content hash should skip resource downloads even when revision advances');
    assert.ok(progress.some((item) => item.message?.includes('使用本地加密缓存')));
    assert.equal(JSON.parse(userDataStore.getItem('aiDcaWorkspacePrefs')).marker, 'remote-v1');

    const cacheKey = 'aiDcaUserDataCache:user-cache-progress';
    const sourceMismatch = JSON.parse(windowLike.sessionStorage.getItem(cacheKey));
    sourceMismatch.source = 'unexpected-source';
    windowLike.sessionStorage.setItem(cacheKey, JSON.stringify(sourceMismatch));
    await userDataStore.startSession(session);
    assert.equal(resourceFetches, 2, 'cache source mismatch should fetch the resource again');

    const expired = JSON.parse(windowLike.sessionStorage.getItem(cacheKey));
    expired.savedAt = '2000-01-01T00:00:00.000Z';
    windowLike.sessionStorage.setItem(cacheKey, JSON.stringify(expired));
    await userDataStore.startSession(session);
    assert.equal(resourceFetches, 3, 'expired cache should fetch the resource again');

    await userDataStore.startSession({ userId: 'user-cache-other', accessToken: 'access-token' });
    assert.equal(resourceFetches, 4, 'cache entries must be isolated by user id');
    assert.ok(windowLike.sessionStorage.getItem('aiDcaUserDataCache:user-cache-other'));

    contentHash = 'hash-v2';
    revision = 3;
    resourceValue = 'remote-v2';
    await userDataStore.startSession(session);
    assert.equal(resourceFetches, 5, 'changed manifest hash should fetch the resource again');
    assert.equal(JSON.parse(userDataStore.getItem('aiDcaWorkspacePrefs')).marker, 'remote-v2');
  } finally {
    userDataStore.decryptResource = originalDecryptResource;
    userDataStore.setAnonymous();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
