import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';
import { __internals } from '../../../src/app/authClient.js';

const BASE = 'https://test.freebacktrack.tech';

function createEnv() {
  const state = {
    users: new Map(),
    sessions: new Map(),
    attempts: new Map()
  };
  const DB = {
    prepare(sql) {
      const execute = (args = []) => ({
        async run() {
          if (/^\s*(CREATE TABLE|CREATE INDEX)/i.test(sql)) return { success: true };
          if (/INSERT INTO users/i.test(sql)) {
            const [id, username, passwordHash, passwordSalt, createdAt, updatedAt] = args;
            state.users.set(username, { id, username, passwordHash, passwordSalt, createdAt, updatedAt });
            return { meta: { changes: 1 } };
          }
          if (/INSERT INTO sessions/i.test(sql)) {
            const [tokenHash, userId, createdAt, expiresAt] = args;
            state.sessions.set(tokenHash, { userId, createdAt, expiresAt });
            return { meta: { changes: 1 } };
          }
          if (/UPDATE users SET/i.test(sql)) {
            const [passwordHash, passwordSalt, updatedAt, userId] = args;
            const user = [...state.users.values()].find((item) => item.id === userId);
            if (user) Object.assign(user, { passwordHash, passwordSalt, updatedAt });
            return { meta: { changes: user ? 1 : 0 } };
          }
          if (/INSERT INTO auth_login_attempts/i.test(sql)) {
            const [attemptKey, username, ip, failedCount, lockedUntil, updatedAt] = args;
            state.attempts.set(attemptKey, { attemptKey, username, ip, failedCount, lockedUntil, updatedAt });
            return { meta: { changes: 1 } };
          }
          if (/DELETE FROM sessions WHERE token_hash/i.test(sql)) {
            const changed = state.sessions.delete(args[0]);
            return { meta: { changes: changed ? 1 : 0 } };
          }
          if (/DELETE FROM sessions WHERE user_id/i.test(sql)) {
            let changes = 0;
            for (const [tokenHash, session] of state.sessions) {
              if (session.userId !== args[0]) continue;
              state.sessions.delete(tokenHash);
              changes += 1;
            }
            return { meta: { changes } };
          }
          if (/DELETE FROM auth_login_attempts/i.test(sql)) {
            let changes = 0;
            for (const key of args) if (state.attempts.delete(key)) changes += 1;
            return { meta: { changes } };
          }
          return { success: true };
        },
        async first() {
          if (/SELECT password_salt AS passwordSalt FROM users WHERE username/i.test(sql)) {
            const user = state.users.get(args[0]);
            return user ? { passwordSalt: user.passwordSalt } : null;
          }
          if (/SELECT id FROM users WHERE username/i.test(sql)) {
            const user = state.users.get(args[0]);
            return user ? { id: user.id } : null;
          }
          if (/SELECT id, username, password_hash AS passwordHash/i.test(sql)) {
            const user = state.users.get(args[0]);
            return user ? { id: user.id, username: user.username, passwordHash: user.passwordHash, passwordSalt: user.passwordSalt } : null;
          }
          if (/SELECT password_hash AS passwordHash, password_salt AS passwordSalt FROM users WHERE id/i.test(sql)) {
            const user = [...state.users.values()].find((item) => item.id === args[0]);
            return user ? { passwordHash: user.passwordHash, passwordSalt: user.passwordSalt } : null;
          }
          if (/FROM sessions JOIN users/i.test(sql)) {
            const session = state.sessions.get(args[0]);
            const user = session && new Date(session.expiresAt).getTime() > Date.now()
              ? [...state.users.values()].find((item) => item.id === session.userId)
              : null;
            return user ? { id: user.id, username: user.username } : null;
          }
          if (/SELECT failed_count AS failedCount FROM auth_login_attempts/i.test(sql)) {
            const row = state.attempts.get(args[0]);
            return row ? { failedCount: row.failedCount } : null;
          }
          return null;
        },
        async all() {
          if (/FROM auth_login_attempts WHERE attempt_key IN/i.test(sql)) {
            return { results: args.map((key) => state.attempts.get(key)).filter(Boolean) };
          }
          return { results: [] };
        }
      });
      const api = execute([]);
      api.bind = (...args) => execute(args);
      return api;
    }
  };
  return { env: { DB }, state };
}

