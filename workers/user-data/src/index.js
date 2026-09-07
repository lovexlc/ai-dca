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

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function callTiDB(env, operation, user, body = {}) {
  const endpoint = String(env.TIDB_USER_DATA_URL || '').trim();
  const serviceToken = String(env.TIDB_USER_DATA_SERVICE_TOKEN || '').trim();
  if (!endpoint || !serviceToken) {
    const error = new Error('TiDB user-data service is not configured');
    error.status = 503;
    throw error;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceToken}`,
      'content-type': 'application/json',
      'x-canonical-user-id': String(user.id)
    },
    body: JSON.stringify({
      operation,
      userId: String(user.id),
      username: String(user.username || ''),
      ...body
    })
  });
  const data = await readResponseBody(response);
  if (!response.ok) {
    const error = new Error(data?.message || `TiDB user-data service failed: HTTP ${response.status}`);
    error.status = response.status >= 500 ? 502 : response.status;
    error.data = data;
    throw error;
  }
  return data;
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: originHeaders(request) });
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/user-data/, '') || '/';

    try {
      if (path === '/health' || path === '/') {
        return json(request, {
          ok: true,
          service: 'ai-dca-user-data',
          authority: 'tidb',
          configured: Boolean(env.TIDB_USER_DATA_URL && env.TIDB_USER_DATA_SERVICE_TOKEN)
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
        const result = await callTiDB(env, 'bootstrap', user);
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
        const result = await callTiDB(env, 'write', user, {
          mode: body?.mode === 'legacy-import' ? 'legacy-import' : 'write',
          mutationId: String(body?.mutationId || '').trim().slice(0, 160),
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
      const status = Number(error?.status) || 500;
      return errorJson(request, error?.message || '远端数据服务失败', status >= 400 && status < 600 ? status : 500, {
        code: error?.data?.code || (status === 409 ? 'REMOTE_CONFLICT' : 'REMOTE_DATA_ERROR')
      });
    }
  }
};
