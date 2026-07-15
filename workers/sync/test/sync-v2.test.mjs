import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const BASE = 'https://api.freebacktrack.tech';
const USER_ID = 'usr_v2';
const USERNAME = 'sync-v2-user';
const TOKEN = 'tok_v2_access';

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function sampleEnvelope(hash, marker) {
  return {
    version: 3,
    source: 'ai-dca-secure-sync',
    crypto: {
      alg: 'AES-GCM',
      kdf: 'PBKDF2-SHA-256',
      iterations: 310000,
      salt: 'c2FsdA==',
      wrapIv: 'd3JhcEl2',
      wrappedDek: 'd3JhcHBlZERlaw==',
      verifierIv: 'dmVyaWZJdg==',
      verifier: 'dmVyaWZpZXI=',
      iv: 'aXZpdml2'
    },
    meta: { contentHash: hash, keyCount: 1, marker },
    ciphertext: Buffer.from(`cipher-${marker}`).toString('base64')
  };
}

function keyFor(userId, deviceId) {
  return `${userId}\u0000${deviceId}`;
}

function makeEnv({ backup = null } = {}) {
  const state = {
    users: new Map([[USER_ID, USERNAME]]),
    sessions: new Map(),
    accounts: new Map(),
    devices: new Map(),
    leases: new Map(),
    backups: new Map()
  };
  const kv = new Map();
  if (backup) state.backups.set(USER_ID, { ...backup });

  const DB = {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      const execute = (args = []) => ({
        async run() {
          if (/^(CREATE TABLE|CREATE INDEX|ALTER TABLE)/i.test(normalized)) return { meta: { changes: 0 } };

          if (/INSERT OR IGNORE INTO sync_accounts/i.test(normalized)) {
            if (state.accounts.has(args[0])) return { meta: { changes: 0 } };
            const now = args[1];
            state.accounts.set(args[0], {
              userId: args[0],
              migrationStatus: 'migration_pending',
              migrationCompletedAt: '',
              migrationCompletedBy: '',
              createdAt: now,
              updatedAt: args[2]
            });
            return { meta: { changes: 1 } };
          }

          if (/INSERT INTO sync_devices/i.test(normalized)) {
            const [userId, deviceId, deviceType, migrationStatus, localSignature, firstSeenAt, lastSeenAt, completedAt] = args;
            state.devices.set(keyFor(userId, deviceId), { userId, deviceId, deviceType, migrationStatus, localSignature, firstSeenAt, lastSeenAt, completedAt });
            return { meta: { changes: 1 } };
          }

          if (/UPDATE sync_devices SET device_type/i.test(normalized)) {
            const [deviceType, localSignature, lastSeenAt, userId, deviceId] = args;
            const row = state.devices.get(keyFor(userId, deviceId));
            if (row) Object.assign(row, { deviceType, localSignature, lastSeenAt });
            return { meta: { changes: row ? 1 : 0 } };
          }

          if (/UPDATE sync_devices SET migration_status = 'pending'/i.test(normalized)) {
            const [userId, deviceId] = args;
            const row = state.devices.get(keyFor(userId, deviceId));
            if (row) Object.assign(row, { migrationStatus: 'pending', completedAt: '' });
            return { meta: { changes: row ? 1 : 0 } };
          }

          if (/UPDATE sync_devices SET migration_status = 'collecting'/i.test(normalized)) {
            const [lastSeenAt, userId, deviceId] = args;
            const row = state.devices.get(keyFor(userId, deviceId));
            if (row) Object.assign(row, { migrationStatus: 'collecting', lastSeenAt });
            return { meta: { changes: row ? 1 : 0 } };
          }

          if (/UPDATE sync_devices SET migration_status = 'completed'/i.test(normalized)) {
            const [completedAt, lastSeenAt, userId, deviceId] = args;
            const row = state.devices.get(keyFor(userId, deviceId));
            if (row) Object.assign(row, { migrationStatus: 'completed', completedAt, lastSeenAt });
            return { meta: { changes: row ? 1 : 0 } };
          }

          if (/UPDATE sync_accounts SET migration_status = 'completed'/i.test(normalized)) {
            const [completedAt, completedBy, updatedAt, userId] = args;
            const row = state.accounts.get(userId);
            if (row) Object.assign(row, { migrationStatus: 'completed', migrationCompletedAt: completedAt, migrationCompletedBy: completedBy, updatedAt });
            return { meta: { changes: row ? 1 : 0 } };
          }

          if (/INSERT INTO sync_leases/i.test(normalized)) {
            const [userId, deviceId, deviceType, sessionId, tokenHash, acquiredAt, expiresAt] = args;
            if (state.leases.has(userId)) throw new Error('UNIQUE constraint failed: sync_leases.user_id');
            state.leases.set(userId, { userId, deviceId, deviceType, sessionId, tokenHash, acquiredAt, expiresAt });
            return { meta: { changes: 1 } };
          }

          if (/UPDATE sync_leases SET device_id/i.test(normalized)) {
            const [deviceId, deviceType, sessionId, tokenHash, acquiredAt, expiresAt, userId] = args;
            const row = state.leases.get(userId);
            if (row) Object.assign(row, { deviceId, deviceType, sessionId, tokenHash, acquiredAt, expiresAt });
            return { meta: { changes: row ? 1 : 0 } };
          }

          if (/UPDATE sync_leases SET expires_at/i.test(normalized)) {
            const [expiresAt, userId, deviceId, sessionId] = args;
            const row = state.leases.get(userId);
            const changed = row && row.deviceId === deviceId && row.sessionId === sessionId;
            if (changed) row.expiresAt = expiresAt;
            return { meta: { changes: changed ? 1 : 0 } };
          }

          if (/DELETE FROM sync_leases/i.test(normalized)) {
            const [userId, deviceId, sessionId] = args;
            const row = state.leases.get(userId);
            const changed = row && row.deviceId === deviceId && row.sessionId === sessionId;
            if (changed) state.leases.delete(userId);
            return { meta: { changes: changed ? 1 : 0 } };
          }

          if (/UPDATE backups SET version/i.test(normalized)) {
            const [version, updatedAt, keyCount, bytes, contentHash, envelope, cipherSha256, lastEndId, lastEndType,
              userId, baseRevision, leaseUserId, deviceId, sessionId, tokenHash, expiresBefore] = args;
            const row = state.backups.get(userId);
            const lease = state.leases.get(leaseUserId);
            const valid = row
              && Number(row.version) === Number(baseRevision)
              && lease
              && lease.deviceId === deviceId
              && lease.sessionId === sessionId
              && lease.tokenHash === tokenHash
              && Date.parse(lease.expiresAt) > Date.parse(expiresBefore);
            if (!valid) return { meta: { changes: 0 } };
            Object.assign(row, { version, updatedAt, keyCount, bytes, contentHash, envelope, cipherSha256, lastEndId, lastEndType, syncMode: 'v2' });
            return { meta: { changes: 1 } };
          }

          if (/INSERT INTO backups/i.test(normalized)) {
            const [userId, version, kvKey, updatedAt, keyCount, bytes, contentHash, envelope, cipherSha256, lastEndId, lastEndType, syncMode] = args;
            if (state.backups.has(userId)) throw new Error('UNIQUE constraint failed: backups.user_id');
            state.backups.set(userId, { userId, version, kvKey, updatedAt, keyCount, bytes, contentHash, envelope, cipherSha256, lastEndId, lastEndType, syncMode });
            return { meta: { changes: 1 } };
          }

          return { meta: { changes: 0 } };
        },
        async first() {
          if (/FROM sessions JOIN users/i.test(normalized)) {
            const userId = state.sessions.get(args[0]);
            return userId ? { id: userId, username: state.users.get(userId) } : null;
          }
          if (/FROM sync_accounts/i.test(normalized)) return state.accounts.get(args[0]) || null;
          if (/FROM sync_devices/i.test(normalized)) return state.devices.get(keyFor(args[0], args[1])) || null;
          if (/FROM sync_leases/i.test(normalized)) return state.leases.get(args[0]) || null;
          if (/FROM backups WHERE user_id/i.test(normalized)) return state.backups.get(args[0]) || null;
          if (/COUNT\(\*\) AS count/i.test(normalized)) return { count: [...state.devices.values()].filter((row) => row.userId === args[0] && row.migrationStatus !== 'completed').length };
          return null;
        },
        async all() {
          if (/FROM sync_devices/i.test(normalized)) {
            return { results: [...state.devices.values()].filter((row) => row.userId === args[0]) };
          }
          return { results: [] };
        }
      });
      const statement = execute([]);
      statement.bind = (...args) => execute(args);
      return statement;
    }
  };

  const SYNC_BACKUPS = {
    async get(key) { return kv.get(key) || null; },
    async put(key, value) { kv.set(key, value); },
    async delete(key) { kv.delete(key); }
  };
  return { env: { DB, SYNC_BACKUPS }, state, kv };
}

