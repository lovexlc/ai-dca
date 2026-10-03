import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { handleInternalAuthSync } from '../src/internalAuthSync.js';

const BASE = 'https://api.freebacktrack.tech';
const INTERNAL_TOKEN = 'test-internal-sync-token';

function norm(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

// 最小内存 D1 替身：真实执行 UNIQUE 约束，用于冲突与并发测试。
function makeAuthEnv({ internalToken = INTERNAL_TOKEN } = {}) {
  const state = {
    usersById: new Map(), // id -> row
    usernames: new Map(), // username -> id
    sessions: new Map(), // token_hash -> row
    syncEvents: new Map(), // event_id -> { payload_hash, applied_at }
  };

  const DB = {
    prepare(sql) {
      const query = norm(sql);
      const exec = (args = []) => ({
        sql: query,
        args,
        async run() {
          if (/^(CREATE TABLE|CREATE INDEX|ALTER TABLE)/i.test(query)) return { success: true };
          if (/^INSERT INTO sync_events/i.test(query)) {
            const [event_id, payload_hash, applied_at] = args;
            if (state.syncEvents.has(event_id)) {
              throw new Error('UNIQUE constraint failed: sync_events.event_id');
            }
            state.syncEvents.set(event_id, { payload_hash, applied_at });
            return { success: true };
          }
          if (/^INSERT INTO users/i.test(query)) {
            const [id, username, password_hash, password_salt, created_at, updated_at] = args;
            if (state.usersById.has(id)) throw new Error('UNIQUE constraint failed: users.id');
            if (state.usernames.has(username)) throw new Error('UNIQUE constraint failed: users.username');
            state.usersById.set(id, {
              id, username, password_hash, password_salt, created_at, updated_at, last_login_at: '',
            });
            state.usernames.set(username, id);
            return { success: true };
          }
          if (/^INSERT INTO sessions/i.test(query)) {
            const [token_hash, user_id, created_at, expires_at] = args;
            if (state.sessions.has(token_hash)) {
              throw new Error('UNIQUE constraint failed: sessions.token_hash');
            }
            state.sessions.set(token_hash, { token_hash, user_id, created_at, expires_at });
            return { success: true };
          }
          if (/^UPDATE users SET last_login_at/i.test(query)) {
            const [last_login_at, updated_at, id] = args;
            const row = state.usersById.get(id);
            if (row) {
              row.last_login_at = last_login_at;
              row.updated_at = updated_at;
            }
            return { success: true };
          }
          return { success: true };
        },
        async first() {
          if (/FROM sync_events WHERE event_id/i.test(query)) {
            const row = state.syncEvents.get(args[0]);
            return row ? { payload_hash: row.payload_hash } : null;
          }
          if (/FROM users WHERE username = \? OR id = \?/i.test(query)) {
            const [username, id] = args;
            const byName = state.usernames.get(username);
            const row = (byName && state.usersById.get(byName)) || state.usersById.get(id) || null;
            return row
              ? { id: row.id, username: row.username, password_hash: row.password_hash, password_salt: row.password_salt }
              : null;
          }
          if (/FROM users WHERE id = \?/i.test(query)) {
            const row = state.usersById.get(args[0]);
            return row ? { id: row.id, username: row.username } : null;
          }
          if (/FROM users WHERE username = \?/i.test(query)) {
            const id = state.usernames.get(args[0]);
            const row = id ? state.usersById.get(id) : null;
            return row
              ? { id: row.id, username: row.username, password_hash: row.password_hash, password_salt: row.password_salt }
              : null;
          }
          if (/FROM sessions WHERE token_hash = \?/i.test(query)) {
            const row = state.sessions.get(args[0]);
            return row ? { user_id: row.user_id, expires_at: row.expires_at } : null;
          }
          if (/FROM backups WHERE user_id/i.test(query)) return null;
          return null;
        },
        async all() {
          return { results: [] };
        },
      });
      const api = exec([]);
      api.bind = (...args) => exec(args);
      return api;
    },
    async batch(statements) {
      const results = [];
      for (const s of statements) results.push(await s.run());
      return results;
    },
  };

  const env = { DB };
  if (internalToken) env.INTERNAL_SYNC_TOKEN = internalToken;
  return { env, state };
}

function internalReq(body, token = INTERNAL_TOKEN) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`${BASE}/api/sync/internal/sync-auth`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function registerEvent(eventId, userOverrides = {}, extra = {}) {
  return {
    eventId,
    eventType: 'user.register',
    payload: {
      id: 'usr_test_1',
      username: 'synceduser',
      password_hash: 'a'.repeat(64),
      password_salt: 'pwd_salt_1',
      created_at: '2026-10-03T00:00:00.000Z',
      updated_at: '2026-10-03T00:00:00.000Z',
      ...userOverrides,
    },
    ...extra,
  };
}

function loginEvent(eventId, userOverrides = {}) {
  return {
    eventId,
    eventType: 'user.login',
    payload: {
      id: 'usr_test_1',
      username: 'synceduser',
      last_login_at: '2026-10-03T01:00:00.000Z',
      ...userOverrides,
    },
  };
}

test('内部接口：无 Bearer token 返回 401', async () => {
  const { env } = makeAuthEnv();
  const res = await handleInternalAuthSync(internalReq(registerEvent('evt_1'), null), env);
  assert.equal(res.status, 401);
});

test('内部接口：token 错误返回 401', async () => {
  const { env } = makeAuthEnv();
  const res = await handleInternalAuthSync(internalReq(registerEvent('evt_1'), 'wrong-token'), env);
  assert.equal(res.status, 401);
});

test('内部接口：未配置 INTERNAL_SYNC_TOKEN 返回 503', async () => {
  const { env } = makeAuthEnv({ internalToken: '' });
  const res = await handleInternalAuthSync(internalReq(registerEvent('evt_1')), env);
  assert.equal(res.status, 503);
});

test('user.register：首次应用成功，重放返回 deduplicated', async () => {
  const { env, state } = makeAuthEnv();
  const event = registerEvent('evt_dup');
  const res1 = await handleInternalAuthSync(internalReq(event), env);
  assert.equal(res1.status, 200);
  assert.deepEqual(await res1.json(), { ok: true });

  const res2 = await handleInternalAuthSync(internalReq(event), env);
  assert.equal(res2.status, 200);
  assert.deepEqual(await res2.json(), { ok: true, deduplicated: true });

  assert.equal(state.usersById.size, 1);
  assert.equal(state.syncEvents.size, 1);
});

test('user.register：同一 event_id 不同 payload 返回 409', async () => {
  const { env } = makeAuthEnv();
  const res1 = await handleInternalAuthSync(internalReq(registerEvent('evt_conflict')), env);
  assert.equal(res1.status, 200);
  const res2 = await handleInternalAuthSync(
    internalReq(registerEvent('evt_conflict', { password_hash: 'b'.repeat(64) })),
    env
  );
  assert.equal(res2.status, 409);
  assert.match((await res2.json()).error, /payload 冲突/);
});

test('user.register：不同 userId 抢占同一 username 返回 409', async () => {
  const { env, state } = makeAuthEnv();
  const res1 = await handleInternalAuthSync(internalReq(registerEvent('evt_a', { id: 'usr_a' })), env);
  assert.equal(res1.status, 200);
  const res2 = await handleInternalAuthSync(
    internalReq(registerEvent('evt_b', { id: 'usr_b' })),
    env
  );
  assert.equal(res2.status, 409);
  assert.match((await res2.json()).error, /用户名已被占用/);
  assert.equal(state.usersById.size, 1);
});

test('user.register：同 id 同凭证的新事件幂等通过，不重复插入', async () => {
  const { env, state } = makeAuthEnv();
  const res1 = await handleInternalAuthSync(internalReq(registerEvent('evt_first')), env);
  assert.equal(res1.status, 200);
  // 新 event_id，但用户完全相同：应成功且不重复插入
  const res2 = await handleInternalAuthSync(internalReq(registerEvent('evt_second')), env);
  assert.equal(res2.status, 200);
  assert.equal((await res2.json()).ok, true);
  assert.equal(state.usersById.size, 1);
  assert.equal(state.syncEvents.size, 2);
});

test('user.register：同 id 不同 password_hash 拒绝覆盖，返回 409', async () => {
  const { env, state } = makeAuthEnv();
  const res1 = await handleInternalAuthSync(internalReq(registerEvent('evt_orig')), env);
  assert.equal(res1.status, 200);
  const res2 = await handleInternalAuthSync(
    internalReq(registerEvent('evt_replay_attack', { password_hash: 'c'.repeat(64) })),
    env
  );
  assert.equal(res2.status, 409);
  assert.match((await res2.json()).error, /拒绝覆盖/);
  assert.equal(state.usersById.get('usr_test_1').password_hash, 'a'.repeat(64));
});

test('session：重放不延长有效期，不同 expires_at 返回 409', async () => {
  const { env, state } = makeAuthEnv();
  const session = {
    token_hash: 'tok_hash_1',
    user_id: 'usr_test_1',
    created_at: '2026-10-03T00:00:00.000Z',
    expires_at: '2026-11-02T00:00:00.000Z',
  };
  const res1 = await handleInternalAuthSync(
    internalReq(registerEvent('evt_s1', { session })),
    env
  );
  assert.equal(res1.status, 200);
  assert.equal(state.sessions.get('tok_hash_1').expires_at, '2026-11-02T00:00:00.000Z');

  // 试图延长有效期
  const res2 = await handleInternalAuthSync(
    internalReq(
      registerEvent('evt_s2', { session: { ...session, expires_at: '2027-11-02T00:00:00.000Z' } })
    ),
    env
  );
  assert.equal(res2.status, 409);
  assert.equal(state.sessions.get('tok_hash_1').expires_at, '2026-11-02T00:00:00.000Z');

  // 完全一致的 session 重放：幂等通过
  const res3 = await handleInternalAuthSync(
    internalReq(registerEvent('evt_s3', { session })),
    env
  );
  assert.equal(res3.status, 200);
  assert.equal(state.sessions.size, 1);
});

test('user.login：已存在用户更新 last_login_at', async () => {
  const { env, state } = makeAuthEnv();
  const reg = await handleInternalAuthSync(internalReq(registerEvent('evt_reg_for_login')), env);
  assert.equal(reg.status, 200);
  const res = await handleInternalAuthSync(internalReq(loginEvent('evt_login_1')), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  assert.equal(state.usersById.get('usr_test_1').last_login_at, '2026-10-03T01:00:00.000Z');
});

test('user.login：未知用户返回 404', async () => {
  const { env } = makeAuthEnv();
  const res = await handleInternalAuthSync(internalReq(loginEvent('evt_login_ghost')), env);
  assert.equal(res.status, 404);
});

test('内部接口：未知事件类型返回 400', async () => {
  const { env } = makeAuthEnv();
  const res = await handleInternalAuthSync(
    internalReq({ eventId: 'evt_x', eventType: 'user.deleted', payload: {} }),
    env
  );
  assert.equal(res.status, 400);
});

test('公网注册：10 个并发同名注册只有 1 个成功', async () => {
  const { env, state } = makeAuthEnv();
  const body = { username: 'raceuser', passwordHash: 'p'.repeat(64) };
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      worker.fetch(
        new Request(`${BASE}/api/sync/auth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        env
      )
    )
  );
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 200).length, 1);
  assert.equal(statuses.filter((s) => s === 409).length, 9);
  assert.equal(state.usersById.size, 1);
});

test('公网注册/登录：现有行为不受影响', async () => {
  const { env } = makeAuthEnv();
  const regBody = { username: 'normaluser', passwordHash: 'q'.repeat(64) };
  const regRes = await worker.fetch(
    new Request(`${BASE}/api/sync/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(regBody),
    }),
    env
  );
  assert.equal(regRes.status, 200);
  const session = await regRes.json();
  assert.ok(session.accessToken);

  // 重复注册 -> 409
  const dupRes = await worker.fetch(
    new Request(`${BASE}/api/sync/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(regBody),
    }),
    env
  );
  assert.equal(dupRes.status, 409);

  // 登录成功
  const loginRes = await worker.fetch(
    new Request(`${BASE}/api/sync/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(regBody),
    }),
    env
  );
  assert.equal(loginRes.status, 200);

  // 错误密码 -> 401
  const badRes = await worker.fetch(
    new Request(`${BASE}/api/sync/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'normaluser', passwordHash: 'z'.repeat(64) }),
    }),
    env
  );
  assert.equal(badRes.status, 401);
});
