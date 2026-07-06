import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  __internals,
  cacheRealtimeSnapshotItems,
  clearNavServiceMemoryCache,
  getNavSnapshots
} from '../src/app/navService.js';

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

function installWindow(storage = createStorage()) {
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: storage };
  return () => {
    clearNavServiceMemoryCache();
    globalThis.window = originalWindow;
  };
}

test('getNavSnapshots reuses fresh localStorage fund metrics without network', async () => {
  const originalFetch = globalThis.fetch;
  const storage = createStorage();
  const restoreWindow = installWindow(storage);
  storage.setItem(__internals.LOCAL_SNAPSHOT_CACHE_KEY, JSON.stringify({
    '513100': {
      code: '513100',
      item: {
        code: '513100',
        name: '纳指ETF国泰',
        price: 2.167,
        latestNav: 2.15,
        source: 'fund-metrics'
      },
      expiresAt: '2099-01-01T00:00:00.000Z',
      cachedAtMs: Date.now(),
      source: 'fund-metrics'
    }
  }));
  globalThis.fetch = async () => {
    throw new Error('network should not be called');
  };

  try {
    const payload = await getNavSnapshots(['513100']);

    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].price, 2.167);
    assert.equal(payload.cache.source, 'localStorage');
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }
});

test('getNavSnapshots writes fund metrics response to localStorage cache', async () => {
  const originalFetch = globalThis.fetch;
  const storage = createStorage();
  const restoreWindow = installWindow(storage);
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/api\/markets\/fund-metrics\?refresh=1$/);
    assert.deepEqual(JSON.parse(init.body).codes, ['513100']);
    return new Response(JSON.stringify({
      items: [{
        ok: true,
        code: '513100',
        name: '纳指ETF国泰',
        price: 2.167,
        latestNav: 2.15,
        source: 'fund-metrics'
      }],
      successCount: 1,
      failureCount: 0,
      generatedAt: '2026-07-05T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const payload = await getNavSnapshots(['513100'], { forceRefresh: true });
    const cached = JSON.parse(storage.getItem(__internals.LOCAL_SNAPSHOT_CACHE_KEY));

    assert.equal(payload.items[0].price, 2.167);
    assert.equal(cached['513100'].item.price, 2.167);
    assert.equal(cached['513100'].source, 'fund-metrics');
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }
});

test('fund metrics local cache rejects expired or mismatched-source entries', () => {
  const item = {
    code: '513100',
    price: 2.167,
    source: 'fund-metrics'
  };

  assert.equal(__internals.isValidLocalSnapshotEntry({
    code: '513100',
    item,
    expiresAt: '2000-01-01T00:00:00.000Z',
    source: 'fund-metrics'
  }), false);
  assert.equal(__internals.isValidLocalSnapshotEntry({
    code: '513100',
    item,
    expiresAt: '2099-01-01T00:00:00.000Z',
    source: 'other-source'
  }), false);
  assert.equal(__internals.isValidLocalSnapshotEntry({
    code: '513100',
    item,
    expiresAt: '2099-01-01T00:00:00.000Z',
    source: 'fund-metrics'
  }), true);
});

test('fund metrics local cache write ignores invalid items and keeps valid code keys', () => {
  const storage = createStorage();
  const restoreWindow = installWindow(storage);

  try {
    const changed = __internals.writeCachedSnapshotItems([
      { code: '', price: 9, source: 'fund-metrics' },
      { code: '513100', price: 2.167, source: 'fund-metrics' }
    ], '2099-01-01T00:00:00.000Z');
    const cached = JSON.parse(storage.getItem(__internals.LOCAL_SNAPSHOT_CACHE_KEY));

    assert.equal(changed, true);
    assert.deepEqual(Object.keys(cached), ['513100']);
    assert.equal(cached['513100'].item.price, 2.167);
  } finally {
    restoreWindow();
  }
});

test('realtime snapshot cache stores WS merged items for later getNavSnapshots reads', async () => {
  const originalFetch = globalThis.fetch;
  const storage = createStorage();
  const restoreWindow = installWindow(storage);
  globalThis.fetch = async () => {
    throw new Error('network should not be called');
  };

  try {
    const changed = cacheRealtimeSnapshotItems([{
      code: '513100',
      name: '纳指ETF国泰',
      price: 2.365,
      latestNav: 2.065,
      latestNavDate: '2026-06-02',
      source: 'fund-metrics'
    }], Date.now());
    const payload = await getNavSnapshots(['513100']);

    assert.equal(changed, true);
    assert.equal(payload.items[0].price, 2.365);
    assert.equal(payload.items[0].latestNav, 2.065);
    assert.equal(payload.cache.source, 'localStorage');
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }
});
