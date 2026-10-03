import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { enqueueEvent } from './outbox.js';

// Must stay in sync with workers/sync/src/index.js.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const ADMIN_USERNAMES = new Set(['lovexl', 'wanghao0902', 'de88903']);

export function normalizeUsername(username = '') {
  return String(username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 48);
}

export function isAdminUsername(username = '') {
  return ADMIN_USERNAMES.has(String(username || '').trim().toLowerCase());
}

export function sha256Hex(text = '') {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function hashPasswordCredential(clientPasswordHash, salt) {
  return sha256Hex(`${salt}:${clientPasswordHash}`);
}

export function randomId(prefix = '') {
  return `${prefix}${randomBytes(16).toString('hex')}`;
}

export function nowIso() {
  return new Date().toISOString();
}

/**
 * Run fn inside a SQLite transaction. BEGIN IMMEDIATE takes the write lock
 * up front so concurrent writers queue on busy_timeout instead of failing.
 */
export function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Already rolled back or connection broken; surface the original error.
    }
    throw err;
  }
}

function constantTimeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Compare against a same-length buffer to keep timing uniform.
    const dummy = Buffer.alloc(aBuf.length);
    timingSafeEqual(aBuf, dummy);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function validateCredentials(username, clientPasswordHash) {
  const normalized = normalizeUsername(username);
  if (normalized.length < 3) return { error: '用户名至少 3 位', status: 400 };
  if (String(clientPasswordHash || '').length < 32) return { error: '密码不合法', status: 400 };
  return { username: normalized };
}

function createSessionRow(db, user) {
  const accessToken = randomId('acc_');
  const refreshToken = randomId('ref_');
  const tokenHash = sha256Hex(accessToken);
  const now = nowIso();
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(tokenHash, user.id, now, expires);
  return {
    userId: user.id,
    username: user.username,
    accessToken,
    refreshToken,
    expiresAt: expires,
    isAdmin: isAdminUsername(user.username),
    // 供同步事件使用
    _tokenHash: tokenHash,
    _createdAt: now,
  };
}

export function registerUser(db, { username, clientPasswordHash }) {
  const validation = validateCredentials(username, clientPasswordHash);
  if (validation.error) return validation;

  const normalized = validation.username;
  const user = { id: randomId('usr_'), username: normalized };
  const salt = randomId('pwd_');
  const storedHash = hashPasswordCredential(clientPasswordHash, salt);
  const now = nowIso();

  const insertUser = db.prepare(
    'INSERT INTO users (id, username, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );

  let session;
  try {
    withTransaction(db, () => {
      insertUser.run(user.id, normalized, storedHash, salt, now, now);
      session = createSessionRow(db, user);
      enqueueEvent(db, 'user.register', {
        id: user.id,
        username: normalized,
        password_hash: storedHash,
        password_salt: salt,
        created_at: now,
        updated_at: now,
        session: {
          token_hash: session._tokenHash,
          user_id: user.id,
          created_at: session._createdAt,
          expires_at: session.expiresAt,
        },
      });
    });
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE constraint failed')) {
      return { error: '用户名已存在', status: 409 };
    }
    throw err;
  }
  // 移除内部字段，不返回给客户端
  const publicSession = { ...session };
  delete publicSession._tokenHash;
  delete publicSession._createdAt;
  return { ...publicSession, status: 200 };
}

export function loginUser(db, { username, clientPasswordHash }) {
  const validation = validateCredentials(username, clientPasswordHash);
  if (validation.error) return validation;

  const normalized = validation.username;
  const row = db
    .prepare('SELECT id, username, password_hash, password_salt FROM users WHERE username = ?')
    .get(normalized);

  const expectedHash = row ? hashPasswordCredential(clientPasswordHash, row.password_salt || '') : '';
  if (!row || !constantTimeEqual(row.password_hash, expectedHash)) {
    return { error: '用户名或密码不正确', status: 401 };
  }

  let session;
  withTransaction(db, () => {
    session = createSessionRow(db, row);
    enqueueEvent(db, 'user.login', {
      id: row.id,
      username: row.username,
      last_login_at: nowIso(),
      session: {
        token_hash: session._tokenHash,
        user_id: row.id,
        created_at: session._createdAt,
        expires_at: session.expiresAt,
      },
    });
  });
  // 移除内部字段，不返回给客户端
  const publicSession = { ...session };
  delete publicSession._tokenHash;
  delete publicSession._createdAt;
  return { ...publicSession, status: 200 };
}

export function verifySession(db, accessToken) {
  if (!accessToken) return null;
  const tokenHash = sha256Hex(accessToken);
  const row = db
    .prepare(
      `SELECT users.id, users.username
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
    )
    .get(tokenHash, nowIso());
  return row || null;
}
