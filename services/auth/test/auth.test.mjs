import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb } from '../src/db.js';
import {
  registerUser,
  loginUser,
  verifySession,
  hashPasswordCredential,
  sha256Hex,
  normalizeUsername,
  SESSION_TTL_SECONDS,
} from '../src/auth.js';
import { compensateSessions, planSessionCompensation } from '../src/compensateSessions.js';

const CLIENT_HASH = 'a'.repeat(64); // 64-char client-side password hash

function freshDb() {
  const db = openDb(':memory:');
  return db;
}

function countRows(db, sql, ...args) {
  return db.prepare(sql).get(...args).n;
}

/** 模拟修复前代码产生的 session：只落 sessions 表，没有任何事件携带它。 */
function insertBareSession(db, userId, { tokenHash, createdAt, expiresAt }) {
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, createdAt, expiresAt);
}

describe('auth: normalizeUsername', () => {
  it('trims, lowercases and strips illegal chars', () => {
    assert.equal(normalizeUsername('  Dudu_01@test  '), 'dudu_01test');
  });
  it('caps length at 48', () => {
    assert.equal(normalizeUsername('a'.repeat(100)).length, 48);
  });
});

describe('auth: crypto compatibility', () => {
  it('sha256Hex matches known vector', () => {
    assert.equal(
      sha256Hex('hello'),
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });
  it('hashPasswordCredential format salt:clientHash', () => {
    assert.equal(hashPasswordCredential('ch', 's'), sha256Hex('s:ch'));
  });
});

describe('auth: register', () => {
  let db;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => closeDb(db));

  it('registers successfully and returns session', () => {
    const result = registerUser(db, { username: 'dudu', clientPasswordHash: CLIENT_HASH });
    assert.equal(result.status, 200);
    assert.ok(result.userId.startsWith('usr_'));
    assert.equal(result.username, 'dudu');
    assert.ok(result.accessToken.startsWith('acc_'));
    assert.ok(result.refreshToken.startsWith('ref_'));
    assert.ok(result.expiresAt);
    assert.equal(typeof result.isAdmin, 'boolean');

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get('dudu');
    assert.ok(user);
    assert.equal(user.id, result.userId);

    // Session persisted as token hash, not the raw token.
    const tokenHash = sha256Hex(result.accessToken);
    const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
    assert.ok(session);
    assert.equal(session.user_id, result.userId);

    // Outbox event enqueued.
    const events = db.prepare("SELECT * FROM sync_outbox WHERE event_type = 'user.register'").all();
    assert.equal(events.length, 1);
    assert.equal(JSON.parse(events[0].payload).username, 'dudu');
  });

  it('rejects duplicate username with 409', () => {
    const first = registerUser(db, { username: 'dudu', clientPasswordHash: CLIENT_HASH });
    assert.equal(first.status, 200);
    const second = registerUser(db, { username: 'DuDu', clientPasswordHash: CLIENT_HASH });
    assert.equal(second.status, 409);
    assert.equal(second.error, '用户名已存在');
  });

  it('rejects short username and short password hash', () => {
    assert.equal(registerUser(db, { username: 'ab', clientPasswordHash: CLIENT_HASH }).status, 400);
    assert.equal(registerUser(db, { username: 'dudu', clientPasswordHash: 'short' }).status, 400);
  });

  it('marks lovexl as admin', () => {
    const result = registerUser(db, { username: 'lovexl', clientPasswordHash: CLIENT_HASH });
    assert.equal(result.isAdmin, true);
  });

  it('only one of two rapid same-name registrations succeeds', () => {
    const results = [
      registerUser(db, { username: 'race', clientPasswordHash: CLIENT_HASH }),
      registerUser(db, { username: 'race', clientPasswordHash: CLIENT_HASH }),
    ];
    const ok = results.filter((r) => r.status === 200);
    const conflicts = results.filter((r) => r.status === 409);
    assert.equal(ok.length, 1);
    assert.equal(conflicts.length, 1);
  });
});

