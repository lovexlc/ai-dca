import { createConnection } from 'mysql2/promise';

/* global Response, URL */

const COOKIE_NAME = 'ai_dca_session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const ALLOWED_ORIGINS = new Set([
  'https://freebacktrack.tech',
  'https://cn.freebacktrack.tech:5000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173'
]);

function originHeaders(request) {
  const origin = String(request.headers.get('origin') || '').trim();
  const headers = {
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization, content-type, x-requested-with',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'cache-control': 'no-store',
    vary: 'Origin'
  };
  if (ALLOWED_ORIGINS.has(origin)) headers['access-control-allow-origin'] = origin;
  return headers;
}

function json(request, payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...originHeaders(request),
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders
    }
  });
}

function errorJson(request, message, status = 400, extra = {}) {
  return json(request, { ok: false, message, ...extra }, status);
}

function nowIso() {
  return new Date().toISOString();
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const raw = String(request.headers.get('cookie') || '');
  for (const item of raw.split(';')) {
    const [key, ...rest] = item.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function bearerToken(request, { allowCookie = true } = {}) {
  const authorization = String(request.headers.get('authorization') || '');
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim();
  return allowCookie ? readCookie(request, COOKIE_NAME) : '';
}

async function requireUser(request, env, { allowCookie = true } = {}) {
  const token = bearerToken(request, { allowCookie });
  if (!token || !env.DB) return null;
  const tokenHash = await sha256Hex(token);
  return env.DB.prepare(`SELECT users.id, users.username
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`)
    .bind(tokenHash, nowIso())
    .first();
}

function sessionCookie(token, maxAge = SESSION_MAX_AGE) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;
}

function hyperdriveConfigured(env) {
  return Boolean(env?.HYPERDRIVE?.host && env?.HYPERDRIVE?.user && env?.HYPERDRIVE?.database);
}

async function withDatabase(env, callback) {
  if (!hyperdriveConfigured(env)) {
    const error = new Error('TiDB Hyperdrive is not configured');
    error.status = 503;
    throw error;
  }

  const connection = await createConnection({
    host: env.HYPERDRIVE.host,
    user: env.HYPERDRIVE.user,
    password: env.HYPERDRIVE.password,
    database: env.HYPERDRIVE.database,
    port: Number(env.HYPERDRIVE.port) || 4000,
    disableEval: true
  });

  try {
    return await callback(connection);
  } finally {
    await connection.end().catch(() => {});
  }
}

async function ensureSchema(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_data_state (
      user_id VARCHAR(191) NOT NULL,
      initialized_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (user_id)
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_data_records (
      user_id VARCHAR(191) NOT NULL,
      data_key VARCHAR(120) NOT NULL,
      value_json LONGTEXT NULL,
      revision BIGINT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL,
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (user_id, data_key),
      KEY idx_user_data_records_active (user_id, deleted_at)
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_data_mutations (
      user_id VARCHAR(191) NOT NULL,
      mutation_id VARCHAR(160) NOT NULL,
      result_json LONGTEXT NOT NULL,
      created_at DATETIME(3) NOT NULL,
      PRIMARY KEY (user_id, mutation_id)
    )
  `);
}

function normalizeRecords(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 200)
    .map((record) => ({
      key: String(record?.key || '').trim(),
      value: record?.value == null ? null : String(record.value),
      baseRevision: Number.isSafeInteger(Number(record?.baseRevision)) ? Number(record.baseRevision) : 0
    }))
    .filter((record) => /^[A-Za-z0-9:_-]{1,120}$/.test(record.key));
}

function conflict(message, details = {}) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'REVISION_CONFLICT';
  error.details = details;
  return error;
}

async function bootstrap(env, userId) {
  return withDatabase(env, async (connection) => {
    await ensureSchema(connection);
    await connection.beginTransaction();
    try {
      const [stateRows] = await connection.query(
        'SELECT user_id FROM user_data_state WHERE user_id = ? FOR UPDATE',
        [userId]
      );
      const initialized = stateRows.length > 0;
      if (!initialized) {
        const now = new Date();
        await connection.query(
          'INSERT INTO user_data_state (user_id, initialized_at, updated_at) VALUES (?, ?, ?)',
          [userId, now, now]
        );
      }
      await connection.commit();

      const [rows] = await connection.query(
        `SELECT data_key AS \`key\`, value_json AS value, revision, updated_at AS updatedAt
           FROM user_data_records
          WHERE user_id = ? AND deleted_at IS NULL
          ORDER BY data_key ASC`,
        [userId]
      );
      return {
        initialized,
        records: (rows || []).map((row) => ({
          key: String(row.key),
          value: row.value == null ? null : String(row.value),
          revision: Number(row.revision) || 0,
          updatedAt: row.updatedAt || null
        }))
      };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    }
  });
}

