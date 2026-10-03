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
// batch 语义与真实 D1 一致：任一语句失败时整体回滚（快照/恢复）。
function makeAuthEnv({ internalToken = INTERNAL_TOKEN } = {}) {
  const state = {
    usersById: new Map(), // id -> row
    usernames: new Map(), // username -> id
    sessions: new Map(), // token_hash -> row
    syncEvents: new Map(), // event_id -> { payload_hash, applied_at }
    batchCalls: [], // 每次 batch 的语句快照，用于原子提交断言
    failNextSessionInsert: false, // 模拟并发下 sessions INSERT 才失败（first() 检查已通过）
  };

  function snapshotState() {
    return {
      usersById: new Map([...state.usersById].map(([k, v]) => [k, structuredClone(v)])),
      usernames: new Map(state.usernames),
      sessions: new Map([...state.sessions].map(([k, v]) => [k, structuredClone(v)])),
      syncEvents: new Map([...state.syncEvents].map(([k, v]) => [k, structuredClone(v)])),
    };
  }

  function restoreState(snapshot) {
    state.usersById = snapshot.usersById;
    state.usernames = snapshot.usernames;
    state.sessions = snapshot.sessions;
    state.syncEvents = snapshot.syncEvents;
  }

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
            if (state.failNextSessionInsert) {
              state.failNextSessionInsert = false;
              throw new Error('UNIQUE constraint failed: sessions.token_hash');
            }
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
      state.batchCalls.push(statements.map((statement) => ({ sql: statement.sql, args: statement.args })));
      const snapshot = snapshotState();
      const results = [];
      try {
        for (const s of statements) results.push(await s.run());
      } catch (err) {
        restoreState(snapshot);
        throw err;
      }
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

test('user.login 携带 session：last_login_at 更新与 session 同一批次原子落库', async () => {
  const { env, state } = makeAuthEnv();
  const reg = await handleInternalAuthSync(internalReq(registerEvent('evt_login_sess_reg')), env);
  assert.equal(reg.status, 200);

  const session = {
    token_hash: 'tok_login_sess_1',
    user_id: 'usr_test_1',
    created_at: '2026-10-03T02:00:00.000Z',
    expires_at: '2026-11-02T02:00:00.000Z',
  };
  const res = await handleInternalAuthSync(
    internalReq(loginEvent('evt_login_sess_1', { last_login_at: '2026-10-03T02:00:00.000Z', session })),
    env
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);

  assert.equal(state.usersById.get('usr_test_1').last_login_at, '2026-10-03T02:00:00.000Z');
  const sessionRow = state.sessions.get('tok_login_sess_1');
  assert.ok(sessionRow, 'login 事件携带的 session 必须写入 D1 sessions');
  assert.equal(sessionRow.user_id, 'usr_test_1');
  assert.equal(sessionRow.created_at, '2026-10-03T02:00:00.000Z');
  assert.equal(sessionRow.expires_at, '2026-11-02T02:00:00.000Z');
  assert.equal(state.syncEvents.has('evt_login_sess_1'), true, '事件必须记录');

  // 用户更新、session 写入、事件记录必须在同一个 batch 中提交（原子性）。
  const batch = state.batchCalls.at(-1);
  assert.equal(batch.length, 3, 'sync_events + users + sessions 必须一次 batch 提交');
  assert.ok(batch.some((statement) => /INSERT INTO sync_events/i.test(statement.sql)));
  assert.ok(batch.some((statement) => /UPDATE users SET last_login_at/i.test(statement.sql)));
  assert.ok(batch.some((statement) => /INSERT INTO sessions/i.test(statement.sql)));
});

test('user.register 携带 session：用户与 session 同一批次原子落库', async () => {
  const { env, state } = makeAuthEnv();
  const session = {
    token_hash: 'tok_reg_sess_1',
    user_id: 'usr_test_1',
    created_at: '2026-10-03T00:00:00.000Z',
    expires_at: '2026-11-02T00:00:00.000Z',
  };
  const res = await handleInternalAuthSync(internalReq(registerEvent('evt_reg_sess_1', { session })), env);
  assert.equal(res.status, 200);

  assert.equal(state.usersById.size, 1);
  assert.equal(state.sessions.get('tok_reg_sess_1')?.user_id, 'usr_test_1');
  assert.equal(state.syncEvents.size, 1);
  const batch = state.batchCalls.at(-1);
  assert.equal(batch.length, 3, 'sync_events + users + sessions 必须一次 batch 提交');
  assert.ok(batch.some((statement) => /INSERT INTO sessions/i.test(statement.sql)));
});

test('缺 payload.session 的旧事件：用户照常应用，sessions 表不写', async () => {
  const { env, state } = makeAuthEnv();
  const reg = await handleInternalAuthSync(internalReq(registerEvent('evt_legacy_reg')), env);
  assert.equal(reg.status, 200);
  const login = await handleInternalAuthSync(internalReq(loginEvent('evt_legacy_login')), env);
  assert.equal(login.status, 200);

  assert.equal(state.usersById.size, 1, '旧格式事件必须继续应用（向前兼容）');
  assert.equal(state.usersById.get('usr_test_1').last_login_at, '2026-10-03T01:00:00.000Z');
  assert.equal(state.sessions.size, 0, '不携带 session 的事件绝不能写 sessions');
  assert.equal(state.syncEvents.size, 2);
  for (const batch of state.batchCalls) {
    assert.equal(
      batch.some((statement) => /INSERT INTO sessions/i.test(statement.sql)),
      false,
      '旧事件的 batch 不得包含 session 写入'
    );
  }
});

test('session 冲突返回 409 时用户与事件一并不落库（应用前原子性）', async () => {
  const { env, state } = makeAuthEnv();
  // 预置同一 token_hash 但不同 expires_at 的 session，触发 applySession 409。
  state.sessions.set('tok_clash_1', {
    token_hash: 'tok_clash_1',
    user_id: 'usr_test_1',
    created_at: '2026-10-01T00:00:00.000Z',
    expires_at: '2026-11-01T00:00:00.000Z',
  });
  const session = {
    token_hash: 'tok_clash_1',
    user_id: 'usr_test_1',
    created_at: '2026-10-03T00:00:00.000Z',
    expires_at: '2026-11-02T00:00:00.000Z',
  };
  const res = await handleInternalAuthSync(internalReq(registerEvent('evt_clash_1', { session })), env);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /会话冲突/);

  // 会话应用失败必须阻止整批提交：用户、事件都不能有部分写入。
  assert.equal(state.usersById.size, 0, '会话冲突时用户不得落库');
  assert.equal(state.syncEvents.size, 0, '会话冲突时事件不得记录');
  assert.equal(state.sessions.size, 1, '预置 session 保持不变');
  assert.equal(state.batchCalls.length, 0, '冲突路径不得提交任何 batch');
});

test('batch 中途 UNIQUE 失败：用户、session、事件全部回滚（提交原子性）', async () => {
  const { env, state } = makeAuthEnv();
  const session = {
    token_hash: 'tok_race_1',
    user_id: 'usr_test_1',
    created_at: '2026-10-03T00:00:00.000Z',
    expires_at: '2026-11-02T00:00:00.000Z',
  };
  // first() 检查已通过（token 不存在），但并发下 INSERT 才冲突。
  state.failNextSessionInsert = true;
  const res = await handleInternalAuthSync(internalReq(registerEvent('evt_race_1', { session })), env);
  assert.equal(res.status, 409, '并发冲突且事件未确认时必须返回 409');

  assert.equal(state.usersById.size, 0, 'batch 失败后用户写入必须回滚');
  assert.equal(state.sessions.size, 0, 'batch 失败后 session 必须回滚');
  assert.equal(state.syncEvents.size, 0, 'batch 失败后事件记录必须回滚');
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
