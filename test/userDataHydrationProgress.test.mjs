import assert from 'node:assert/strict';
import test from 'node:test';

import { readLedgerState } from '../src/app/holdingsLedger.js';
import { USER_DATA_HYDRATION_EVENT, USER_DATA_MODE_EVENT, UserDataStore, userDataStore } from '../src/app/userDataStore.js';
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
  const key = 'aiDcaPlanStore';
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

test('领域接口 key 在登录态仍使用本地身份，不进入通用资源提交队列', () => {
  const originalWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const windowLike = Object.assign(new EventTarget(), {
    localStorage,
    sessionStorage: new MemoryStorage()
  });
  const store = new UserDataStore();

  try {
    globalThis.window = windowLike;
    store.mode = 'remote';
    store.userId = 'domain-api-user';
    store.session = { userId: 'domain-api-user', accessToken: 'access-token' };
    store.setItem('aiDcaNotifyClientConfig', '{"notifyClientSecret":"local-secret"}');

    assert.equal(store.getItem('aiDcaNotifyClientConfig'), '{"notifyClientSecret":"local-secret"}');
    assert.equal(store.values.has('aiDcaNotifyClientConfig'), false);
    assert.equal(store.pending.size, 0);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('logout is blocked when a pending upload fails and preserves local business data', async () => {
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

    await assert.rejects(
      () => store.logout({ flush: true }),
      (error) => error?.code === 'LOGOUT_FLUSH_FAILED' && error.flushErrors.length === 1
    );

    assert.equal(store.isAuthenticated(), true);
    for (const businessKey of [...SYNCABLE_STORAGE_KEYS, ...DERIVED_HOLDINGS_KEYS, 'aiDcaAccountAssignments']) {
      const expected = DERIVED_HOLDINGS_KEYS.has(businessKey)
        ? 'derived-data'
        : businessKey === 'aiDcaAccountAssignments' ? 'legacy-data' : 'local-data';
      assert.equal(localStorage.getItem(businessKey), expected, `expected ${businessKey} to be preserved`);
    }
    assert.deepEqual(JSON.parse(localStorage.getItem('aiDcaCloudSyncMeta')), { userId: 'logout-user' });
    assert.deepEqual(JSON.parse(localStorage.getItem('aiDcaCloudSyncV2Meta')), { userId: 'logout-user' });
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

test('tab-scoped session only reads the active Tab REST resources', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const store = new UserDataStore();
  const localStorage = new MemoryStorage();
  const windowLike = Object.assign(new EventTarget(), {
    __AI_DCA_SYNC_BASE__: 'https://sync.test',
    localStorage,
    sessionStorage: new MemoryStorage()
  });
  const requested = [];

  try {
    globalThis.window = windowLike;
    localStorage.setItem('aiDcaPlanStore', JSON.stringify({ plans: [{ id: 'local-plan' }] }));
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      assert.doesNotMatch(String(url), /manifest|\/data\/|\/v2\/|secure-config/);
      return new Response(JSON.stringify({ revision: 1, data: JSON.stringify({ plans: [{ id: 'remote-plan' }] }) }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    await store.startRemoteSession({ userId: 'user-tab-scoped', accessToken: 'access-token' });
    assert.equal(store.hasPendingLocalMigration(), true);
    await store.hydrateTab('tradePlans');

    assert.ok(requested.length > 0);
    assert.ok(requested.every((url) => /\/trade-plans\//.test(url)));
    assert.equal(requested.some((url) => /holdings|notify|markets|global/.test(url)), false);
    assert.deepEqual(JSON.parse(store.getItem('aiDcaPlanStore')), { plans: [{ id: 'remote-plan' }] });
    assert.equal(store.tabScoped, true);
  } finally {
    store.setAnonymous();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('login preserves local data and promotes legacy holdings before remote mode', async () => {
  const originalWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const windowLike = Object.assign(new EventTarget(), {
    localStorage,
    sessionStorage: new MemoryStorage()
  });
  const store = new UserDataStore();

  try {
    globalThis.window = windowLike;
    localStorage.setItem('aiDcaWorkspacePrefs', JSON.stringify({ theme: 'dark' }));
    localStorage.setItem('aiDcaFundHoldingsState', JSON.stringify({
      rows: [{ code: '000001', name: '测试基金', avgCost: 1.2, shares: 10 }]
    }));

    await store.startRemoteSession({ userId: 'user-preserve-local', username: 'lovexl', accessToken: 'access-token' });

    assert.ok(localStorage.getItem('aiDcaFundHoldingsState'));
    const ledger = JSON.parse(localStorage.getItem('aiDcaFundHoldingsLedger'));
    assert.equal(ledger.transactions.length, 1);
    assert.equal(ledger.transactions[0].code, '000001');
    assert.equal(store.getItem('aiDcaWorkspacePrefs'), JSON.stringify({ theme: 'dark' }));
    assert.ok(store.captureCurrentDeviceSnapshot().keys.includes('aiDcaFundHoldingsLedger'));
  } finally {
    store.setAnonymous();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('current device snapshot does not get overwritten by hydrated cloud values', async () => {
  const originalWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const windowLike = Object.assign(new EventTarget(), {
    localStorage,
    sessionStorage: new MemoryStorage()
  });
  const store = new UserDataStore();

  try {
    globalThis.window = windowLike;
    localStorage.setItem('aiDcaPlanStore', JSON.stringify({ plans: [{ id: 'local-plan' }] }));
    await store.startRemoteSession({ userId: 'user-device-snapshot', accessToken: 'access-token' });
    store.values.set('aiDcaPlanStore', JSON.stringify({ plans: [{ id: 'cloud-plan' }] }));

    assert.deepEqual(
      JSON.parse(store.captureCurrentDeviceSnapshot().entries.aiDcaPlanStore),
      { plans: [{ id: 'local-plan' }] }
    );
  } finally {
    store.setAnonymous();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
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

test('empty anonymous holdings ledger does not count as local business data', () => {
  const originalWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const windowLike = Object.assign(new EventTarget(), {
    localStorage,
    sessionStorage: new MemoryStorage()
  });

  try {
    globalThis.window = windowLike;
    localStorage.setItem('aiDcaFundHoldingsLedger', JSON.stringify({ transactions: [] }));
    const store = new UserDataStore();
    assert.deepEqual(store.captureAnonymousSnapshot(), { entries: {}, keys: [] });
  } finally {
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

test('legacy snapshot migration writes every resource through its Tab REST route', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const store = new UserDataStore();
  const localStorage = new MemoryStorage();
  const windowLike = Object.assign(new EventTarget(), {
    __AI_DCA_SYNC_BASE__: 'https://sync.test',
    localStorage,
    sessionStorage: new MemoryStorage(),
    navigator: { userAgent: 'node-test' },
    innerWidth: 1200
  });
  const legacyValues = {
    aiDcaWorkspacePrefs: JSON.stringify({ marker: 'legacy-workspace' }),
    aiDcaPlanStore: JSON.stringify({ plans: [{ id: 'legacy-plan' }] })
  };
  const resources = new Map();
  const writes = [];
  const originalDecryptResource = store.decryptResource;

  try {
    globalThis.window = windowLike;
    store.decryptResource = async () => ({ payload: legacyValues });
    globalThis.fetch = async (url, init = {}) => {
      const parsed = new URL(String(url));
      const method = String(init.method || 'GET').toUpperCase();
      if (parsed.pathname.endsWith('/data/manifest')) {
        return new Response(JSON.stringify({
          resources: [...resources.entries()].map(([resourceId, row]) => ({ resourceId, ...row })),
          migration: { status: 'pending' },
          legacySnapshot: true
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (parsed.pathname.endsWith('/v2/snapshot')) {
        return new Response(JSON.stringify({ encryptedEnvelope: { version: 3, source: 'ai-dca-secure-sync', ciphertext: 'legacy', crypto: { wrappedDek: 'dek' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (parsed.pathname.endsWith('/migration')) {
        return new Response(JSON.stringify({ ok: true, status: 'completed' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (method === 'PUT') {
        writes.push(parsed.pathname);
        const body = JSON.parse(String(init.body || '{}'));
        resources.set(parsed.pathname.includes('/global/') ? 'aiDcaWorkspacePrefs' : 'aiDcaPlanStore', {
          revision: 1,
          contentHash: body.contentHash
        });
        return new Response(JSON.stringify({ revision: 1, contentHash: body.contentHash }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`unexpected migration request: ${method} ${parsed.pathname}`);
    };

    await store.startSession({ userId: 'user-legacy-tab-migration', accessToken: 'access-token' }, { decision: 'cloud' });

    assert.deepEqual(writes.sort(), ['/global/workspace-prefs', '/trade-plans/plans']);
    assert.equal(store.getItem('aiDcaWorkspacePrefs'), legacyValues.aiDcaWorkspacePrefs);
    assert.equal(store.getItem('aiDcaPlanStore'), legacyValues.aiDcaPlanStore);
  } finally {
    store.decryptResource = originalDecryptResource;
    store.setAnonymous();
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

test('network hydration failure can mount an offline session from encrypted cache', async () => {
  const originalWindow = globalThis.window;
  const originalDecryptResource = UserDataStore.prototype.decryptResource;
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const windowLike = Object.assign(new EventTarget(), { localStorage, sessionStorage });
  const store = new UserDataStore();
  const modeEvents = [];
  const hydrationEvents = [];
  try {
    globalThis.window = windowLike;
    const cacheKey = 'aiDcaUserDataCache:user-offline-cache';
    sessionStorage.setItem(cacheKey, JSON.stringify({
      version: 1,
      source: 'ai-dca-user-data-resource-cache',
      userId: 'user-offline-cache',
      manifestHash: 'stale-but-usable',
      savedAt: new Date().toISOString(),
      resources: [{
        resourceId: 'aiDcaWorkspacePrefs',
        revision: 7,
        schemaVersion: 1,
        contentHash: 'workspace-hash',
        deleted: false,
        encrypted: {
          version: 3,
          source: 'ai-dca-secure-sync',
          crypto: { wrappedDek: 'dek', iv: 'iv' },
          ciphertext: 'ciphertext'
        }
      }],
      legacy: null
    }));
    store.decryptResource = async () => ({ payload: { aiDcaWorkspacePrefs: JSON.stringify({ from: 'cache' }) } });
    windowLike.addEventListener(USER_DATA_MODE_EVENT, (event) => modeEvents.push(event.detail));
    windowLike.addEventListener(USER_DATA_HYDRATION_EVENT, (event) => hydrationEvents.push(event.detail));

    await store.startOfflineSession({ userId: 'user-offline-cache', accessToken: 'access-token' }, { reason: 'OFFLINE' });

    assert.equal(store.isAuthenticated(), true);
    assert.equal(store.offline, true);
    assert.deepEqual(JSON.parse(store.getItem('aiDcaWorkspacePrefs')), { from: 'cache' });
    assert.equal(modeEvents.at(-1).offline, true);
    assert.equal(hydrationEvents.at(-1).complete, true);
    assert.equal(hydrationEvents.at(-1).offline, true);
  } finally {
    UserDataStore.prototype.decryptResource = originalDecryptResource;
    store.setAnonymous();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('offline remote edits stay usable in memory without scheduling a failing commit', () => {
  const originalWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const windowLike = Object.assign(new EventTarget(), { localStorage, sessionStorage: new MemoryStorage() });
  const store = new UserDataStore();
  try {
    globalThis.window = windowLike;
    store.mode = 'remote';
    store.userId = 'user-offline-edit';
    store.session = { userId: 'user-offline-edit', accessToken: 'access-token' };
    store.offline = true;
    let scheduled = 0;
    store.scheduleCommit = () => { scheduled += 1; };

    store.setItem('aiDcaWorkspacePrefs', JSON.stringify({ offline: true }));

    assert.equal(scheduled, 0);
    assert.equal(JSON.parse(store.getItem('aiDcaWorkspacePrefs')).offline, true);
    assert.equal(localStorage.getItem('aiDcaWorkspacePrefs'), null);
  } finally {
    store.setAnonymous();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('offline dirty remote edits block logout until they can be uploaded', async () => {
  const store = new UserDataStore();
  const key = 'aiDcaWorkspacePrefs';
  store.mode = 'remote';
  store.userId = 'user-offline-logout';
  store.session = { userId: 'user-offline-logout', accessToken: 'access-token' };
  store.values.set(key, JSON.stringify({ offline: false }));
  store.offline = true;

  store.setItem(key, JSON.stringify({ offline: true }));

  await assert.rejects(
    () => store.logout({ flush: true }),
    (error) => error?.code === 'LOGOUT_FLUSH_FAILED'
  );
  assert.equal(store.isAuthenticated(), true);
  assert.equal(JSON.parse(store.getItem(key)).offline, true);
  store.setAnonymous();
});

test('background hydration keeps remote data read-only while allowing the page to remain mounted', () => {
  const originalWindow = globalThis.window;
  const windowLike = Object.assign(new EventTarget(), {
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage()
  });
  const store = new UserDataStore();
  try {
    globalThis.window = windowLike;
    store.mode = 'remote';
    store.userId = 'user-background-readonly';
    store.session = { userId: 'user-background-readonly', accessToken: 'access-token' };
    store.values.set('aiDcaWorkspacePrefs', JSON.stringify({ before: true }));
    store.backgroundHydrating = true;

    store.setItem('aiDcaWorkspacePrefs', JSON.stringify({ after: true }));

    assert.deepEqual(JSON.parse(store.getItem('aiDcaWorkspacePrefs')), { before: true });
  } finally {
    store.setAnonymous();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