async function seedSession(state) {
  state.sessions.set(await sha256Hex(TOKEN), USER_ID);
}

function req(method, path, { body = null } = {}) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body)
  });
}

test('v2 enforces device migration, single writer takeover, lease fencing and revision CAS', async () => {
  const { env, state } = makeEnv();
  await seedSession(state);

  const registerA = await worker.fetch(req('POST', '/api/sync/v2/devices/register', { body: { deviceId: 'device-a', deviceType: 'PC Web', hasLocalData: false } }), env);
  assert.equal(registerA.status, 200);
  assert.equal((await registerA.json()).device.migrationStatus, 'completed');

  const registerB = await worker.fetch(req('POST', '/api/sync/v2/devices/register', { body: { deviceId: 'device-b', deviceType: 'APP Web', hasLocalData: false } }), env);
  assert.equal(registerB.status, 200);

  const acquireA = await worker.fetch(req('POST', '/api/sync/v2/writer/acquire', { body: { deviceId: 'device-a', deviceType: 'PC Web', sessionId: 'tab-a' } }), env);
  assert.equal(acquireA.status, 200);
  const leaseA = await acquireA.json();

  const first = sampleEnvelope('hash-a', 'a');
  const putA = await worker.fetch(req('PUT', '/api/sync/v2/snapshot', {
    body: { deviceId: 'device-a', sessionId: 'tab-a', writerToken: leaseA.writerToken, baseRevision: 0, end: { id: 'device-a', type: 'PC Web' }, encryptedEnvelope: first }
  }), env);
  assert.equal(putA.status, 200);
  assert.equal((await putA.json()).revision, 1);

  const acquireBBlocked = await worker.fetch(req('POST', '/api/sync/v2/writer/acquire', { body: { deviceId: 'device-b', deviceType: 'APP Web', sessionId: 'tab-b' } }), env);
  assert.equal(acquireBBlocked.status, 409);
  assert.equal((await acquireBBlocked.json()).code, 'WRITER_BUSY');

  const acquireB = await worker.fetch(req('POST', '/api/sync/v2/writer/acquire', { body: { deviceId: 'device-b', deviceType: 'APP Web', sessionId: 'tab-b', takeover: true } }), env);
  assert.equal(acquireB.status, 200);
  const leaseB = await acquireB.json();

  const fencedA = await worker.fetch(req('PUT', '/api/sync/v2/snapshot', {
    body: { deviceId: 'device-a', sessionId: 'tab-a', writerToken: leaseA.writerToken, baseRevision: 1, end: { id: 'device-a', type: 'PC Web' }, encryptedEnvelope: sampleEnvelope('hash-a2', 'old-a') }
  }), env);
  assert.equal(fencedA.status, 409);
  assert.equal((await fencedA.json()).code, 'WRITER_LEASE_LOST');

  const second = sampleEnvelope('hash-b', 'b');
  const putB = await worker.fetch(req('PUT', '/api/sync/v2/snapshot', {
    body: { deviceId: 'device-b', sessionId: 'tab-b', writerToken: leaseB.writerToken, baseRevision: 1, end: { id: 'device-b', type: 'APP Web' }, encryptedEnvelope: second }
  }), env);
  assert.equal(putB.status, 200);
  assert.equal((await putB.json()).revision, 2);

  const staleB = await worker.fetch(req('PUT', '/api/sync/v2/snapshot', {
    body: { deviceId: 'device-b', sessionId: 'tab-b', writerToken: leaseB.writerToken, baseRevision: 1, end: { id: 'device-b', type: 'APP Web' }, encryptedEnvelope: sampleEnvelope('hash-b2', 'stale') }
  }), env);
  assert.equal(staleB.status, 409);
  assert.equal((await staleB.json()).code, 'REVISION_MISMATCH');

  const snapshot = await worker.fetch(req('GET', '/api/sync/v2/snapshot?deviceId=device-a&sessionId=tab-a'), env);
  assert.equal(snapshot.status, 200);
  const snapshotData = await snapshot.json();
  assert.equal(snapshotData.revision, 2);
  assert.equal(snapshotData.writer.deviceId, 'device-b');
  assert.equal(snapshotData.writer.isCurrentDevice, false);
});

