import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchSwitchStrategyCollections,
  SWITCH_COLLECTIONS_CACHE_KEY
} from '../src/pages/backtest/useSwitchStrategyCollections.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

test('strategy collections reuse the short-lived memory cache after the first fetch', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  let calls = 0;
  globalThis.window = { localStorage: createStorage(), location: { origin: 'https://test.freebacktrack.tech' } };
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ collections: [{ id: 'collection-1' }] }), { status: 200 });
  };

  try {
    const first = await fetchSwitchStrategyCollections({ force: true });
    const second = await fetchSwitchStrategyCollections();
    assert.deepEqual(first, [{ id: 'collection-1' }]);
    assert.deepEqual(second, first);
    assert.equal(calls, 1);
    assert.match(window.localStorage.getItem(SWITCH_COLLECTIONS_CACHE_KEY), /collection-1/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
