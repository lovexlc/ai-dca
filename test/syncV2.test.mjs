import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeForSync, mergeSyncValues } from '../src/app/syncV2/syncAdapters.js';
import { createSyncCryptoContext, decryptSyncDocument, encryptSyncDocument } from '../src/app/syncV2/syncCrypto.js';

function installStorage(seed = {}) {
  const memory = new Map(Object.entries(seed));
  const sessionMemory = new Map();
  globalThis.window = {
    localStorage: {
      getItem(key) { return memory.has(key) ? memory.get(key) : null; },
      setItem(key, value) { memory.set(key, String(value)); },
      removeItem(key) { memory.delete(key); }
    },
    sessionStorage: {
      getItem(key) { return sessionMemory.has(key) ? sessionMemory.get(key) : null; },
      setItem(key, value) { sessionMemory.set(key, String(value)); },
      removeItem(key) { sessionMemory.delete(key); }
    }
  };
  return memory;
}

test('holdings adapter removes derived market snapshots before hashing', () => {
  const value = normalizeForSync('aiDcaFundHoldingsLedger', JSON.stringify({
    transactions: [{ id: 'tx-1' }],
    switchChains: [],
    snapshotsByCode: { '513100': { latestNav: 1 } },
    lastNavMeta: { source: 'quote' }
  }));
  const parsed = JSON.parse(value);
  assert.deepEqual(parsed.transactions, [{ id: 'tx-1' }]);
  assert.equal('snapshotsByCode' in parsed, false);
  assert.equal('lastNavMeta' in parsed, false);
});

test('plan and watchlist adapters merge different entities within one key', () => {
  const plan = mergeSyncValues(
    'aiDcaPlanStore',
    JSON.stringify({ activePlanId: 'p-remote', plans: [{ id: 'p-remote', name: 'remote' }] }),
    JSON.stringify({ activePlanId: 'p-local', plans: [{ id: 'p-local', name: 'local' }] })
  );
  assert.deepEqual(JSON.parse(plan).plans.map((item) => item.id).sort(), ['p-local', 'p-remote']);

  const watchlist = mergeSyncValues(
    'markets:watchlist:v1',
    JSON.stringify({ activeListId: 'list-1', lists: [{ id: 'list-1', us: ['QQQ'], cn: [] }] }),
    JSON.stringify({ activeListId: 'list-1', lists: [{ id: 'list-1', us: [], cn: ['513100'] }] })
  );
  const mergedList = JSON.parse(watchlist).lists.find((item) => item.id === 'list-1');
  assert.deepEqual(mergedList.us, ['QQQ']);
  assert.deepEqual(mergedList.cn, ['513100']);
});

test('each V2 document gets a fresh IV while reusing the unlocked account key', async () => {
  installStorage();
  const initial = createSyncCryptoContext({ session: { userId: 'usr-1', username: 'alice' }, securityPassword: 'password-123', rememberDevice: false });
  const first = await encryptSyncDocument('aiDcaPlanStore', '{"plans":[]}', initial);
  const second = await encryptSyncDocument('aiDcaDcaStore', '{"plans":[]}', first.context);
  assert.equal(first.encryptedPayload.version, 3);
  assert.notEqual(first.encryptedPayload.crypto.iv, second.encryptedPayload.crypto.iv);
  assert.equal(first.encryptedPayload.crypto.wrappedDek, second.encryptedPayload.crypto.wrappedDek);

  const decrypted = await decryptSyncDocument('aiDcaDcaStore', second.encryptedPayload, first.context);
  assert.equal(decrypted.value, '{"plans":[]}');
  assert.equal(memoryValue('aiDcaSecureSyncRememberedKey'), null);
});

test('unremembered account key survives a tab refresh through session storage only', async () => {
  installStorage();
  const session = { userId: 'usr-refresh', username: 'refresh-user' };
  const first = await encryptSyncDocument('aiDcaPlanStore', '{"plans":[1]}', createSyncCryptoContext({ session, securityPassword: 'password-123', rememberDevice: false }));
  const refreshed = createSyncCryptoContext({ session, securityPassword: '', rememberDevice: false });
  assert.equal(refreshed.rawKey, first.context.rawKey);
  assert.equal(memoryValue('aiDcaSecureSyncRememberedKey'), null);
});

function memoryValue(key) {
  return globalThis.window?.localStorage?.getItem(key) || null;
}