describe('auth: login', () => {
  let db;
  beforeEach(() => {
    db = freshDb();
    registerUser(db, { username: 'dudu', clientPasswordHash: CLIENT_HASH });
  });
  afterEach(() => closeDb(db));

  it('logs in with correct credentials', () => {
    const result = loginUser(db, { username: 'dudu', clientPasswordHash: CLIENT_HASH });
    assert.equal(result.status, 200);
    assert.ok(result.accessToken.startsWith('acc_'));
    const events = db.prepare("SELECT * FROM sync_outbox WHERE event_type = 'user.login'").all();
    assert.equal(events.length, 1);
  });

  it('rejects wrong password with 401', () => {
    const result = loginUser(db, { username: 'dudu', clientPasswordHash: 'b'.repeat(64) });
    assert.equal(result.status, 401);
    assert.equal(result.error, '用户名或密码不正确');
  });

  it('rejects unknown user with 401 (same as wrong password)', () => {
    const result = loginUser(db, { username: 'ghost', clientPasswordHash: CLIENT_HASH });
    assert.equal(result.status, 401);
  });

  it('username matching is case-insensitive', () => {
    const result = loginUser(db, { username: 'DUDU', clientPasswordHash: CLIENT_HASH });
    assert.equal(result.status, 200);
  });
});

describe('auth: session', () => {
  let db;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => closeDb(db));

  it('session expires 30 days after creation', () => {
    const result = registerUser(db, { username: 'dudu', clientPasswordHash: CLIENT_HASH });
    const expiresAt = Date.parse(result.expiresAt);
    const expected = Date.now() + SESSION_TTL_SECONDS * 1000;
    assert.ok(Math.abs(expiresAt - expected) < 5000, `expiresAt drift too large`);
    assert.equal(SESSION_TTL_SECONDS, 2592000);
  });

  it('verifySession accepts a live token and rejects expired ones', () => {
    const result = registerUser(db, { username: 'dudu', clientPasswordHash: CLIENT_HASH });
    const user = verifySession(db, result.accessToken);
    assert.ok(user);
    assert.equal(user.username, 'dudu');

    assert.equal(verifySession(db, 'acc_' + '0'.repeat(32)), null);

    // Expire the session manually.
    const tokenHash = sha256Hex(result.accessToken);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .run(new Date(Date.now() - 1000).toISOString(), tokenHash);
    assert.equal(verifySession(db, result.accessToken), null);
  });
});

describe('auth: outbox 事件携带 session 快照', () => {
  let db;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => closeDb(db));

  function readEventPayload(eventType) {
    const rows = db.prepare('SELECT payload FROM sync_outbox WHERE event_type = ?').all(eventType);
    assert.equal(rows.length, 1, `${eventType} 事件必须恰好入队一次`);
    return JSON.parse(rows[0].payload);
  }

  it('user.register 事件携带与 sessions 行完全一致的 session，且不含原始 token', () => {
    const result = registerUser(db, { username: 'dudu', clientPasswordHash: CLIENT_HASH });
    assert.equal(result.status, 200);
    const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256Hex(result.accessToken));
    assert.ok(row, '返回的 accessToken 必须已按 hash 落库');

    const payload = readEventPayload('user.register');
    assert.ok(payload.session && typeof payload.session === 'object', '注册事件必须携带 payload.session');
    assert.equal(payload.session.token_hash, row.token_hash);
    assert.equal(payload.session.user_id, row.user_id);
    assert.equal(payload.session.user_id, result.userId);
    assert.equal(payload.session.created_at, row.created_at, '事件 created_at 必须复用建行时的时间');
    assert.equal(payload.session.expires_at, row.expires_at, '事件 expires_at 必须复用建行时的到期时间');
    assert.equal(payload.session.expires_at, result.expiresAt, '事件到期时间不得另行重算');
    assert.deepEqual(
      Object.keys(payload.session).sort(),
      ['created_at', 'expires_at', 'token_hash', 'user_id'],
      'session 快照只允许同步所需字段'
    );
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes(result.accessToken), false, '原始 accessToken 不得进入同步事件');
    assert.equal(serialized.includes(result.refreshToken), false, '原始 refreshToken 不得进入同步事件');
  });

  it('user.login 事件携带与 sessions 行完全一致的 session，且不含原始 token', () => {
    registerUser(db, { username: 'dudu', clientPasswordHash: CLIENT_HASH });
    const login = loginUser(db, { username: 'dudu', clientPasswordHash: CLIENT_HASH });
    assert.equal(login.status, 200);
    const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256Hex(login.accessToken));
    assert.ok(row);

    const payload = readEventPayload('user.login');
    assert.ok(payload.session && typeof payload.session === 'object');
    assert.equal(payload.session.token_hash, row.token_hash);
    assert.equal(payload.session.user_id, row.user_id);
    assert.equal(payload.session.created_at, row.created_at);
    assert.equal(payload.session.expires_at, row.expires_at);
    assert.equal(payload.session.expires_at, login.expiresAt);
    assert.deepEqual(Object.keys(payload.session).sort(), ['created_at', 'expires_at', 'token_hash', 'user_id']);
    assert.equal(JSON.stringify(payload).includes(login.accessToken), false);
    assert.equal(JSON.stringify(payload).includes(login.refreshToken), false);
  });

  it('事件中的 session 固定 30 天到期：expires_at - created_at 等于 SESSION_TTL_SECONDS', () => {
    registerUser(db, { username: 'dudu', clientPasswordHash: CLIENT_HASH });
    const payload = readEventPayload('user.register');
    const drift = Date.parse(payload.session.expires_at) - Date.parse(payload.session.created_at);
    assert.ok(
      Math.abs(drift - SESSION_TTL_SECONDS * 1000) < 50,
      `事件 session 有效期必须是固定 30 天，实际偏移 ${drift}ms`
    );
  });
});

