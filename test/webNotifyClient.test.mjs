import { test } from 'node:test';
import assert from 'node:assert/strict';

function installBrowser(seed = {}) {
  const memory = new Map(Object.entries(seed));
  const storage = {
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) { memory.set(key, String(value)); },
    removeItem(key) { memory.delete(key); },
    clear() { memory.clear(); }
  };
  globalThis.window = { localStorage: storage };
  return memory;
}

async function freshImport() {
  return import(`../src/app/webNotifyClient.js?cb=${Date.now()}${Math.random()}`);
}

test('web notification account switch syncs separately from the device read cursor', async () => {
  const memory = installBrowser({
    aiDcaWebNotifyConfig: JSON.stringify({ pcEnabled: true }),
    aiDcaWebNotifyDeviceState: JSON.stringify({ lastSeenEventId: 'event-a' })
  });
  const mod = await freshImport();

  assert.deepEqual(mod.readWebNotifyConfig(), { pcEnabled: true, lastSeenEventId: 'event-a' });
  mod.persistWebNotifyConfig({ pcEnabled: false, lastSeenEventId: 'event-b' });

  assert.deepEqual(JSON.parse(memory.get('aiDcaWebNotifyConfig')), { pcEnabled: false });
  assert.deepEqual(JSON.parse(memory.get('aiDcaWebNotifyDeviceState')), { lastSeenEventId: 'event-b' });
});