test('v2 exposes the old-device pending to collecting migration transition', async () => {
  const legacy = sampleEnvelope('legacy-hash', 'legacy');
  const encoded = JSON.stringify(legacy);
  const { env, state } = makeEnv({
    backup: {
      userId: USER_ID,
      version: 7,
      kvKey: 'backup:' + USER_ID,
      updatedAt: new Date().toISOString(),
      keyCount: 1,
      bytes: encoded.length,
      contentHash: 'legacy-hash',
      envelope: encoded,
      cipherSha256: await sha256Hex(encoded),
      syncMode: 'legacy'
    }
  });
  await seedSession(state);
  const registerOwner = await worker.fetch(req('POST', '/api/sync/v2/devices/register', {
    body: { deviceId: 'migration-owner', deviceType: 'APP Web', hasLocalData: false }
  }), env);
  assert.equal(registerOwner.status, 200);
  assert.equal((await registerOwner.json()).device.migrationStatus, 'completed');
  const acquireOwner = await worker.fetch(req('POST', '/api/sync/v2/writer/acquire', {
    body: { deviceId: 'migration-owner', deviceType: 'APP Web', sessionId: 'owner-tab' }
  }), env);
  assert.equal(acquireOwner.status, 200);
  const ownerLease = await acquireOwner.json();
  const register = await worker.fetch(req('POST', '/api/sync/v2/devices/register', {
    body: { deviceId: 'old-device', deviceType: 'PC Web', hasLocalData: true, localSignature: 'local-old' }
  }), env);
  assert.equal(register.status, 200);
  assert.equal((await register.json()).device.migrationStatus, 'pending');
  const collecting = await worker.fetch(req('POST', '/api/sync/v2/devices/collecting', {
    body: { deviceId: 'old-device' }
  }), env);
  assert.equal(collecting.status, 200);
  assert.equal((await collecting.json()).migrationStatus, 'collecting');
  assert.equal(state.devices.get(keyFor(USER_ID, 'old-device')).migrationStatus, 'collecting');

  const normalAcquire = await worker.fetch(req('POST', '/api/sync/v2/writer/acquire', {
    body: { deviceId: 'old-device', deviceType: 'PC Web', sessionId: 'migration-tab' }
  }), env);
  assert.equal(normalAcquire.status, 409);
  assert.equal((await normalAcquire.json()).code, 'MIGRATION_REQUIRED');

  const blockedMigrationAcquire = await worker.fetch(req('POST', '/api/sync/v2/writer/acquire', {
    body: { deviceId: 'old-device', deviceType: 'PC Web', sessionId: 'migration-tab', migration: true }
  }), env);
  assert.equal(blockedMigrationAcquire.status, 409);
  assert.equal((await blockedMigrationAcquire.json()).code, 'WRITER_BUSY');

  const releaseOwner = await worker.fetch(req('POST', '/api/sync/v2/writer/release', {
    body: { deviceId: 'migration-owner', sessionId: 'owner-tab', writerToken: ownerLease.writerToken }
  }), env);
  assert.equal(releaseOwner.status, 200);

  const migrationAcquire = await worker.fetch(req('POST', '/api/sync/v2/writer/acquire', {
    body: { deviceId: 'old-device', deviceType: 'PC Web', sessionId: 'migration-tab', migration: true }
  }), env);
  assert.equal(migrationAcquire.status, 200);
  const migrationLease = await migrationAcquire.json();
  assert.equal(migrationLease.migration, true);

  const migrationPut = await worker.fetch(req('PUT', '/api/sync/v2/snapshot', {
    body: {
      deviceId: 'old-device',
      sessionId: 'migration-tab',
      writerToken: migrationLease.writerToken,
      baseRevision: 7,
      end: { id: 'old-device', type: 'PC Web' },
      encryptedEnvelope: sampleEnvelope('migration-hash', 'migration')
    }
  }), env);
  assert.equal(migrationPut.status, 200);
  assert.equal((await migrationPut.json()).revision, 8);

  const complete = await worker.fetch(req('POST', '/api/sync/v2/devices/complete', {
    body: { deviceId: 'old-device', accountComplete: false }
  }), env);
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).migrationStatus, 'completed');
  assert.equal(state.devices.get(keyFor(USER_ID, 'old-device')).migrationStatus, 'completed');
});
