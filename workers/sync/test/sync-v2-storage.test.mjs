import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { SYNC_V2_ACCOUNT_KEYS } from '../src/index.js';

const BASE = 'https://test.freebacktrack.tech';
const USER_ID = 'usr_v2_test';
const TOKEN = 'token-v2-test';

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createEnv() {
  const state = { sessions: new Map(), syncItems: new Map(), history: [] };
  const DB = {
    prepare(sql) {
      const execute = (args = []) => ({
        async run() {
          if (/^\s*(CREATE TABLE|CREATE INDEX|ALTER TABLE)/i.test(sql)) return { success: true };
          if (/INSERT OR IGNORE INTO sync_v2_items_history/i.test(sql)) {
            state.history.push({
              userId: args[0],
              syncKey: args[1],
              revision: args[2],
              contentHash: args[3],
              encryptedPayload: args[5]
            });
            return { meta: { changes: 1 } };
          }
          if (/INSERT INTO sync_v2_items/i.test(sql)) {
            const [userId, syncKey, revision, contentHash, cipherSha256, encryptedPayload, updatedAt, clientUpdatedAt, deletedAt] = args;
            const mapKey = `${userId}:${syncKey}`;
            if (state.syncItems.has(mapKey)) throw new Error('UNIQUE constraint failed');
            state.syncItems.set(mapKey, { syncKey, revision, contentHash, cipherSha256, encryptedPayload, updatedAt, clientUpdatedAt, deletedAt });
            return { meta: { changes: 1 } };
          }
          if (/UPDATE sync_v2_items/i.test(sql)) {
            const [revision, contentHash, cipherSha256, encryptedPayload, updatedAt, clientUpdatedAt, deletedAt, userId, syncKey, baseRevision] = args;
            const mapKey = `${userId}:${syncKey}`;
            const current = state.syncItems.get(mapKey);
            if (!current || Number(current.revision) !== Number(baseRevision)) return { meta: { changes: 0 } };
            Object.assign(current, { revision, contentHash, cipherSha256, encryptedPayload, updatedAt, clientUpdatedAt, deletedAt });
            return { meta: { changes: 1 } };
          }
          return { success: true };
        },
        async first() {
          if (/FROM sessions JOIN users/i.test(sql)) {
            const userId = state.sessions.get(args[0]);
            return userId ? { id: userId, username: 'v2-test-user' } : null;
          }
          if (/FROM sync_v2_items/i.test(sql)) {
            return state.syncItems.get(`${args[0]}:${args[1]}`) || null;
          }
          return null;
        },
        async all() {
          if (!/FROM sync_v2_items/i.test(sql)) return { results: [] };
          const userId = args[0];
          const keys = /sync_key IN/i.test(sql) ? args.slice(1) : null;
          const results = [...state.syncItems.values()]
            .filter((row) => state.syncItems.has(`${userId}:${row.syncKey}`))
            .filter((row) => !keys || keys.includes(row.syncKey));
          return { results };
        }
      });
      const api = execute([]);
      api.bind = (...args) => execute(args);
      return api;
    }
  };
  return { env: { DB }, state };
}

function request(method, path, { token = TOKEN, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`${BASE}${path}`, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
}

async function authenticatedEnv() {
  const fixture = createEnv();
  fixture.state.sessions.set(await sha256Hex(TOKEN), USER_ID);
  return fixture;
}

function encryptedPayload(overrides = {}) {
  return {
    version: 3,
    source: 'ai-dca-secure-sync-v2',
    crypto: { alg: 'AES-GCM', wrappedDek: 'wrapped', iv: 'iv' },
    meta: { contentHash: 'content-hash' },
    ciphertext: 'ciphertext',
    ...overrides
  };
}

test('V2 Worker authenticates by bearer token and gives each key its own revision', async () => {
  const { env, state } = await authenticatedEnv();
  const productionHost = await worker.fetch(new Request('https://api.freebacktrack.tech/api/sync/v2/items/meta', {
    method: 'GET',
    headers: { authorization: `Bearer ${TOKEN}` }
  }), env);
  assert.equal(productionHost.status, 404);
  const empty = await worker.fetch(request('GET', '/api/sync/v2/items/meta'), env);
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).items, []);

  const plan = await worker.fetch(request('PUT', `/api/sync/v2/items/${encodeURIComponent('aiDcaPlanStore')}`, {
    body: {
      baseRevision: 0,
      contentHash: 'plan-v1',
      encryptedPayload: encryptedPayload({ meta: { contentHash: 'plan-v1' } }),
      clientUpdatedAt: '2026-08-01T00:00:00.000Z'
    }
  }), env);
  assert.equal(plan.status, 200);
  assert.equal((await plan.json()).item.revision, 1);

  const planUpdate = await worker.fetch(request('PUT', `/api/sync/v2/items/${encodeURIComponent('aiDcaPlanStore')}`, {
    body: {
      baseRevision: 1,
      contentHash: 'plan-v2',
      encryptedPayload: encryptedPayload({ meta: { contentHash: 'plan-v2' } }),
      clientUpdatedAt: '2026-08-01T00:01:00.000Z'
    }
  }), env);
  assert.equal(planUpdate.status, 200);
  assert.equal((await planUpdate.json()).item.revision, 2);
  assert.deepEqual(state.history.map((item) => ({ syncKey: item.syncKey, revision: item.revision })), [
    { syncKey: 'aiDcaPlanStore', revision: 1 }
  ]);

  const prefs = await worker.fetch(request('PUT', `/api/sync/v2/items/${encodeURIComponent('aiDcaSwitchStrategyPrefs')}`, {
    body: {
      baseRevision: 0,
      contentHash: 'prefs-v1',
      encryptedPayload: encryptedPayload({ meta: { contentHash: 'prefs-v1' } })
    }
  }), env);
  assert.equal(prefs.status, 200);
  assert.equal((await prefs.json()).item.revision, 1);
  assert.equal(state.syncItems.size, 2);
  assert.deepEqual(SYNC_V2_ACCOUNT_KEYS.includes('aiDcaNotifyClientConfig'), false);
  assert.deepEqual(SYNC_V2_ACCOUNT_KEYS.includes('aiDcaNotifySettings'), true);
  assert.deepEqual(SYNC_V2_ACCOUNT_KEYS.includes('aiDcaHoldingsNotifyRule'), true);
});

