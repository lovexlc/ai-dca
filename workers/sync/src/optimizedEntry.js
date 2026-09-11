import legacyWorker from './index.js';

const ADMIN_USERNAMES = new Set(['lovexl', 'wanghao0902', 'de88903']);
const DEFAULT_SECTIONS = ['overview', 'traffic', 'pages', 'activity', 'recent'];

function corsHeaders(origin = '*') {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400'
  };
}

function json(payload, { status = 200, origin = '*', serverTiming = '' } = {}) {
  const headers = { ...corsHeaders(origin), 'content-type': 'application/json; charset=utf-8' };
  if (serverTiming) headers['server-timing'] = serverTiming;
  return new Response(JSON.stringify(payload), { status, headers });
}

async function sha256Hex(text = '') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function requireAdmin(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(`SELECT users.id, users.username
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`)
    .bind(tokenHash, new Date().toISOString()).first();
  if (!row || !ADMIN_USERNAMES.has(String(row.username || '').trim().toLowerCase())) return null;
  return row;
}

async function safeFirst(env, sql, ...params) {
  try {
    return await env.DB.prepare(sql).bind(...params).first();
  } catch {
    return null;
  }
}

async function safeAll(env, sql, ...params) {
  try {
    const result = await env.DB.prepare(sql).bind(...params).all();
    return result?.results || [];
  } catch {
    return [];
  }
}

async function handleAnalyticsDiagnostics(request, env, origin) {
  const startedAt = Date.now();
  const user = await requireAdmin(request, env);
  if (!user) return json({ message: '未登录或无管理员权限' }, { status: 401, origin });
  const authMs = Date.now() - startedAt;
  const cutoff31 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const queryStartedAt = Date.now();
  const [summary, range, types, pageCountRow, pageSizeRow] = await Promise.all([
    safeFirst(env, `SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN event_date >= ? THEN 1 END) AS retained31Days,
      COUNT(CASE WHEN session_id = 'notify-worker'
        OR id LIKE 'worker:switch\\_%' ESCAPE '\\'
        OR type IN ('switch_worker_run','switch_notification_triggered','switch_notification_delivery')
        THEN 1 END) AS nonUserEvents,
      COUNT(CASE WHEN NOT (session_id = 'notify-worker'
        OR id LIKE 'worker:switch\\_%' ESCAPE '\\'
        OR type IN ('switch_worker_run','switch_notification_triggered','switch_notification_delivery'))
        THEN 1 END) AS userEvents,
      COUNT(DISTINCT NULLIF(user_id, '')) AS registeredUsers,
      COUNT(DISTINCT NULLIF(visitor_id, '')) AS visitors
      FROM analytics_events`, cutoff31),
    safeFirst(env, 'SELECT MIN(event_date) AS earliestDate, MAX(event_date) AS latestDate FROM analytics_events'),
    safeAll(env, `SELECT type, COUNT(*) AS count
      FROM analytics_events
      GROUP BY type
      ORDER BY count DESC
      LIMIT 20`),
    safeFirst(env, 'PRAGMA page_count'),
    safeFirst(env, 'PRAGMA page_size')
  ]);
  const queryMs = Date.now() - queryStartedAt;
  const pageCount = Number(pageCountRow?.page_count) || 0;
  const pageSize = Number(pageSizeRow?.page_size) || 0;
  const totalMs = Date.now() - startedAt;
  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    rows: {
      total: Number(summary?.total) || 0,
      retained31Days: Number(summary?.retained31Days) || 0,
      userEvents: Number(summary?.userEvents) || 0,
      nonUserEvents: Number(summary?.nonUserEvents) || 0
    },
    identities: {
      registeredUsers: Number(summary?.registeredUsers) || 0,
      visitors: Number(summary?.visitors) || 0
    },
    range: range || { earliestDate: '', latestDate: '' },
    estimatedDatabaseBytes: pageCount * pageSize,
    topEventTypes: types.map((row) => ({ type: String(row.type || ''), count: Number(row.count) || 0 })),
    timingMs: { auth: authMs, query: queryMs, total: totalMs }
  }, {
    origin,
    serverTiming: `auth;dur=${authMs}, diagnostics;dur=${queryMs}, total;dur=${totalMs}`
  });
}

function sectionRequest(request, section) {
  const url = new URL(request.url);
  url.searchParams.set('sections', section);
  return new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  });
}

async function loadAnalyticsInParallel(request, env, context, origin) {
  const startedAt = Date.now();
  const sectionNames = DEFAULT_SECTIONS;
  const responses = await Promise.all(sectionNames.map((section) => (
    legacyWorker.fetch(sectionRequest(request, section), env, context)
  )));
  const failed = responses.find((response) => !response.ok);
  if (failed) return failed;
  const payloads = await Promise.all(responses.map((response) => response.json()));
  const bySection = Object.fromEntries(sectionNames.map((section, index) => [section, payloads[index]]));
  const overview = bySection.overview || {};
  const totalMs = Date.now() - startedAt;
  return json({
    ...overview,
    partial: false,
    sections: sectionNames,
    daily: bySection.traffic?.daily || [],
    pages: bySection.pages?.pages || [],
    userActivity: bySection.pages?.userActivity || [],
    hourlyActivity: bySection.activity?.hourlyActivity || [],
    dailyActivity: bySection.activity?.dailyActivity || [],
    recent: bySection.recent?.recent || []
  }, { origin, serverTiming: `analytics_parallel;dur=${totalMs}` });
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '*';
    if (request.method === 'GET' && url.pathname === '/api/sync/admin/analytics/diagnostics') {
      return handleAnalyticsDiagnostics(request, env, origin);
    }
    if (request.method === 'GET' && url.pathname === '/api/sync/admin/analytics' && !url.searchParams.get('sections')) {
      return loadAnalyticsInParallel(request, env, context, origin);
    }
    return legacyWorker.fetch(request, env, context);
  },
  async scheduled(controller, env, context) {
    return legacyWorker.scheduled(controller, env, context);
  }
};
