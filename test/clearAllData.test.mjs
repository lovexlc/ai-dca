import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAllBrowserDataAsync } from '../src/app/clearAllData.js';

function makeStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] || null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
    values
  };
}

test('clearAllBrowserDataAsync clears all localStorage data by default', async (t) => {
  const originalWindow = globalThis.window;
  const originalCaches = globalThis.caches;
  const localStorage = makeStorage({
    aiDcaFundHoldingsLedger: 'holdings',
    aiDcaCloudSyncSession: 'session',
    aiDcaAnalyticsEvents_v1: 'analytics',
    ph_project_posthog: 'posthog'
  });
  const sessionStorage = makeStorage({ draft: 'temporary' });
  const deletedCaches = [];
  globalThis.window = { localStorage, sessionStorage };
  globalThis.caches = {
    async keys() { return ['ai-dca-static-assets-v1', 'unrelated-cache']; },
    async delete(name) { deletedCaches.push(name); return true; }
  };
  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.caches = originalCaches;
  });

  const result = await clearAllBrowserDataAsync({ preserveAnalytics: false });

  assert.equal(localStorage.getItem('aiDcaFundHoldingsLedger'), null);
  assert.equal(localStorage.getItem('aiDcaCloudSyncSession'), null);
  assert.equal(localStorage.getItem('aiDcaAnalyticsEvents_v1'), null);
  assert.equal(localStorage.getItem('ph_project_posthog'), null);
  assert.equal(sessionStorage.length, 0);
  assert.deepEqual(deletedCaches, ['ai-dca-static-assets-v1']);
  assert.equal(result.analyticsPreserved, false);
});

test('clearAllBrowserDataAsync can preserve analytics when explicitly requested', async (t) => {
  const originalWindow = globalThis.window;
  const originalCaches = globalThis.caches;
  const localStorage = makeStorage({ aiDcaAnalyticsEvents_v1: 'analytics' });
  globalThis.window = { localStorage, sessionStorage: makeStorage() };
  globalThis.caches = { async keys() { return []; }, async delete() { return true; } };
  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.caches = originalCaches;
  });

  const result = await clearAllBrowserDataAsync({ preserveAnalytics: true });
  assert.equal(localStorage.getItem('aiDcaAnalyticsEvents_v1'), 'analytics');
  assert.equal(result.analyticsPreserved, true);
});
