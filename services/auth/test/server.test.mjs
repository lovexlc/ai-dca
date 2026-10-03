import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb, closeDb } from '../src/db.js';
import { createApp } from '../src/server.js';

const CLIENT_HASH = 'a'.repeat(64);

describe('server: HTTP endpoints', () => {
  let db;
  let server;
  let base;

  beforeEach(async () => {
    db = openDb(':memory:');
    server = createServer(createApp(db));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    closeDb(db);
  });

  async function post(path, body, raw = false) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw ? body : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json(), headers: res.headers };
  }

  it('GET /health returns ok', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).ok, true);
  });

  it('register then login over HTTP', async () => {
    const reg = await post('/api/sync/auth/register', { username: 'dudu', passwordHash: CLIENT_HASH });
    assert.equal(reg.status, 200);
    assert.ok(reg.json.accessToken.startsWith('acc_'));
    assert.equal(reg.headers.get('access-control-allow-origin'), '*');

    const login = await post('/api/sync/auth/login', { username: 'dudu', passwordHash: CLIENT_HASH });
    assert.equal(login.status, 200);
    assert.ok(login.json.accessToken.startsWith('acc_'));
  });

  it('duplicate register returns 409', async () => {
    await post('/api/sync/auth/register', { username: 'dudu', passwordHash: CLIENT_HASH });
    const dup = await post('/api/sync/auth/register', { username: 'dudu', passwordHash: CLIENT_HASH });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.message, '用户名已存在');
  });

  it('wrong password returns 401', async () => {
    await post('/api/sync/auth/register', { username: 'dudu', passwordHash: CLIENT_HASH });
    const bad = await post('/api/sync/auth/login', { username: 'dudu', passwordHash: 'b'.repeat(64) });
    assert.equal(bad.status, 401);
  });

  it('malformed JSON returns 400', async () => {
    const res = await post('/api/sync/auth/login', '{not json', true);
    assert.equal(res.status, 400);
  });

  it('unknown route returns 404', async () => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  });

  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await fetch(`${base}/api/sync/auth/login`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});
