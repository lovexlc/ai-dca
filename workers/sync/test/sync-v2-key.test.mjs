import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';

const BASE = 'https://api.freebacktrack.tech';
const USERS = {
  'usr-a': 'alice',
  'usr-b': 'bob'
};

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function documentKey(userId, syncKey) {
  return `${userId}\u0000${syncKey}`;
}

function makeEnv() {
  const state = {
    users: new Map(Object.entries(USERS)),
    sessions: new Map(),
    documents: new Map(),
    changes: [],
    mutations: new Map(),
    nextChangeId: 1
  };

  const DB = {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      const execute = (args = []) => ({
        async run() {
          if (/^(CREATE TABLE|CREATE INDEX|ALTER TABLE)/i.test(normalized)) return { success: true, meta: { changes: 0 } };
          if (/INSERT INTO sync_documents_v2/i.test(normalized)) {
            const [userId, syncKey, revision, contentHash, encryptedPayload, updatedAt, deletedAt] = args;
            state.documents.set(documentKey(userId, syncKey), { syncKey, revision, contentHash, encryptedPayload, updatedAt, deletedAt });
            return { success: true, meta: { changes: 1 } };
          }
          if (/INSERT INTO sync_changes_v2/i.test(normalized)) {
            const [userId, syncKey, revision, operation, contentHash, changedAt] = args;
            state.changes.push({ changeId: state.nextChangeId++, userId, syncKey, revision, operation, contentHash, changedAt });
            return { success: true, meta: { changes: 1 } };
          }
          if (/INSERT OR IGNORE INTO sync_mutations_v2/i.test(normalized)) {
            const [userId, mutationId, resultJson, createdAt] = args;
            const key = documentKey(userId, mutationId);
            if (!state.mutations.has(key)) state.mutations.set(key, { resultJson, createdAt });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        async first() {
          if (/FROM sessions JOIN users/i.test(normalized)) {
            const userId = state.sessions.get(args[0]);
            return userId ? { id: userId, username: state.users.get(userId) } : null;
          }
          if (/FROM sync_mutations_v2 WHERE/i.test(normalized)) {
            const row = state.mutations.get(documentKey(args[0], args[1]));
            return row ? { resultJson: row.resultJson } : null;
          }
          if (/SELECT MAX\(change_id\)/i.test(normalized)) {
            const userChanges = state.changes.filter((change) => change.userId === args[0]);
            return { cursor: userChanges.length ? Math.max(...userChanges.map((change) => change.changeId)) : null };
          }
          if (/FROM sync_documents_v2 WHERE user_id = \? AND sync_key = \?/i.test(normalized)) {
            const row = state.documents.get(documentKey(args[0], args[1]));
            return row ? { ...row } : null;
          }
          return null;
        },
        async all() {
          if (/FROM sync_documents_v2 WHERE user_id = \? ORDER BY/i.test(normalized)) {
            return { results: Array.from(state.documents.entries()).filter(([key]) => key.startsWith(`${args[0]}\u0000`)).map(([, row]) => ({ ...row })).sort((left, right) => left.syncKey.localeCompare(right.syncKey)) };
          }
          if (/FROM sync_documents_v2 WHERE user_id = \? AND sync_key IN/i.test(normalized)) {
            return { results: (args.slice(1).map((syncKey) => state.documents.get(documentKey(args[0], syncKey))).filter(Boolean)).map((row) => ({ ...row })) };
          }
          if (/FROM sync_changes_v2 WHERE/i.test(normalized)) {
            const [userId, since, limit] = args;
            return {
              results: state.changes.filter((change) => change.userId === userId && change.changeId > Number(since)).slice(0, Number(limit)).map((change) => ({ ...change }))
            };
          }
          return { results: [] };
        }
      });
      const statement = execute([]);
      statement.bind = (...args) => execute(args);
      return statement;
    }
  };

  return { env: { DB }, state };
}

async function seedToken(state, token, userId) {
  state.sessions.set(await sha256Hex(token), userId);
}

function request(method, path, { token = '', body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(BASE + path, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
}

function encrypted(marker) {
  return {
    version: 3,
    source: 'ai-dca-secure-sync',
    crypto: { alg: 'AES-GCM', iv: `iv-${marker}`, wrappedDek: 'wrapped', salt: 'salt' },
    meta: {},
    ciphertext: `cipher-${marker}`
  };
}

test('V2 isolates revisions by sync key and derives identity from the token', async () => {
  const { env, state } = makeEnv();
  await seedToken(state, 'token-a', 'usr-a');

  const plan = {
    mutationId: 'mutation-plan-1',
    syncKey: 'aiDcaPlanStore',
    baseRevision: 0,
    contentHash: 'hash-plan-1',
    encryptedPayload: encrypted('plan')
  };
  const holdings = {
    mutationId: 'mutation-holdings-1',
    syncKey: 'aiDcaFundHoldingsLedger',
    baseRevision: 0,
    contentHash: 'hash-holdings-1',
    encryptedPayload: encrypted('holdings')
  };
  const planResponse = await worker.fetch(request('POST', '/api/sync/v2/documents/write', { token: 'token-a', body: plan }), env);
  const holdingsResponse = await worker.fetch(request('POST', '/api/sync/v2/documents/write', { token: 'token-a', body: holdings }), env);
  assert.equal(planResponse.status, 200);
  assert.equal(holdingsResponse.status, 200);
  assert.equal((await planResponse.clone().json()).revision, 1);
  assert.equal((await holdingsResponse.clone().json()).revision, 1);

  const manifest = await worker.fetch(request('GET', '/api/sync/v2/manifest', { token: 'token-a' }), env);
  const manifestBody = await manifest.json();
  assert.deepEqual(manifestBody.documents.map((document) => [document.syncKey, document.revision]), [
    ['aiDcaFundHoldingsLedger', 1],
    ['aiDcaPlanStore', 1]
  ]);

  const changes = await worker.fetch(request('GET', '/api/sync/v2/changes?since=0&limit=100', { token: 'token-a' }), env);
  assert.equal((await changes.json()).changes.length, 2);
});

test('V2 rejects client identity fields, detects same-key conflicts, and is idempotent', async () => {
  const { env, state } = makeEnv();
  await seedToken(state, 'token-a', 'usr-a');
  const first = {
    mutationId: 'mutation-1',
    syncKey: 'aiDcaPlanStore',
    baseRevision: 0,
    contentHash: 'hash-1',
    encryptedPayload: encrypted('one')
  };
  const created = await worker.fetch(request('POST', '/api/sync/v2/documents/write', { token: 'token-a', body: first }), env);
  assert.equal(created.status, 200);
  const beforeRetryChanges = state.changes.length;
  const retry = await worker.fetch(request('POST', '/api/sync/v2/documents/write', { token: 'token-a', body: first }), env);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).idempotent, true);
  assert.equal(state.changes.length, beforeRetryChanges);

  const conflict = await worker.fetch(request('POST', '/api/sync/v2/documents/write', {
    token: 'token-a',
    body: { ...first, mutationId: 'mutation-2', contentHash: 'hash-2' }
  }), env);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'DOCUMENT_REVISION_CONFLICT');

  const identity = await worker.fetch(request('POST', '/api/sync/v2/documents/write', {
    token: 'token-a',
    body: { ...first, mutationId: 'mutation-3', clientId: 'not-an-identity' }
  }), env);
  assert.equal(identity.status, 400);
  assert.equal((await identity.json()).code, 'SYNC_IDENTITY_FIELD_NOT_ALLOWED');
});

test('V2 account rows cannot be read with another account token', async () => {
  const { env, state } = makeEnv();
  await seedToken(state, 'token-a', 'usr-a');
  await seedToken(state, 'token-b', 'usr-b');
  const write = await worker.fetch(request('POST', '/api/sync/v2/documents/write', {
    token: 'token-a',
    body: {
      mutationId: 'mutation-private',
      syncKey: 'aiDcaPlanStore',
      baseRevision: 0,
      contentHash: 'private-hash',
      encryptedPayload: encrypted('private')
    }
  }), env);
  assert.equal(write.status, 200);
  const read = await worker.fetch(request('POST', '/api/sync/v2/documents/read', {
    token: 'token-b',
    body: { syncKeys: ['aiDcaPlanStore'] }
  }), env);
  assert.equal(read.status, 200);
  const body = await read.json();
  assert.equal(body.documents[0].revision, 0);
  assert.equal(body.documents[0].encryptedPayload, null);
});
