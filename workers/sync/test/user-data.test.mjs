import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const BASE = 'https://api.freebacktrack.tech';
const USER_ID = 'usr_resource';
const TOKEN = 'tok_resource';

async function tokenHash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function request(method, path, body = undefined, token = TOKEN) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function makeEnv() {
  const state = { sessions: new Map(), resources: new Map(), mutations: new Map(), migrations: new Map(), accounts: new Map() };
  const kv = new Map();
  const key = (userId, resourceId) => `${userId}:${resourceId}`;
  const mutationKey = (userId, resourceId, mutationId) => `${userId}:${resourceId}:${mutationId}`;
  const DB = {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      const execute = (args = []) => ({
        async run() {
          if (/^(CREATE TABLE|CREATE INDEX|ALTER TABLE)/i.test(normalized)) return { meta: { changes: 0 } };
          if (/INSERT OR IGNORE INTO sync_accounts/i.test(normalized)) {
            if (!state.accounts.has(args[0])) state.accounts.set(args[0], { userId: args[0], migrationStatus: 'migration_pending' });
            return { meta: { changes: 1 } };
          }
          if (/INSERT INTO user_data_resources/i.test(normalized)) {
            const [userId, resourceId, revision, schemaVersion, kvKey, contentHash, cipherSha256, updatedAt, mutationId, bytes] = args;
            state.resources.set(key(userId, resourceId), { userId, resourceId, revision, schemaVersion, kvKey, contentHash, cipherSha256, updatedAt, deleted: 0, mutationId, bytes });
            return { meta: { changes: 1 } };
          }
          if (/UPDATE user_data_resources SET revision/i.test(normalized)) {
            const [revision, schemaVersion, kvKey, contentHash, cipherSha256, updatedAt, mutationId, bytes, userId, resourceId, baseRevision] = args;
            const row = state.resources.get(key(userId, resourceId));
            if (!row || Number(row.revision) !== Number(baseRevision)) return { meta: { changes: 0 } };
            Object.assign(row, { revision, schemaVersion, kvKey, contentHash, cipherSha256, updatedAt, mutationId, bytes, deleted: 0 });
            return { meta: { changes: 1 } };
          }
          if (/UPDATE user_data_resources SET revision = \?, schema_version = \?, kv_key = ''/i.test(normalized)) {
            const [revision, schemaVersion, updatedAt, mutationId, userId, resourceId, baseRevision] = args;
            const row = state.resources.get(key(userId, resourceId));
            if (!row || Number(row.revision) !== Number(baseRevision)) return { meta: { changes: 0 } };
            Object.assign(row, { revision, schemaVersion, updatedAt, mutationId, kvKey: '', contentHash: '', cipherSha256: '', bytes: 0, deleted: 1 });
            return { meta: { changes: 1 } };
          }
          if (/INSERT OR IGNORE INTO user_data_mutations/i.test(normalized)) {
            const [userId, resourceId, mutationId, revision, schemaVersion, kvKey, contentHash, cipherSha256, updatedAt, deleted, bytes] = args;
            state.mutations.set(mutationKey(userId, resourceId, mutationId), { userId, resourceId, mutationId, revision, schemaVersion, kvKey, contentHash, cipherSha256, updatedAt, deleted, bytes });
            return { meta: { changes: 1 } };
          }
          if (/INSERT INTO user_data_migrations/i.test(normalized)) {
            const [userId, deviceId, status, sourceHash, localSignature, completedResources, startedAt, updatedAt, completedAt] = args;
            state.migrations.set(`${userId}:${deviceId}`, { userId, deviceId, status, sourceHash, localSignature, completedResources, startedAt, updatedAt, completedAt });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          if (/FROM sessions JOIN users/i.test(normalized)) {
            const userId = state.sessions.get(args[0]);
            return userId ? { id: userId, username: 'resource-user' } : null;
          }
          if (/FROM sync_accounts/i.test(normalized)) return state.accounts.get(args[0]) || null;
          if (/FROM user_data_resources/i.test(normalized)) return state.resources.get(key(args[0], args[1])) || null;
          if (/FROM user_data_mutations/i.test(normalized)) return state.mutations.get(mutationKey(args[0], args[1], args[2])) || null;
          if (/FROM user_data_migrations/i.test(normalized)) return state.migrations.get(`${args[0]}:${args[1]}`) || null;
          return null;
        },
        async all() {
          if (/FROM user_data_resources/i.test(normalized)) return { results: [...state.resources.values()].filter((row) => row.userId === args[0]) };
          return { results: [] };
        }
      });
      const statement = execute();
      statement.bind = (...args) => execute(args);
      return statement;
    }
  };
  return { env: { DB, SYNC_BACKUPS: { async put(k, v) { kv.set(k, v); }, async get(k) { return kv.get(k) || null; }, async delete(k) { kv.delete(k); } } }, state };
}

function encrypted(marker) {
  return { version: 3, source: 'ai-dca-secure-sync', crypto: { alg: 'AES-GCM', wrappedDek: 'dek', iv: 'iv' }, ciphertext: btoa(`cipher-${marker}`) };
}

test('per-resource API requires auth and rejects unregistered resources', async () => {
  const { env } = makeEnv();
  assert.equal((await worker.fetch(request('GET', '/api/sync/data/manifest', undefined, ''), env)).status, 401);
  const response = await worker.fetch(request('PUT', '/api/sync/data/not-registered', { baseRevision: 0, mutationId: 'm', encrypted: encrypted('x') }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'RESOURCE_NOT_ALLOWED');
});

test('resource PUT is CAS/idempotent and manifest contains only metadata', async () => {
  const { env, state } = makeEnv();
  state.sessions.set(await tokenHash(TOKEN), USER_ID);
  const payload = { baseRevision: 0, mutationId: 'device:m1', schemaVersion: 1, contentHash: 'hash-1', encrypted: encrypted('one') };
  const first = await worker.fetch(request('PUT', '/api/sync/data/aiDcaPlanStore', payload), env);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).revision, 1);
  const repeat = await worker.fetch(request('PUT', '/api/sync/data/aiDcaPlanStore', payload), env);
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).idempotent, true);
  const stale = await worker.fetch(request('PUT', '/api/sync/data/aiDcaPlanStore', { ...payload, mutationId: 'device:m2' }), env);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'RESOURCE_REVISION_MISMATCH');
  const manifest = await worker.fetch(request('GET', '/api/sync/data/manifest'), env);
  const body = await manifest.json();
  assert.equal(manifest.status, 200);
  assert.equal(body.resources[0].revision, 1);
  assert.equal('encrypted' in body.resources[0], false);
});