test('V2 Worker rejects stale same-key writes and identity spoofing', async () => {
  const { env } = await authenticatedEnv();
  await worker.fetch(request('PUT', '/api/sync/v2/items/aiDcaPlanStore', {
    body: { baseRevision: 0, contentHash: 'one', encryptedPayload: encryptedPayload({ meta: { contentHash: 'one' } }) }
  }), env);
  const stale = await worker.fetch(request('PUT', '/api/sync/v2/items/aiDcaPlanStore', {
    body: { baseRevision: 0, contentHash: 'two', encryptedPayload: encryptedPayload({ meta: { contentHash: 'two' } }) }
  }), env);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'SYNC_V2_REVISION_MISMATCH');

  const spoofed = await worker.fetch(request('PUT', '/api/sync/v2/items/aiDcaPlanStore', {
    body: { baseRevision: 1, userId: 'someone-else', contentHash: 'three', encryptedPayload: encryptedPayload({ meta: { contentHash: 'three' } }) }
  }), env);
  assert.equal(spoofed.status, 400);
  assert.equal((await spoofed.json()).code, 'SYNC_V2_IDENTITY_FIELD_FORBIDDEN');

  const notify = await worker.fetch(request('PUT', '/api/sync/v2/items/aiDcaNotifyClientConfig', {
    body: { baseRevision: 0, contentHash: 'notify', encryptedPayload: encryptedPayload({ meta: { contentHash: 'notify' } }) }
  }), env);
  assert.equal(notify.status, 400);
  assert.equal((await notify.json()).code, 'SYNC_V2_KEY_NOT_ALLOWED');

  const notifySettings = await worker.fetch(request('PUT', '/api/sync/v2/items/aiDcaNotifySettings', {
    body: { baseRevision: 0, contentHash: 'notify-settings', encryptedPayload: encryptedPayload({ meta: { contentHash: 'notify-settings' } }) }
  }), env);
  assert.equal(notifySettings.status, 200);
});

test('V2 Worker returns only requested encrypted items and never stores rememberedKey', async () => {
  const { env } = await authenticatedEnv();
  const put = await worker.fetch(request('PUT', '/api/sync/v2/items/aiDcaPlanStore', {
    body: { baseRevision: 0, contentHash: 'plan', encryptedPayload: encryptedPayload({ meta: { contentHash: 'plan' }, rememberedKey: 'raw-secret' }) }
  }), env);
  assert.equal(put.status, 400);

  await worker.fetch(request('PUT', '/api/sync/v2/items/aiDcaPlanStore', {
    body: { baseRevision: 0, contentHash: 'plan', encryptedPayload: encryptedPayload({ meta: { contentHash: 'plan' } }) }
  }), env);
  await worker.fetch(request('PUT', '/api/sync/v2/items/aiDcaSwitchStrategyPrefs', {
    body: { baseRevision: 0, contentHash: 'prefs', encryptedPayload: encryptedPayload({ meta: { contentHash: 'prefs' } }) }
  }), env);
  const response = await worker.fetch(request('GET', '/api/sync/v2/items?keys=aiDcaPlanStore'), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.items.map((item) => item.syncKey), ['aiDcaPlanStore']);
  assert.equal(data.items[0].encryptedPayload.rememberedKey, undefined);
});