function request(method, path, { body, token = '', ip = '198.51.100.10' } = {}) {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body)
  });
}

async function jsonResponse(response) {
  return { status: response.status, data: await response.json() };
}

test('auth uses salted PBKDF2 credentials, throttles failures, and revokes sessions', async () => {
  const { env, state } = createEnv();
  const challengeResponse = await worker.fetch(request('POST', '/api/sync/auth/challenge', { body: { username: 'Alice', purpose: 'register' } }), env);
  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json();
  const credential = await __internals.deriveLoginCredential('password-123', challenge.salt, challenge.iterations);

  const registered = await jsonResponse(await worker.fetch(request('POST', '/api/sync/auth/register', {
    body: { username: 'Alice', passwordCredential: credential, passwordSalt: challenge.salt }
  }), env));
  assert.equal(registered.status, 200);
  assert.equal(registered.data.refreshToken, undefined);
  assert.ok(registered.data.expiresAt);
  const stored = state.users.get('alice');
  assert.notEqual(stored.passwordHash, credential);
  assert.equal(JSON.parse(stored.passwordSalt).version, 2);

  const loginChallenge = await (await worker.fetch(request('POST', '/api/sync/auth/challenge', { body: { username: 'alice', purpose: 'login' } }), env)).json();
  const loginCredential = await __internals.deriveLoginCredential('password-123', loginChallenge.salt, loginChallenge.iterations);
  const loggedIn = await jsonResponse(await worker.fetch(request('POST', '/api/sync/auth/login', {
    body: { username: 'alice', passwordCredential: loginCredential }
  }), env));
  assert.equal(loggedIn.status, 200);

  state.attempts.set('username:alice', { failedCount: 4, lockedUntil: '', username: 'alice', ip: 'unknown', updatedAt: new Date().toISOString() });
  state.attempts.set('ip:198.51.100.10', { failedCount: 4, lockedUntil: '', username: 'alice', ip: '198.51.100.10', updatedAt: new Date().toISOString() });
  const bad = await jsonResponse(await worker.fetch(request('POST', '/api/sync/auth/login', {
    body: { username: 'alice', passwordCredential: '0'.repeat(64) }
  }), env));
  assert.equal(bad.status, 401);
  const locked = await jsonResponse(await worker.fetch(request('POST', '/api/sync/auth/login', {
    body: { username: 'alice', passwordCredential: loginCredential }
  }), env));
  assert.equal(locked.status, 429);

  const changeChallenge = await (await worker.fetch(request('POST', '/api/sync/auth/challenge', { body: { username: 'alice', purpose: 'change' } }), env)).json();
  const newCredential = await __internals.deriveLoginCredential('new-password-456', 'new-client-salt', changeChallenge.iterations);
  const changed = await jsonResponse(await worker.fetch(request('POST', '/api/sync/auth/change-password', {
    token: loggedIn.data.accessToken,
    body: { currentCredential: loginCredential, newCredential, newPasswordSalt: 'new-client-salt' }
  }), env));
  assert.equal(changed.status, 200);
  assert.notEqual(changed.data.accessToken, loggedIn.data.accessToken);

  const oldSession = await worker.fetch(request('GET', '/api/sync/v2/items/meta', { token: loggedIn.data.accessToken }), env);
  assert.equal(oldSession.status, 401);
  const logout = await jsonResponse(await worker.fetch(request('POST', '/api/sync/auth/logout', { token: changed.data.accessToken }), env));
  assert.equal(logout.status, 200);
  const protectedResponse = await worker.fetch(request('GET', '/api/sync/v2/items/meta', { token: changed.data.accessToken }), env);
  assert.equal(protectedResponse.status, 401);
});
