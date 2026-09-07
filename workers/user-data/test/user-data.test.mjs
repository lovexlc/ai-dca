import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const BASE = 'https://api.freebacktrack.tech';
const TOKEN = 'test-access-token';

function makeDb() {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (/FROM sessions JOIN users/i.test(sql)) {
                return { id: 'usr_test', username: 'test-user' };
              }
              return null;
            },
            async run() {
              return { success: true };
            }
          };
        }
      };
    }
  };
}

function request(path, { method = 'GET', cookie = '', body, origin = 'https://freebacktrack.tech' } = {}) {
  const headers = { origin };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test('health reports TiDB authority without exposing credentials', async () => {
  const response = await worker.fetch(request('/api/user-data/health'), {
    DB: makeDb(),
    TIDB_USER_DATA_URL: 'https://tidb.test/user-data',
    TIDB_USER_DATA_SERVICE_TOKEN: 'service-token'
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'ai-dca-user-data',
    authority: 'tidb',
    configured: true
  });
});

test('session exchange sets an HttpOnly API-domain cookie', async () => {
  const response = await worker.fetch(request('/api/user-data/session/exchange', {
    method: 'POST'
  }), { DB: makeDb() });
  assert.equal(response.status, 401);

  const authorized = new Request(`${BASE}/api/user-data/session/exchange`, {
    method: 'POST',
    headers: {
      origin: 'https://cn.freebacktrack.tech:5000',
      authorization: `Bearer ${TOKEN}`
    }
  });
  const exchanged = await worker.fetch(authorized, { DB: makeDb() });
  assert.equal(exchanged.status, 200);
  assert.match(exchanged.headers.get('set-cookie') || '', /ai_dca_session=/);
  assert.match(exchanged.headers.get('set-cookie') || '', /HttpOnly/);
  assert.match(exchanged.headers.get('set-cookie') || '', /SameSite=None/);
  assert.equal(exchanged.headers.get('access-control-allow-origin'), 'https://cn.freebacktrack.tech:5000');
});

test('bootstrap and writes are delegated with server-derived user id', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://tidb.test/user-data') {
      calls.push({ url: String(url), init });
      const body = JSON.parse(init.body);
      if (body.operation === 'bootstrap') {
        return new Response(JSON.stringify({ initialized: true, records: [{ key: 'aiDcaPlanStore', value: '{}', revision: 3 }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ records: [{ key: 'aiDcaPlanStore', value: '{"plans":[]}', revision: 4 }], revision: 4 }), { status: 200 });
    }
    return previousFetch(url, init);
  };

  try {
    const env = {
      DB: makeDb(),
      TIDB_USER_DATA_URL: 'https://tidb.test/user-data',
      TIDB_USER_DATA_SERVICE_TOKEN: 'service-token'
    };
    const bootstrap = await worker.fetch(request('/api/user-data/bootstrap', {
      cookie: `ai_dca_session=${encodeURIComponent(TOKEN)}`
    }), env);
    assert.equal(bootstrap.status, 200);
    assert.equal((await bootstrap.json()).records[0].revision, 3);

    const write = await worker.fetch(request('/api/user-data/records', {
      method: 'PUT',
      cookie: `ai_dca_session=${encodeURIComponent(TOKEN)}`,
      body: {
        records: [{ key: 'aiDcaPlanStore', value: '{"plans":[]}', baseRevision: 3 }],
        mutationId: 'web:test-1'
      }
    }), env);
    assert.equal(write.status, 200);
    assert.equal((await write.json()).revision, 4);
    assert.equal(calls.length, 2);
    const forwarded = JSON.parse(calls[1].init.body);
    assert.equal(forwarded.userId, 'usr_test');
    assert.equal(calls[1].init.headers['x-canonical-user-id'], 'usr_test');
    assert.equal(calls[1].init.headers.authorization, 'Bearer service-token');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
