import assert from 'node:assert/strict';
import test from 'node:test';

import { readLedgerState } from '../src/app/holdingsLedger.js';
import { USER_DATA_HYDRATION_EVENT, UserDataStore, userDataStore } from '../src/app/userDataStore.js';
import { DERIVED_HOLDINGS_KEYS, SYNCABLE_STORAGE_KEYS } from '../src/app/syncRegistry.js';

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

test('logout clears local business data even when a pending upload fails', async () => {
  const originalWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const windowLike = Object.assign(new EventTarget(), {
    localStorage,
    sessionStorage: new MemoryStorage()
  });
  const store = new UserDataStore();
  const key = 'aiDcaWorkspacePrefs';
  const timer = setTimeout(() => {}, 10_000);

  try {
    globalThis.window = windowLike;
    for (const businessKey of SYNCABLE_STORAGE_KEYS) localStorage.setItem(businessKey, 'local-data');
    for (const derivedKey of DERIVED_HOLDINGS_KEYS) localStorage.setItem(derivedKey, 'derived-data');
    localStorage.setItem('aiDcaAccountAssignments', 'legacy-data');
    localStorage.setItem('aiDcaCloudSyncMeta', JSON.stringify({ userId: 'logout-user' }));
    localStorage.setItem('aiDcaCloudSyncV2Meta', JSON.stringify({ userId: 'logout-user' }));

    store.mode = 'remote';
    store.userId = 'logout-user';
    store.session = { userId: 'logout-user', accessToken: 'access-token' };
    store.values.set(key, 'new-value');
    store.pending.set(key, { timer, options: { previous: 'old-value' } });
    store.commit = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE' }); };

    const result = await store.logout({ flush: true });

    assert.equal(store.isAuthenticated(), false);
    assert.equal(result.flushed, false);
    assert.equal(result.flushErrors.length, 1);
    for (const businessKey of [...SYNCABLE_STORAGE_KEYS, ...DERIVED_HOLDINGS_KEYS, 'aiDcaAccountAssignments']) {
      assert.equal(localStorage.getItem(businessKey), null, `expected ${businessKey} to be removed`);
    }
    assert.equal(localStorage.getItem('aiDcaCloudSyncMeta'), null);
    assert.equal(localStorage.getItem('aiDcaCloudSyncV2Meta'), null);
  } finally {
    clearTimeout(timer);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('derived holdings changes do not schedule a cloud commit', () => {
  const store = new UserDataStore();
  const key = 'aiDcaFundHoldingsLedger';
  const transaction = { id: 'tx-derived', code: '000001', type: 'BUY', shares: 1, price: 1 };
  let scheduled = 0;
  store.mode = 'remote';
  store.values.set(key, JSON.stringify({ transactions: [transaction] }));
  store.scheduleCommit = () => { scheduled += 1; };

  store.setItem(key, JSON.stringify({
    transactions: [transaction],
    snapshotsByCode: { '000001': { latestNav: 2 } },
    lastNavMeta: { status: 'success' }
  }));
  assert.equal(scheduled, 0);

  store.setItem(key, JSON.stringify({
    transactions: [transaction, { ...transaction, id: 'tx-new' }],
    snapshotsByCode: { '000001': { latestNav: 3 } }
  }));
  assert.equal(scheduled, 1);
});

test('holdings cloud resource restores transactions without derived snapshots', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalDecryptResource = UserDataStore.prototype.decryptResource;
  const store = new UserDataStore();
  const windowLike = Object.assign(new EventTarget(), {
    __AI_DCA_SYNC_BASE__: 'https://sync.test',
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    navigator: { userAgent: 'node-test' },
    innerWidth: 1200
  });
  const transaction = { id: 'tx-remote', code: '000001', type: 'BUY', shares: 1, price: 1 };
  const requested = [];

  try {
    globalThis.window = windowLike;
    store.decryptResource = async () => ({
      payload: {
        aiDcaFundHoldingsLedger: JSON.stringify({
          transactions: [transaction],
          snapshotsByCode: { '000001': { latestNav: 9.9 } },
          lastNavMeta: { status: 'success' }
        })
      }
    });
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      if (/\/data\/manifest/.test(String(url))) {
        return new Response(JSON.stringify({
          resources: [
            { resourceId: 'aiDcaFundHoldingsLedger', revision: 2, contentHash: 'ledger-hash' },
            { resourceId: 'aiDcaFundHoldingsState', revision: 5, contentHash: 'derived-hash' },
            { resourceId: 'aiDcaPositionSnapshot', revision: 4, contentHash: 'snapshot-hash' }
          ]
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      assert.match(String(url), /\/data\/aiDcaFundHoldingsLedger$/);
      return new Response(JSON.stringify({ encrypted: { version: 3 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    await store.startSession({ userId: 'user-holdings-source', accessToken: 'access-token' });
    const restored = JSON.parse(store.getItem('aiDcaFundHoldingsLedger'));
    assert.deepEqual(restored.transactions, [transaction]);
    assert.equal(Object.hasOwn(restored, 'snapshotsByCode'), false);
    assert.equal(requested.filter((url) => /aiDcaFundHoldings(State|PositionSnapshot)/.test(url)).length, 0);
  } finally {
    UserDataStore.prototype.decryptResource = originalDecryptResource;
    store.setAnonymous();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('authenticated holdings refresh always reads the transaction resource from the API', async () => {
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
  const transaction = { id: 'tx-fresh', code: '513100', type: 'BUY', shares: 200, price: 1.5 };
  const requested = [];

  try {
    globalThis.window = windowLike;
    store.mode = 'remote';
    store.userId = 'user-direct-refresh';
    store.session = { userId: 'user-direct-refresh', accessToken: 'access-token' };
    store.values.set('aiDcaFundHoldingsLedger', JSON.stringify({
      transactions: [{ id: 'tx-stale', code: '161130', type: 'BUY', shares: 1, price: 1 }]
    }));
    store.revisions.set('aiDcaFundHoldingsLedger', 65);
    store.decryptResource = async () => ({
      payload: {
        aiDcaFundHoldingsLedger: JSON.stringify({
          transactions: [transaction],
          snapshotsByCode: { '513100': { latestNav: 9.9 } }
        })
      }
    });
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      assert.match(String(url), /\/data\/aiDcaFundHoldingsLedger$/);
      return new Response(JSON.stringify({ revision: 66, encrypted: { version: 3 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    const result = await store.refreshResource('aiDcaFundHoldingsLedger');
    assert.deepEqual(requested, ['https://sync.test/data/aiDcaFundHoldingsLedger']);
    assert.equal(result.revision, 66);
    assert.deepEqual(JSON.parse(store.getItem('aiDcaFundHoldingsLedger')), {
      source: 'ai-dca-trade-ledger',
      version: 1,
      transactions: [transaction]
    });
  } finally {
    store.setAnonymous();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('remote user data never falls back to localStorage legacy holdings', () => {
  const originalWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const windowLike = Object.assign(new EventTarget(), {
    localStorage,
    sessionStorage: new MemoryStorage()
  });

  try {
    globalThis.window = windowLike;
    localStorage.setItem('aiDcaFundHoldingsState', JSON.stringify({
      rows: [{ code: '513100', avgCost: 1.5, shares: 200 }]
    }));
    userDataStore.mode = 'remote';
    userDataStore.userId = 'user-no-local-fallback';
    userDataStore.session = { userId: 'user-no-local-fallback', accessToken: 'access-token' };
    userDataStore.values.clear();

    assert.equal(userDataStore.getItem('aiDcaFundHoldingsState'), null);
    assert.deepEqual(readLedgerState().transactions, []);
    userDataStore.setItem('aiDcaFundHoldingsState', JSON.stringify({ rows: [] }));
    assert.equal(localStorage.getItem('aiDcaFundHoldingsState')?.includes('513100'), true);
  } finally {
    userDataStore.setAnonymous();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
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

test('anonymous holdings snapshot contains transactions but not derived market data', () => {
  const originalWindow = globalThis.window;
  const store = new UserDataStore();
  const windowLike = Object.assign(new EventTarget(), {
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage()
  });
  const transaction = { id: 'tx-local', code: '000001', type: 'BUY', shares: 1, price: 1 };

  try {
    globalThis.window = windowLike;
    windowLike.localStorage.setItem('aiDcaFundHoldingsLedger', JSON.stringify({
      transactions: [transaction],
      snapshotsByCode: { '000001': { latestNav: 9.9 } },
      lastNavMeta: { status: 'success' }
    }));
    const snapshot = store.captureAnonymousSnapshot();
    assert.deepEqual(JSON.parse(snapshot.entries.aiDcaFundHoldingsLedger), {
      source: 'ai-dca-trade-ledger',
      version: 1,
      transactions: [transaction]
    });
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
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