describe('auth: 冲突与失败的写入原子性', () => {
  let db;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => closeDb(db));

  it('409 冲突的重复注册不留下任何 session 行或同步事件', () => {
    const first = registerUser(db, { username: 'dudu', clientPasswordHash: CLIENT_HASH });
    assert.equal(first.status, 200);
    const sessionsBefore = countRows(db, 'SELECT COUNT(*) AS n FROM sessions');
    const eventsBefore = countRows(db, 'SELECT COUNT(*) AS n FROM sync_outbox');

    const second = registerUser(db, { username: 'DuDu', clientPasswordHash: CLIENT_HASH });
    assert.equal(second.status, 409);

    // 注册事务必须整体回滚：既没有多余 session，也没有携带别人 session 的事件。
    assert.equal(countRows(db, 'SELECT COUNT(*) AS n FROM sessions'), sessionsBefore);
    assert.equal(countRows(db, 'SELECT COUNT(*) AS n FROM sync_outbox'), eventsBefore);
  });

  it('密码错误的登录不产生 session 行或 user.login 事件', () => {
    registerUser(db, { username: 'dudu', clientPasswordHash: CLIENT_HASH });
    const failed = loginUser(db, { username: 'dudu', clientPasswordHash: 'b'.repeat(64) });
    assert.equal(failed.status, 401);
    assert.equal(countRows(db, 'SELECT COUNT(*) AS n FROM sessions'), 1, '失败登录不得创建 session');
    assert.equal(
      countRows(db, "SELECT COUNT(*) AS n FROM sync_outbox WHERE event_type = 'user.login'"),
      0,
      '失败登录不得入队事件'
    );
  });
});

