import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clearAllLocalData, clearAllLocalDataAsync } from '../src/app/clearAllData.js';
import {
  DIRECT_QUOTE_CACHE_KEY,
  FUND_METRICS_SNAPSHOT_CACHE_KEY,
  MARKET_LOCAL_STORAGE_CACHE_KEYS
} from '../src/app/marketCacheKeys.js';

function createStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
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
    has(key) {
      return store.has(key);
    }
  };
}

test('clearAllLocalData removes market data caches', () => {
  const originalWindow = globalThis.window;
  const storage = createStorage({
    ...Object.fromEntries(MARKET_LOCAL_STORAGE_CACHE_KEYS.map((key) => [key, '{}'])),
    'unrelated:key': 'keep'
  });
  globalThis.window = { localStorage: storage };

  try {
    const result = clearAllLocalData();

    for (const key of MARKET_LOCAL_STORAGE_CACHE_KEYS) {
      assert.equal(storage.has(key), false);
    }
    assert.equal(storage.has('unrelated:key'), true);
    assert.ok(result.removedCount >= 18);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('clearAllLocalDataAsync clears local data and tolerates unavailable IndexedDB', async () => {
  const originalWindow = globalThis.window;
  const originalIndexedDb = globalThis.indexedDB;
  const storage = createStorage({
    [DIRECT_QUOTE_CACHE_KEY]: '{}',
    [FUND_METRICS_SNAPSHOT_CACHE_KEY]: '{}'
  });
  globalThis.window = { localStorage: storage };
  delete globalThis.indexedDB;

  try {
    const result = await clearAllLocalDataAsync();

    assert.equal(storage.has(DIRECT_QUOTE_CACHE_KEY), false);
    assert.equal(storage.has(FUND_METRICS_SNAPSHOT_CACHE_KEY), false);
    assert.equal(result.marketHistoryCleared, false);
    assert.equal(result.navHistoryCleared, true);
  } finally {
    globalThis.window = originalWindow;
    globalThis.indexedDB = originalIndexedDb;
  }
});
