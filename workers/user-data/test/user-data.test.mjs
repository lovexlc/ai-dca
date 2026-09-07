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

function makeConnection() {
  let initialized = false;
  const records = new Map();
  const mutations = new Map();
  const calls = [];
  return {
    calls,
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async query(sql, args = []) {
      calls.push({ sql: String(sql), args });
      if (/^\s*CREATE TABLE IF NOT EXISTS/i.test(sql)) return [[], []];
      if (/SELECT user_id FROM user_data_state/i.test(sql)) {
        return [initialized ? [{ user_id: args[0] }] : [], []];
      }
      if (/INSERT INTO user_data_state/i.test(sql)) {
        initialized = true;
        return [[], []];
      }
      if (/SELECT data_key AS/i.test(sql)) {
        return [[...records.entries()]
          .filter(([, row]) => !row.deleted_at)
          .map(([key, row]) => ({
            key,
            value: row.value_json,
            revision: row.revision,
            updatedAt: row.updated_at
          })), []];
      }
      if (/SELECT result_json FROM user_data_mutations/i.test(sql)) {
        const value = mutations.get(`${args[0]}:${args[1]}`);
        return [value ? [{ result_json: value }] : [], []];
      }
      if (/SELECT revision, value_json, deleted_at/i.test(sql)) {
        const row = records.get(args[1]);
        return [row ? [row] : [], []];
      }
      if (/INSERT INTO user_data_records/i.test(sql)) {
        const [, key, value, revision, updated_at, deleted_at] = args;
        records.set(key, { value_json: value, revision, updated_at, deleted_at });
        return [[], []];
      }
      if (/INSERT INTO user_data_mutations/i.test(sql)) {
        mutations.set(`${args[0]}:${args[1]}`, args[2]);
        return [[], []];
      }
      throw new Error(`Unhandled SQL in test fake: ${sql}`);
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

function hyperdriveEnv(connection) {
  return {
    DB: makeDb(),
    HYPERDRIVE: {
      host: 'gateway.example.tidbcloud.com',
      user: 'test-user',
      password: 'not-used-in-test',
      database: 'ai_dca_market',
      port: 4000
    },
    __TEST_CONNECTION: async () => connection
  };
}

test('health reports Hyperdrive TiDB authority without exposing credentials', async () => {
  const connection = makeConnection();
  const response = await worker.fetch(request('/api/user-data/health'), {
    HYPERDRIVE: {
      host: 'gateway.example.tidbcloud.com',
      user: 'test-user',
      database: 'ai_dca_market'
    },
    __TEST_CONNECTION: async () => connection
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

test('bootstrap and writes use direct Hyperdrive SQL with server-derived user id', async () => {
  const connection = makeConnection();
  const env = hyperdriveEnv(connection);

  const bootstrap = await worker.fetch(request('/api/user-data/bootstrap', {
    cookie: `ai_dca_session=${encodeURIComponent(TOKEN)}`
  }), env);
  assert.equal(bootstrap.status, 200);
  assert.equal((await bootstrap.json()).initialized, false);

  const write = await worker.fetch(request('/api/user-data/records', {
    method: 'PUT',
    cookie: `ai_dca_session=${encodeURIComponent(TOKEN)}`,
    body: {
      records: [{ key: 'aiDcaPlanStore', value: '{"plans":[]}', baseRevision: 0 }],
      mutationId: 'web:test-1'
    }
  }), env);
  assert.equal(write.status, 200);
  assert.equal((await write.json()).revision, 1);

  const repeated = await worker.fetch(request('/api/user-data/records', {
    method: 'PUT',
    cookie: `ai_dca_session=${encodeURIComponent(TOKEN)}`,
    body: {
      records: [{ key: 'aiDcaPlanStore', value: '{"plans":[]}', baseRevision: 0 }],
      mutationId: 'web:test-1'
    }
  }), env);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).revision, 1);

  assert.ok(connection.calls.some(({ args }) => args.includes('usr_test')));
  assert.equal(connection.calls.some(({ sql }) => sql.includes('TIDB_USER_DATA_URL')), false);
});

test('normalizeRecords preserves tombstones and rejects invalid keys', () => {
  const { normalizeRecords } = worker.__test__;
  assert.deepEqual(normalizeRecords([
    { key: 'aiDcaPlanStore', value: null, baseRevision: 4 },
    { key: 'bad key', value: '{}', baseRevision: 0 }
  ]), [{ key: 'aiDcaPlanStore', value: null, baseRevision: 4 }]);
});
