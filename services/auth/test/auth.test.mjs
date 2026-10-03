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

const CLIENT_HASH = 'a'.repeat(64); // 64-char client-side password hash

function freshDb() {
  const db = openDb(':memory:');
  return db;
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