async function writeRecords(env, userId, input) {
  const records = normalizeRecords(input.records);
  if (Array.isArray(input.records) && input.records.length && !records.length) {
    const error = new Error('没有可写入的合法数据记录');
    error.status = 400;
    throw error;
  }
  const mutationId = String(input.mutationId || '').trim().slice(0, 160);

  return withDatabase(env, async (connection) => {
    await ensureSchema(connection);
    await connection.beginTransaction();
    try {
      if (mutationId) {
        const [existing] = await connection.query(
          'SELECT result_json FROM user_data_mutations WHERE user_id = ? AND mutation_id = ? LIMIT 1',
          [userId, mutationId]
        );
        if (existing.length) {
          await connection.commit();
          return JSON.parse(existing[0].result_json);
        }
      }

      const resultRecords = [];
      for (const record of records) {
        const [currentRows] = await connection.query(
          `SELECT revision, value_json, deleted_at
             FROM user_data_records
            WHERE user_id = ? AND data_key = ?
            FOR UPDATE`,
          [userId, record.key]
        );
        const current = currentRows[0] || null;
        const currentRevision = current ? Number(current.revision) || 0 : 0;
        if (currentRevision !== record.baseRevision) {
          throw conflict(`数据记录 ${record.key} 已被其他设备更新`, {
            key: record.key,
            expectedRevision: record.baseRevision,
            actualRevision: currentRevision
          });
        }

        const nextRevision = currentRevision + 1;
        const now = new Date();
        await connection.query(
          `INSERT INTO user_data_records (user_id, data_key, value_json, revision, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             value_json = VALUES(value_json),
             revision = VALUES(revision),
             updated_at = VALUES(updated_at),
             deleted_at = VALUES(deleted_at)`,
          [userId, record.key, record.value, nextRevision, now, record.value == null ? now : null]
        );
        resultRecords.push({ key: record.key, value: record.value, revision: nextRevision });
      }

      const now = new Date();
      await connection.query(
        `INSERT INTO user_data_state (user_id, initialized_at, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
        [userId, now, now]
      );
      const result = {
        records: resultRecords,
        revision: resultRecords.reduce((max, row) => Math.max(max, row.revision), 0)
      };
      if (mutationId) {
        await connection.query(
          'INSERT INTO user_data_mutations (user_id, mutation_id, result_json, created_at) VALUES (?, ?, ?, ?)',
          [userId, mutationId, JSON.stringify(result), now]
        );
      }
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    }
  });
}

function isDatabaseConnectivityError(error) {
  return Boolean(error && !error.status && !error.code?.startsWith('REVISION_'));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: originHeaders(request) });
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/user-data/, '') || '/';

    try {
      if (path === '/health' || path === '/') {
        const configured = hyperdriveConfigured(env);
        if (configured) await withDatabase(env, (connection) => connection.query('SELECT 1'));
        return json(request, {
          ok: true,
          service: 'ai-dca-user-data',
          authority: 'tidb',
          configured
        });
      }

      if (path === '/session/exchange' && request.method === 'POST') {
        const user = await requireUser(request, env, { allowCookie: false });
        if (!user) return errorJson(request, '未登录', 401);
        const token = bearerToken(request, { allowCookie: false });
        return json(request, {
          ok: true,
          user: { userId: user.id, username: user.username }
        }, 200, { 'set-cookie': sessionCookie(token) });
      }

      if (path === '/session/logout' && (request.method === 'POST' || request.method === 'DELETE')) {
        const token = bearerToken(request);
        if (token && env.DB) {
          await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run().catch(() => {});
        }
        return json(request, { ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
      }

      const user = await requireUser(request, env);
      if (!user) return errorJson(request, '未登录', 401);

      if (path === '/session' && request.method === 'GET') {
        return json(request, {
          ok: true,
          user: { userId: user.id, username: user.username }
        });
      }

      if (path === '/bootstrap' && request.method === 'GET') {
        const result = await bootstrap(env, user.id);
        return json(request, {
          ok: true,
          user: { userId: user.id, username: user.username },
          initialized: Boolean(result?.initialized),
          records: Array.isArray(result?.records) ? result.records : []
        });
      }

      if (path === '/records' && (request.method === 'PUT' || request.method === 'POST')) {
        const body = await request.json().catch(() => ({}));
        const records = normalizeRecords(body?.records);
        if (!records.length && Array.isArray(body?.records) && body.records.length) {
          return errorJson(request, '没有可写入的合法数据记录', 400);
        }
        const result = await writeRecords(env, user.id, {
          ...body,
          records
        });
        return json(request, {
          ok: true,
          records: Array.isArray(result?.records) ? result.records : [],
          revision: Number(result?.revision) || 0
        });
      }

      return errorJson(request, 'Not found', 404);
    } catch (error) {
      const status = Number(error?.status) || (isDatabaseConnectivityError(error) ? 502 : 500);
      return errorJson(request, error?.message || '远端数据服务失败', status >= 400 && status < 600 ? status : 500, {
        code: error?.code || (status === 502 ? 'TIDB_CONNECTION_ERROR' : 'REMOTE_DATA_ERROR'),
        ...(error?.details ? { details: error.details } : {})
      });
    }
  }
};