describe('auth: 存量 session 幂等补偿', () => {
  let db;
  let userId;
  beforeEach(() => {
    db = freshDb();
    const registered = registerUser(db, { username: 'dudu', clientPasswordHash: CLIENT_HASH });
    userId = registered.userId;
  });
  afterEach(() => closeDb(db));

  function insertLegacySession(tokenHash, { createdAt, expiresAt } = {}) {
    const created = createdAt || new Date(Date.now() - 3600 * 1000).toISOString();
    const expires = expiresAt || new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    insertBareSession(db, userId, { tokenHash, createdAt: created, expiresAt: expires });
    return { tokenHash, created, expires };
  }

  it('dry-run 只计划未被在途事件携带的存量 session，且不写任何表', () => {
    const legacy = insertLegacySession('legacyhash0000000000000000000000000000');
    const result = compensateSessions(db, { dryRun: true });

    assert.equal(result.dryRun, true);
    assert.equal(result.plannedCount, 1, '只应计划修复前遗留的 bare session');
    assert.equal(result.planned[0].session.token_hash, legacy.tokenHash);
    assert.equal(result.planned[0].session.user_id, userId);
    assert.equal(result.planned[0].session.created_at, legacy.created);
    assert.equal(result.planned[0].session.expires_at, legacy.expires);
    assert.equal(result.skippedInFlightCount, 1, '新代码路径注册的事件仍在 outbox，其 session 应跳过');
    assert.equal(countRows(db, 'SELECT COUNT(*) AS n FROM sync_outbox'), 1, 'dry-run 不得写入新事件');
    assert.equal(
      db.prepare("SELECT value FROM sync_state WHERE key = 'session_compensated_before'").get()?.value ?? '',
      '',
      'dry-run 不得写高水位'
    );
  });

  it('执行补偿为每个存量 session 入队全新 user.login 事件并写高水位；重复运行幂等', () => {
    const legacy = insertLegacySession('legacyhash0000000000000000000000000000');
    // 模拟历史注册事件已被 worker 消费（新代码路径的 session 也不在在途集合里）。
    db.prepare('DELETE FROM sync_outbox').run();

    const result = compensateSessions(db, {});
    assert.equal(result.plannedCount, 2, '存量 bare session 与已消费事件的 session 都应补偿');
    assert.equal(countRows(db, "SELECT COUNT(*) AS n FROM sync_outbox WHERE event_type = 'user.login'"), 2);

    const rows = db.prepare('SELECT event_id, payload FROM sync_outbox').all();
    const payloads = rows.map((row) => {
      assert.ok(row.event_id.startsWith('evt_cs_'), '补偿事件必须使用全新 event_id');
      return JSON.parse(row.payload);
    });
    const newestLoginAt = payloads[0].last_login_at;
    for (const payload of payloads) {
      assert.equal(payload.id, userId);
      assert.equal(payload.username, 'dudu');
      assert.ok(payload.session.token_hash);
      assert.equal(payload.session.user_id, userId);
      assert.equal(newestLoginAt, payload.last_login_at, '同一用户多条补偿事件的 last_login_at 必须一致');
    }
    const plannedHashes = new Set(payloads.map((p) => p.session.token_hash));
    assert.ok(plannedHashes.has(legacy.tokenHash));

    const watermark = db.prepare("SELECT value FROM sync_state WHERE key = 'session_compensated_before'").get();
    assert.ok(Date.parse(watermark.value) > 0, '执行后必须写入高水位');

    // 高水位之后没有新 session：重复运行必须幂等，不再入队。
    const second = compensateSessions(db, {});
    assert.equal(second.plannedCount, 0);
    assert.equal(countRows(db, 'SELECT COUNT(*) AS n FROM sync_outbox'), 2);
  });

  it('已过期或已被在途事件携带的 session 不进入补偿计划', () => {
    insertLegacySession('expiredhash00000000000000000000000000000', {
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });
    const inFlight = insertLegacySession('inflighthash000000000000000000000000000');
    // 在途检查按事件 payload.session.token_hash 命中：插入一条 pending 事件携带该 hash。
    db.prepare(
      `INSERT INTO sync_outbox (event_id, event_type, payload, status, retry_count, next_attempt_at, created_at)
       VALUES ('evt_inflight_probe', 'user.login', ?, 'pending', 0, ?, ?)`
    ).run(JSON.stringify({ session: { token_hash: inFlight.tokenHash, user_id: userId } }), new Date().toISOString(), new Date().toISOString());

    const { planned, skippedInFlight } = planSessionCompensation(db, {});
    assert.equal(planned.length, 0, '过期与在途 session 都不应计划');
    assert.equal(skippedInFlight.length, 2, '在途探针事件与注册事件携带的 session 都应跳过');
    assert.ok(skippedInFlight.includes(inFlight.tokenHash));
  });
});
