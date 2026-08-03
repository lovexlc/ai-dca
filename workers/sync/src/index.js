const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const ANALYTICS_RETENTION_DAYS = 31;
const ANALYTICS_CLEANUP_BATCH_SIZE = 5000;
const ANALYTICS_CLEANUP_MAX_BATCHES = 12;
const FEATURE_PREFIXES = [
  { prefix: 'holdings', label: '持仓管理' },
  { prefix: 'markets', label: '行情中心' },
  { prefix: 'dca_calculator', label: 'DCA 回测' },
  { prefix: 'dca', label: '定投计划' },
  { prefix: 'sell_plan', label: '卖出计划' },
  { prefix: 'new_plan', label: '新建策略' },
  { prefix: 'trade_plans', label: '交易计划' },
  { prefix: 'switch_strategy', label: '切换策略' },
  { prefix: 'fund_switch_analysis', label: '切换分析' },
  { prefix: 'fund_switch', label: '基金切换' },
  { prefix: 'notify', label: '消息通知' },
  { prefix: 'vix', label: 'VIX 面板' },
  { prefix: 'premium', label: '高级版' }
];
const ADMIN_USERNAMES = new Set(['lovexl', 'wanghao0902', 'de88903']);
const BACKGROUND_EVENT_WHERE = "json_extract(meta, '$.reason') = 'switch-cron'";
export const USER_EVENT_WHERE = "COALESCE(json_extract(meta, '$.reason'), '') <> 'switch-cron'";

import {
  buildMissingFeeClause,
  feeRowToAdminItem,
  normalizeFundAdminPatch,
  normalizeFundCode,
  parseFeeJson
} from './fundAdmin.js';

function isAdminUsername(username = '') {
  return ADMIN_USERNAMES.has(String(username || '').trim().toLowerCase());
}

const ADMIN_ANALYTICS_SECTIONS = new Set([
  'overview',
  'traffic',
  'pages',
  'activity',
  'background',
  'engagement',
  'survey',
  'featureDetails',
  'recent'
]);

const SYNC_V2_ACCOUNT_KEYS = Object.freeze([
  'aiDcaFundHoldingsLedger',
  'aiDcaAccountAllocationSettings',
  'aiDcaTradeLedger',
  'aiDcaTradeLedgerArchive',
  'aiDcaAccumulationState',
  'aiDcaPlanStore',
  'aiDcaDcaStore',
  'aiDcaSellPlanStore',
  'aiDcaSwitchStrategyPrefs',
  'aiDcaNotifySettings',
  'aiDcaWebNotifyConfig',
  'aiDcaMarketAlerts',
  'aiDcaHoldingAlerts',
  'aiDcaHoldingsNotifyRule',
  'aiDcaSwitchStrategyWorkerConfig',
  'aiDcaWorkspacePrefs',
  'aiDcaHomeDashboardState',
  'markets:watchlist:v1'
]);
export { SYNC_V2_ACCOUNT_KEYS };
const SYNC_V2_ACCOUNT_KEY_SET = new Set(SYNC_V2_ACCOUNT_KEYS);
const SYNC_V2_TABLE = 'sync_v2_items';

function isSyncV2TestRequest(request, env) {
  if (String(env?.SYNC_V2_ENABLED || '').toLowerCase() === 'true') return true;
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === 'test.freebacktrack.tech' || hostname.startsWith('test.');
}

function parseAdminAnalyticsSections(value = '') {
  const sections = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => ADMIN_ANALYTICS_SECTIONS.has(item));
  return new Set(sections);
}

function corsHeaders(origin = '*') {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,PUT,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400'
  };
}

function json(payload, { status = 200, origin = '*' } = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json; charset=utf-8' }
  });
}

function nowIso() { return new Date().toISOString(); }

export function analyticsRetentionCutoffDate(nowMs = Date.now()) {
  const keepDays = Math.max(1, ANALYTICS_RETENTION_DAYS - 1);
  return new Date(Number(nowMs) - keepDays * 86400000).toISOString().slice(0, 10);
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function getShanghaiDayBounds(nowMs = Date.now()) {
  const timestamp = Number(nowMs);
  const date = new Date(Number.isFinite(timestamp) ? timestamp : Date.now());
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const startMs = Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS;
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + 86400000).toISOString()
  };
}

function normalizeClientIds(clientIds) {
  return Array.from(new Set((Array.isArray(clientIds) ? clientIds : [])
    .map((clientId) => String(clientId || '').trim().slice(0, 120))
    .filter(Boolean)));
}

export async function queryTodaySwitchSummary(env, { nowMs = Date.now(), clientIds = null } = {}) {
  const bounds = getShanghaiDayBounds(nowMs);
  const hasClientFilter = Array.isArray(clientIds);
  const normalizedClientIds = normalizeClientIds(clientIds);
  if (hasClientFilter && !normalizedClientIds.length) {
    return {
      ...bounds,
      triggerCount: 0,
      strategyCount: 0
    };
  }

  const bindings = ['switch_notification_triggered', bounds.startAt, bounds.endAt];
  let clientClause = '';
  if (hasClientFilter) {
    clientClause = ` AND json_extract(meta, '$.clientId') IN (${normalizedClientIds.map(() => '?').join(', ')})`;
    bindings.push(...normalizedClientIds);
  }
  const row = await env.DB.prepare(`SELECT
    COUNT(*) AS triggerCount,
    COUNT(DISTINCT CASE
      WHEN COALESCE(json_extract(meta, '$.clientId'), '') != ''
        AND COALESCE(json_extract(meta, '$.ruleId'), '') != ''
        THEN json_extract(meta, '$.clientId') || ':' || json_extract(meta, '$.ruleId')
      ELSE id
    END) AS strategyCount
    FROM analytics_events
    WHERE type = ? AND created_at >= ? AND created_at < ?${clientClause}`).bind(...bindings).first();

  return {
    ...bounds,
    triggerCount: Math.max(0, Number(row?.triggerCount) || 0),
    strategyCount: Math.max(0, Number(row?.strategyCount) || 0)
  };
}

export async function handleSwitchTodaySummaryGet(request, env, origin) {
  const url = new URL(request.url);
  const personal = url.searchParams.get('scope') === 'personal';
  if (personal) {
    const user = await requireUser(request, env);
    if (!user) return json({ message: '未登录' }, { status: 401, origin });
  }
  const requestedClientIds = personal
    ? [
      ...url.searchParams.getAll('clientId'),
      ...String(url.searchParams.get('clientIds') || '').split(',')
    ]
    : null;
  const summary = await queryTodaySwitchSummary(env, { clientIds: requestedClientIds });
  return json({
    ok: true,
    scope: personal ? 'personal' : 'public',
    todayTriggeredStrategyCount: summary.strategyCount,
    todayTriggerCount: summary.triggerCount,
    dateKey: summary.dateKey,
    startAt: summary.startAt,
    endAt: summary.endAt,
    generatedAt: nowIso()
  }, { origin });
}

export async function pruneOldAnalyticsEvents(env, nowMs = Date.now(), options = {}) {
  const cutoff = analyticsRetentionCutoffDate(nowMs);
  const batchSize = Math.max(
    1,
    Math.min(
      Number(options.batchSize) || ANALYTICS_CLEANUP_BATCH_SIZE,
      ANALYTICS_CLEANUP_BATCH_SIZE,
    ),
  );
  const maxBatches = Math.max(
    1,
    Math.min(
      Number(options.maxBatches) || ANALYTICS_CLEANUP_MAX_BATCHES,
      ANALYTICS_CLEANUP_MAX_BATCHES,
    ),
  );
  let deleted = 0;
  let batches = 0;
  let lastBatchDeleted = 0;

  while (batches < maxBatches) {
    const result = await env.DB.prepare(`DELETE FROM analytics_events
      WHERE id IN (
        SELECT id FROM analytics_events
        WHERE event_date < ?
        ORDER BY event_date ASC, created_at ASC
        LIMIT ?
      )`).bind(cutoff, batchSize).run();
    const batchDeleted = Number(result?.meta?.changes) || 0;
    lastBatchDeleted = batchDeleted;
    deleted += batchDeleted;
    batches += 1;

    if (batchDeleted < batchSize) break;
  }

  return {
    cutoff,
    deleted,
    batches,
    hitBatchLimit: batches >= maxBatches && lastBatchDeleted >= batchSize,
  };
}

function normalizeUsername(username = '') {
  return String(username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 48);
}

function randomId(prefix = '') {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}${hex}`;
}

async function sha256Hex(text = '') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

async function ensureSchema(env) {
  if (!env.DB) throw new Error('D1 binding DB missing');
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    visitor_id TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}'
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_events_date_type ON analytics_events (event_date, type)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_events_date_created ON analytics_events (event_date, created_at DESC)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_events_type_created ON analytics_events (type, created_at DESC)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${SYNC_V2_TABLE} (
    user_id TEXT NOT NULL,
    sync_key TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    content_hash TEXT NOT NULL DEFAULT '',
    cipher_sha256 TEXT NOT NULL DEFAULT '',
    encrypted_payload TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    client_updated_at TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, sync_key)
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sync_v2_items_user_updated
    ON ${SYNC_V2_TABLE} (user_id, updated_at DESC)`).run();
}

async function hashPasswordCredential(passwordHash, salt) {
  return sha256Hex(`${salt}:${passwordHash}`);
}

async function createSession(env, user) {
  const accessToken = randomId('acc_');
  const refreshToken = randomId('ref_');
  const tokenHash = await sha256Hex(accessToken);
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, user.id, nowIso(), expires).run();
  return { userId: user.id, username: user.username, accessToken, refreshToken, expiresAt: expires, isAdmin: isAdminUsername(user.username) };
}

async function requireUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(`SELECT users.id, users.username
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`)
    .bind(tokenHash, nowIso()).first();
  return row || null;
}


async function handleTrackAnalytics(request, env, origin) {
  const body = await readBody(request);
  const events = Array.isArray(body?.events) ? body.events.slice(0, 50) : [body];
  const cutoff = analyticsRetentionCutoffDate();
  let accepted = 0;
  for (const rawEvent of events) {
    if (!rawEvent || typeof rawEvent !== 'object') continue;
    const id = String(rawEvent.id || randomId('evt_')).slice(0, 96);
    const type = String(rawEvent.type || '').trim().slice(0, 64);
    if (!type) continue;
    const createdAt = String(rawEvent.createdAt || nowIso()).slice(0, 40);
    const eventDate = String(rawEvent.date || createdAt.slice(0, 10) || nowIso().slice(0, 10)).slice(0, 10);
    if (eventDate < cutoff) continue;
    await env.DB.prepare(`INSERT OR IGNORE INTO analytics_events
      (id, type, user_id, username, visitor_id, session_id, path, event_date, created_at, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        id,
        type,
        String(rawEvent.userId || '').slice(0, 96),
        normalizeUsername(rawEvent.username || ''),
        String(rawEvent.visitorId || '').slice(0, 120),
        String(rawEvent.sessionId || '').slice(0, 120),
        String(rawEvent.path || '').slice(0, 500),
        eventDate,
        createdAt,
        JSON.stringify(rawEvent.meta || {}).slice(0, 4000)
      ).run();
    accepted += 1;
  }
  if (!accepted) return json({ message: 'missing event type' }, { status: 400, origin });
  return json({ ok: true, accepted }, { origin });
}

async function handleAdminAnalytics(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  if (!isAdminUsername(user.username)) return json({ message: '无管理员权限' }, { status: 403, origin });
  const url = new URL(request.url);
  const rangeDays = Math.max(1, Math.min(Number(url.searchParams.get('rangeDays')) || 30, ANALYTICS_RETENTION_DAYS));
  const since = new Date(Date.now() - (rangeDays - 1) * 86400000).toISOString().slice(0, 10);
  const requestedSections = parseAdminAnalyticsSections(url.searchParams.get('sections') || '');
  const isPartialRequest = requestedSections.size > 0;
  const wants = (...sections) => !isPartialRequest || sections.some((section) => requestedSections.has(section));
  const recentUnknownSince = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const usersRow = wants('overview') ? await env.DB.prepare('SELECT COUNT(*) AS total FROM users').first() : null;
  const visitorUsersRow = wants('overview') ? await env.DB.prepare(`SELECT
    COUNT(DISTINCT visitor_id) AS total
    FROM analytics_events
    WHERE visitor_id != ''
      AND COALESCE(NULLIF(user_id, ''), NULLIF(username, ''), '') = ''`).first() : null;
  const cardsRows = wants('overview', 'background') ? await env.DB.prepare(`SELECT
    COUNT(CASE WHEN ${USER_EVENT_WHERE} AND type = 'page_view' THEN 1 END) AS pv,
    COUNT(DISTINCT CASE WHEN ${USER_EVENT_WHERE} AND type = 'page_view' THEN visitor_id END) AS uv,
    COUNT(CASE WHEN ${USER_EVENT_WHERE} AND type = 'ai_used' THEN 1 END) AS aiEvents,
    COUNT(DISTINCT CASE WHEN ${USER_EVENT_WHERE} AND type = 'ai_used' THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS aiUsers,
    COUNT(CASE WHEN ${USER_EVENT_WHERE} AND type IN ('notify_enabled','notify_used') THEN 1 END) AS notifyEvents,
    COUNT(DISTINCT CASE WHEN ${USER_EVENT_WHERE} AND type IN ('notify_enabled','notify_used') THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS notifyUsers,
    COUNT(CASE WHEN ${USER_EVENT_WHERE} AND type = 'switch_worker_run' THEN 1 END) AS switchRuns,
    COUNT(DISTINCT CASE WHEN ${USER_EVENT_WHERE} AND type = 'switch_worker_run' THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS switchUsers,
    COUNT(CASE WHEN ${USER_EVENT_WHERE} THEN 1 END) AS userEvents,
    COUNT(DISTINCT CASE WHEN ${USER_EVENT_WHERE} THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS userBehaviorUsers,
    COUNT(CASE WHEN ${BACKGROUND_EVENT_WHERE} THEN 1 END) AS backgroundEvents,
    COUNT(DISTINCT CASE WHEN ${BACKGROUND_EVENT_WHERE} THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS backgroundUsers,
    COUNT(CASE WHEN ${BACKGROUND_EVENT_WHERE} AND type = 'switch_worker_run' THEN 1 END) AS backgroundTaskRuns
    FROM analytics_events WHERE event_date >= ?`).bind(since).first() : null;
  const overviewDailyActiveRows = wants('overview') ? await env.DB.prepare(`SELECT
    event_date AS date,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), NULLIF(visitor_id, ''))) AS activeUsers
    FROM analytics_events
    WHERE event_date >= ?
      AND COALESCE(NULLIF(user_id, ''), NULLIF(visitor_id, '')) IS NOT NULL
      AND ${USER_EVENT_WHERE}
    GROUP BY event_date ORDER BY event_date`).bind(since).all() : { results: [] };
  const dailyRows = wants('traffic') ? await env.DB.prepare(`SELECT event_date AS date,
    COUNT(CASE WHEN ${USER_EVENT_WHERE} AND type = 'page_view' THEN 1 END) AS pv,
    COUNT(DISTINCT CASE WHEN ${USER_EVENT_WHERE} AND type = 'page_view' THEN visitor_id END) AS uv,
    COUNT(DISTINCT CASE
      WHEN ${USER_EVENT_WHERE}
        THEN COALESCE(NULLIF(user_id, ''), NULLIF(visitor_id, ''))
      END) AS activeUsers,
    COUNT(DISTINCT CASE
      WHEN ${USER_EVENT_WHERE}
        AND visitor_id != '' AND COALESCE(NULLIF(user_id, ''), NULLIF(username, ''), '') = ''
        THEN visitor_id
      END) AS visitorUsers,
    COUNT(CASE WHEN ${USER_EVENT_WHERE} AND type = 'switch_worker_run' THEN 1 END) AS switchRuns,
    COUNT(CASE WHEN ${BACKGROUND_EVENT_WHERE} THEN 1 END) AS backgroundEvents,
    COUNT(CASE WHEN ${BACKGROUND_EVENT_WHERE} AND type = 'switch_worker_run' THEN 1 END) AS backgroundTaskRuns
    FROM analytics_events WHERE event_date >= ? GROUP BY event_date ORDER BY event_date`).bind(since).all() : { results: [] };
  const pagesRows = wants('pages') ? await env.DB.prepare(`SELECT path AS key,
    COUNT(*) AS pv,
    COUNT(DISTINCT visitor_id) AS uv
    FROM analytics_events WHERE event_date >= ? AND ${USER_EVENT_WHERE} AND type = 'page_view'
    GROUP BY path ORDER BY pv DESC LIMIT 8`).bind(since).all() : { results: [] };
  const recentRows = wants('recent') ? await env.DB.prepare(`SELECT id, type, user_id AS userId, username, visitor_id AS visitorId, path, event_date AS date, created_at AS createdAt, meta
    FROM analytics_events WHERE event_date >= ? AND ${USER_EVENT_WHERE} ORDER BY created_at DESC LIMIT 20`).bind(since).all() : { results: [] };
  const backgroundTypeRows = wants('overview', 'background') ? await env.DB.prepare(`SELECT
    type,
    COUNT(*) AS events,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), NULLIF(visitor_id, ''))) AS users
    FROM analytics_events
    WHERE event_date >= ? AND ${BACKGROUND_EVENT_WHERE}
    GROUP BY type ORDER BY events DESC LIMIT 20`).bind(since).all() : { results: [] };
  const backgroundDailyRows = wants('overview', 'background') ? await env.DB.prepare(`SELECT
    event_date AS date,
    COUNT(*) AS events,
    COUNT(CASE WHEN type = 'switch_worker_run' THEN 1 END) AS runs
    FROM analytics_events
    WHERE event_date >= ? AND ${BACKGROUND_EVENT_WHERE}
    GROUP BY event_date ORDER BY event_date`).bind(since).all() : { results: [] };
  const userActivityRows = wants('pages') ? await env.DB.prepare(`SELECT
    COALESCE(NULLIF(username, ''), visitor_id) AS user,
    username,
    COUNT(*) AS events,
    COUNT(DISTINCT type) AS eventTypes,
    MAX(created_at) AS lastActive
    FROM analytics_events WHERE event_date >= ? AND COALESCE(NULLIF(username, ''), visitor_id) != ''
    AND ${USER_EVENT_WHERE}
    GROUP BY COALESCE(NULLIF(username, ''), visitor_id)
    ORDER BY lastActive DESC LIMIT 20`).bind(since).all() : { results: [] };
  const hourlyRows = wants('activity') ? await env.DB.prepare(`SELECT
    CAST(strftime('%H', created_at) AS INTEGER) AS hour,
    COUNT(*) AS events,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), visitor_id)) AS users
    FROM analytics_events WHERE event_date >= ?
    AND ${USER_EVENT_WHERE}
    GROUP BY hour ORDER BY hour`).bind(since).all() : { results: [] };
  const dowRows = wants('activity') ? await env.DB.prepare(`SELECT
    CAST(strftime('%w', created_at) AS INTEGER) AS dow,
    COUNT(*) AS events,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), visitor_id)) AS users
    FROM analytics_events WHERE event_date >= ?
    AND ${USER_EVENT_WHERE}
    GROUP BY dow ORDER BY dow`).bind(since).all() : { results: [] };
  const platformRows = wants('overview') ? await env.DB.prepare(`WITH notify_events AS (
    SELECT
      NULLIF(COALESCE(NULLIF(user_id, ''), visitor_id), '') AS uid,
      type,
      event_date,
      meta,
      CASE
        WHEN type = 'notify_used' THEN COALESCE(
          NULLIF(json_extract(meta, '$.notifyPlatform'), ''),
          NULLIF(json_extract(meta, '$.platform'), ''),
          CASE
            WHEN COALESCE(json_extract(meta, '$.path'), '') LIKE '%/ws/%' THEN 'pc'
            WHEN COALESCE(json_extract(meta, '$.path'), '') LIKE '%/settings%' THEN 'serverchan3'
            WHEN COALESCE(json_extract(meta, '$.path'), '') != '' THEN 'ios'
            ELSE ''
          END
        )
        ELSE ''
      END AS notify_platform
    FROM analytics_events
    WHERE event_date >= ? AND type IN ('notify_enabled','notify_used')
  ),
  notify_flags AS (
    SELECT
      uid,
      MAX(CASE
        WHEN type = 'notify_enabled' AND json_extract(meta, '$.hasBark') = 1 THEN 1
        WHEN type = 'notify_used' AND notify_platform = 'ios' THEN 1
        ELSE 0
      END) AS has_ios,
      MAX(CASE
        WHEN type = 'notify_used' AND notify_platform = 'serverchan3' THEN 1
        WHEN type = 'notify_enabled' AND EXISTS (SELECT 1 FROM json_each(json_extract(meta, '$.platforms')) WHERE value = 'serverchan3') THEN 1
        ELSE 0
      END) AS has_serverchan3,
      MAX(CASE
        WHEN type = 'notify_enabled' AND EXISTS (SELECT 1 FROM json_each(json_extract(meta, '$.platforms')) WHERE value = 'pc') THEN 1
        WHEN type = 'notify_used' AND notify_platform = 'pc' THEN 1
        ELSE 0
      END) AS has_pc,
      MAX(CASE
        WHEN type = 'notify_used' AND notify_platform NOT IN ('ios', 'serverchan3', 'pc') THEN 1
        WHEN type = 'notify_enabled'
          AND COALESCE(json_extract(meta, '$.hasBark'), 0) != 1
          AND NOT EXISTS (SELECT 1 FROM json_each(json_extract(meta, '$.platforms')) WHERE value IN ('serverchan3', 'pc'))
          THEN 1
        ELSE 0
      END) AS has_unknown,
      MAX(CASE
        WHEN type = 'notify_used' AND notify_platform NOT IN ('ios', 'serverchan3', 'pc') THEN event_date
        WHEN type = 'notify_enabled'
          AND COALESCE(json_extract(meta, '$.hasBark'), 0) != 1
          AND NOT EXISTS (SELECT 1 FROM json_each(json_extract(meta, '$.platforms')) WHERE value IN ('serverchan3', 'pc'))
          THEN event_date
        ELSE ''
      END) AS last_unknown_date
    FROM notify_events
    WHERE uid IS NOT NULL
    GROUP BY uid
  )
  SELECT
    SUM(CASE WHEN has_ios = 1 THEN 1 ELSE 0 END) AS iosUsers,
    SUM(CASE WHEN has_serverchan3 = 1 THEN 1 ELSE 0 END) AS serverChan3Users,
    SUM(CASE WHEN has_pc = 1 THEN 1 ELSE 0 END) AS pcUsers,
    SUM(CASE
      WHEN has_unknown = 1
        AND has_ios = 0
        AND has_serverchan3 = 0
        AND has_pc = 0
        AND last_unknown_date >= ?
        THEN 1
      ELSE 0
    END) AS unknownUsers
    FROM notify_flags`).bind(since, recentUnknownSince).first() : null;
  const engagementSummaryRow = wants('overview', 'engagement') ? await env.DB.prepare(`SELECT
    COUNT(CASE WHEN type = 'session_start' THEN 1 END) AS sessions,
    COUNT(DISTINCT CASE WHEN type = 'session_start' THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS sessionUsers,
    COUNT(CASE WHEN type = 'session_heartbeat' THEN 1 END) AS heartbeats,
    COUNT(CASE WHEN type = 'page_engagement' THEN 1 END) AS pageEvents,
    AVG(CASE WHEN type = 'page_engagement' THEN CAST(json_extract(meta, '$.durationMs') AS REAL) END) AS avgDurationMs,
    AVG(CASE WHEN type = 'page_engagement' THEN CAST(json_extract(meta, '$.activeTimeMs') AS REAL) END) AS avgActiveTimeMs,
    AVG(CASE WHEN type = 'page_engagement' THEN CAST(json_extract(meta, '$.maxScrollPct') AS REAL) END) AS avgScrollPct
    FROM analytics_events WHERE event_date >= ? AND ${USER_EVENT_WHERE} AND type IN ('session_start','session_heartbeat','page_engagement')`).bind(since).first() : null;
  const engagementTabRows = wants('engagement') ? await env.DB.prepare(`SELECT
    COALESCE(json_extract(meta, '$.tab'), 'unknown') AS tab,
    COUNT(*) AS events,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), visitor_id)) AS users,
    AVG(CAST(json_extract(meta, '$.durationMs') AS REAL)) AS avgDurationMs,
    AVG(CAST(json_extract(meta, '$.activeTimeMs') AS REAL)) AS avgActiveTimeMs,
    AVG(CAST(json_extract(meta, '$.maxScrollPct') AS REAL)) AS avgScrollPct
    FROM analytics_events WHERE event_date >= ? AND ${USER_EVENT_WHERE} AND type = 'page_engagement'
    GROUP BY tab ORDER BY events DESC LIMIT 20`).bind(since).all() : { results: [] };
  const premiumSurveyRow = wants('overview', 'survey') ? await env.DB.prepare(`SELECT
    COUNT(*) AS submits,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), visitor_id)) AS users
    FROM analytics_events WHERE event_date >= ? AND ${USER_EVENT_WHERE} AND type = 'premium_survey_submit'`).bind(since).first() : null;
  const premiumSurveyInterestRows = wants('survey') ? await env.DB.prepare(`SELECT
    interest.value AS key,
    COUNT(*) AS count
    FROM analytics_events AS event,
      json_each(CASE
        WHEN json_valid(event.meta) AND json_type(event.meta, '$.interestOptions') = 'array'
          THEN json_extract(event.meta, '$.interestOptions')
        ELSE '[]'
      END) AS interest
    WHERE event.event_date >= ? AND ${USER_EVENT_WHERE.replaceAll('type', 'event.type')} AND event.type = 'premium_survey_submit' AND interest.value IS NOT NULL AND interest.value != ''
    GROUP BY interest.value ORDER BY count DESC LIMIT 20`).bind(since).all() : { results: [] };
  const premiumSurveyPriceRows = wants('survey') ? await env.DB.prepare(`SELECT
    COALESCE(json_extract(meta, '$.priceOption'), '') AS key,
    COUNT(*) AS count
    FROM analytics_events
    WHERE event_date >= ? AND ${USER_EVENT_WHERE} AND type = 'premium_survey_submit' AND COALESCE(json_extract(meta, '$.priceOption'), '') != ''
    GROUP BY key ORDER BY count DESC LIMIT 20`).bind(since).all() : { results: [] };
  const premiumSurveyCompletedRows = wants('survey') ? await env.DB.prepare(`SELECT
    completed.value AS key,
    COUNT(*) AS count
    FROM analytics_events AS event,
      json_each(CASE
        WHEN json_valid(event.meta) AND json_type(event.meta, '$.completedOptions') = 'array'
          THEN json_extract(event.meta, '$.completedOptions')
        ELSE '[]'
      END) AS completed
    WHERE event.event_date >= ? AND ${USER_EVENT_WHERE.replaceAll('type', 'event.type')} AND event.type = 'premium_survey_submit' AND completed.value IS NOT NULL AND completed.value != ''
    GROUP BY completed.value ORDER BY count DESC LIMIT 20`).bind(since).all() : { results: [] };
  const premiumSurveyCustomTextRows = wants('survey') ? await env.DB.prepare(`SELECT
    substr(trim(COALESCE(json_extract(meta, '$.customText'), '')), 1, 160) AS text,
    COUNT(*) AS count,
    MAX(created_at) AS lastAt
    FROM analytics_events
    WHERE event_date >= ? AND ${USER_EVENT_WHERE} AND type = 'premium_survey_submit' AND trim(COALESCE(json_extract(meta, '$.customText'), '')) != ''
    GROUP BY text ORDER BY lastAt DESC LIMIT 20`).bind(since).all() : { results: [] };
  const featureWhere = FEATURE_PREFIXES.map(() => 'type LIKE ?').join(' OR ');
  const featureCase = `CASE ${FEATURE_PREFIXES.map((item) => `WHEN type LIKE '${item.prefix}_%' THEN '${item.prefix}'`).join(' ')} END`;
  const featureGroupRows = wants('featureDetails') ? await env.DB.prepare(`SELECT
    prefix,
    COUNT(*) AS total,
    COUNT(CASE WHEN json_extract(meta, '$.status') = 'success' THEN 1 END) AS success,
    COUNT(CASE WHEN json_extract(meta, '$.status') IN ('error', 'validation_error') THEN 1 END) AS error,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), visitor_id)) AS users
    FROM (
      SELECT ${featureCase} AS prefix, meta, user_id, visitor_id
      FROM analytics_events WHERE event_date >= ? AND ${USER_EVENT_WHERE} AND (${featureWhere})
    )
    WHERE prefix IS NOT NULL
    GROUP BY prefix`).bind(since, ...FEATURE_PREFIXES.map((item) => `${item.prefix}_%`)).all() : { results: [] };
  const featureDetailRows = wants('featureDetails') ? await env.DB.prepare(`SELECT
    type,
    COUNT(*) AS count,
    COUNT(CASE WHEN json_extract(meta, '$.status') = 'success' THEN 1 END) AS success,
    COUNT(CASE WHEN json_extract(meta, '$.status') IN ('error', 'validation_error') THEN 1 END) AS error,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), visitor_id)) AS users
    FROM analytics_events WHERE event_date >= ? AND ${USER_EVENT_WHERE} AND (${featureWhere})
    GROUP BY type ORDER BY count DESC`).bind(since, ...FEATURE_PREFIXES.map((item) => `${item.prefix}_%`)).all() : { results: [] };
  const featureDetailMap = new Map();
  for (const row of featureGroupRows.results || []) {
    const prefix = String(row.prefix || '');
    const matched = FEATURE_PREFIXES.find((item) => item.prefix === prefix);
    if (!matched) continue;
    featureDetailMap.set(prefix, {
      prefix,
      label: matched.label,
      total: Number(row.total) || 0,
      success: Number(row.success) || 0,
      error: Number(row.error) || 0,
      users: Number(row.users) || 0,
      actions: []
    });
  }
  for (const row of featureDetailRows.results || []) {
    const type = String(row.type || '');
    const matched = FEATURE_PREFIXES.find((item) => type.startsWith(`${item.prefix}_`));
    if (!matched) continue;
    const action = type.slice(matched.prefix.length + 1);
    let group = featureDetailMap.get(matched.prefix);
    if (!group) {
      group = { prefix: matched.prefix, label: matched.label, total: 0, success: 0, error: 0, users: 0, actions: [] };
      featureDetailMap.set(matched.prefix, group);
    }
    const count = Number(row.count) || 0;
    const success = Number(row.success) || 0;
    const error = Number(row.error) || 0;
    group.actions.push({
      action,
      label: action,
      count,
      success,
      error,
      users: Number(row.users) || 0
    });
  }
  const featureDetails = Array.from(featureDetailMap.values())
    .sort((a, b) => b.total - a.total)
    .map((group) => ({
      ...group,
      actions: group.actions.sort((a, b) => b.count - a.count)
    }));
  const todayDate = new Date().toISOString().slice(0, 10);
  const overviewDailyActive = overviewDailyActiveRows.results || [];
  const todayDailyActiveRow = overviewDailyActive.find((row) => String(row.date || '') === todayDate) || null;
  const avgDailyActiveUsers = rangeDays > 0
    ? overviewDailyActive.reduce((sum, row) => sum + (Number(row.activeUsers) || 0), 0) / rangeDays
    : 0;

  return json({
    rangeDays,
    generatedAt: nowIso(),
    partial: isPartialRequest,
    sections: isPartialRequest ? Array.from(requestedSections) : Array.from(ADMIN_ANALYTICS_SECTIONS),
    cards: {
      registeredUsers: Number(usersRow?.total) || 0,
      visitorUsers: Number(visitorUsersRow?.total) || 0,
      dailyActiveUsers: Number(todayDailyActiveRow?.activeUsers) || 0,
      avgDailyActiveUsers,
      dailyActiveDate: todayDate,
      pv: Number(cardsRows?.pv) || 0,
      uv: Number(cardsRows?.uv) || 0,
      aiUsers: Number(cardsRows?.aiUsers) || 0,
      notifyUsers: Number(cardsRows?.notifyUsers) || 0,
      switchRuns: Number(cardsRows?.switchRuns) || 0,
      backgroundEvents: Number(cardsRows?.backgroundEvents) || 0,
      backgroundTaskRuns: Number(cardsRows?.backgroundTaskRuns) || 0,
      notifyPlatformUsers: {
        ios: Number(platformRows?.iosUsers) || 0,
        serverchan3: Number(platformRows?.serverChan3Users) || 0,
        pc: Number(platformRows?.pcUsers) || 0,
        unknown: Number(platformRows?.unknownUsers) || 0
      }
    },
    userBehavior: {
      events: Number(cardsRows?.userEvents) || 0,
      users: Number(cardsRows?.userBehaviorUsers) || 0
    },
    backgroundTasks: {
      events: Number(cardsRows?.backgroundEvents) || 0,
      users: Number(cardsRows?.backgroundUsers) || 0,
      runs: Number(cardsRows?.backgroundTaskRuns) || 0,
      byType: (backgroundTypeRows.results || []).map((row) => ({
        type: String(row.type || 'unknown'),
        events: Number(row.events) || 0,
        users: Number(row.users) || 0
      })),
      daily: (backgroundDailyRows.results || []).map((row) => ({
        date: String(row.date || '').slice(5),
        fullDate: row.date,
        events: Number(row.events) || 0,
        runs: Number(row.runs) || 0
      }))
    },
    daily: (dailyRows.results || []).map((row) => ({
      date: String(row.date || '').slice(5),
      fullDate: row.date,
      pv: Number(row.pv) || 0,
      uv: Number(row.uv) || 0,
      activeUsers: Number(row.activeUsers) || 0,
      visitorUsers: Number(row.visitorUsers) || 0,
      switchRuns: Number(row.switchRuns) || 0,
      backgroundEvents: Number(row.backgroundEvents) || 0,
      backgroundTaskRuns: Number(row.backgroundTaskRuns) || 0
    })),
    pages: pagesRows.results || [],
    features: [
      { key: 'AI 使用', value: Number(cardsRows?.aiEvents) || 0, users: Number(cardsRows?.aiUsers) || 0 },
      { key: '通知使用', value: Number(cardsRows?.notifyEvents) || 0, users: Number(cardsRows?.notifyUsers) || 0 },
      { key: '切换运行', value: Number(cardsRows?.switchRuns) || 0, users: Number(cardsRows?.switchUsers) || 0 }
    ],
    featureDetails,
    engagement: {
      sessions: Number(engagementSummaryRow?.sessions) || 0,
      sessionUsers: Number(engagementSummaryRow?.sessionUsers) || 0,
      heartbeats: Number(engagementSummaryRow?.heartbeats) || 0,
      pageEvents: Number(engagementSummaryRow?.pageEvents) || 0,
      avgDurationMs: Number(engagementSummaryRow?.avgDurationMs) || 0,
      avgActiveTimeMs: Number(engagementSummaryRow?.avgActiveTimeMs) || 0,
      avgScrollPct: Number(engagementSummaryRow?.avgScrollPct) || 0,
      byTab: (engagementTabRows.results || []).map((row) => ({
        tab: String(row.tab || 'unknown'),
        events: Number(row.events) || 0,
        users: Number(row.users) || 0,
        avgDurationMs: Number(row.avgDurationMs) || 0,
        avgActiveTimeMs: Number(row.avgActiveTimeMs) || 0,
        avgScrollPct: Number(row.avgScrollPct) || 0
      }))
    },
    premiumSurvey: {
      submits: Number(premiumSurveyRow?.submits) || 0,
      users: Number(premiumSurveyRow?.users) || 0,
      interests: (premiumSurveyInterestRows.results || []).map((row) => ({ key: String(row.key || ''), count: Number(row.count) || 0 })),
      priceOptions: (premiumSurveyPriceRows.results || []).map((row) => ({ key: String(row.key || ''), count: Number(row.count) || 0 })),
      completedOptions: (premiumSurveyCompletedRows.results || []).map((row) => ({ key: String(row.key || ''), count: Number(row.count) || 0 })),
      customTexts: (premiumSurveyCustomTextRows.results || []).map((row) => ({
        text: String(row.text || ''),
        count: Number(row.count) || 0,
        lastAt: String(row.lastAt || '')
      }))
    },
    recent: (recentRows.results || []).map((row) => ({ ...row, meta: (() => { try { return JSON.parse(row.meta || '{}'); } catch { return {}; } })() })),
    userActivity: (userActivityRows.results || []).map((row) => ({
      user: String(row.user || ''),
      username: String(row.username || ''),
      events: Number(row.events) || 0,
      eventTypes: Number(row.eventTypes) || 0,
      lastActive: String(row.lastActive || '')
    })),
    hourlyActivity: Array.from({ length: 24 }, (_, hour) => {
      const row = (hourlyRows.results || []).find((r) => Number(r.hour) === hour);
      return { hour, events: Number(row?.events) || 0, users: Number(row?.users) || 0 };
    }),
    dailyActivity: Array.from({ length: 7 }, (_, dow) => {
      const row = (dowRows.results || []).find((r) => Number(r.dow) === dow);
      return { dow, events: Number(row?.events) || 0, users: Number(row?.users) || 0 };
    })
  }, { origin });
}

async function requireAdmin(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return { response: json({ message: '未登录' }, { status: 401, origin }) };
  if (!isAdminUsername(user.username)) return { response: json({ message: '无管理员权限' }, { status: 403, origin }) };
  return { user };
}

const FUND_ADMIN_SELECT = `
  code, name, fee_fund_type,
  annual_fee_rate, management_fee_rate, custody_fee_rate,
  sales_service_fee_rate, redeem_fee_rate,
  fee_source, fee_notice, fee_json, fee_synced_at,
  latest_nav, latest_nav_date, quote_synced_at, limit_synced_at
`;

async function handleAdminFunds(request, env, origin, code = '') {
  const auth = await requireAdmin(request, env, origin);
  if (auth.response) return auth.response;
  const db = env.MARKETS_DB;
  if (!db || typeof db.prepare !== 'function') {
    return json({ message: 'markets D1 未绑定，请先部署带 MARKETS_DB 的 sync Worker' }, { status: 503, origin });
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize')) || 20)));
    const query = String(url.searchParams.get('q') || '').trim().slice(0, 80);
    const missing = String(url.searchParams.get('missing') || '').trim();
    const kind = String(url.searchParams.get('kind') || '').trim().toLowerCase();
    const where = [];
    const bindings = [];
    if (query) {
      where.push('(code LIKE ? OR name LIKE ?)');
      bindings.push(`%${query}%`, `%${query}%`);
    }
    if (['otc', 'exchange'].includes(kind)) {
      where.push('fee_fund_type = ?');
      bindings.push(kind);
    } else if (kind === 'unknown') {
      where.push("(fee_fund_type IS NULL OR fee_fund_type = '' OR fee_fund_type = 'unknown')");
    }
    const missingSql = buildMissingFeeClause(missing);
    if (missingSql) where.push(missingSql);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;
    const [countRow, rowsResult, statsRow] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS total FROM otc_funds ${whereSql}`).bind(...bindings).first(),
      db.prepare(`SELECT ${FUND_ADMIN_SELECT} FROM otc_funds ${whereSql}
        ORDER BY name COLLATE NOCASE ASC, code ASC LIMIT ? OFFSET ?`).bind(...bindings, pageSize, offset).all(),
      db.prepare(`SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN annual_fee_rate IS NULL THEN 1 ELSE 0 END) AS annualFeeRate,
        SUM(CASE WHEN redeem_fee_rate IS NULL THEN 1 ELSE 0 END) AS redeemFeeRate,
        SUM(CASE WHEN management_fee_rate IS NULL THEN 1 ELSE 0 END) AS managementFeeRate,
        SUM(CASE WHEN custody_fee_rate IS NULL THEN 1 ELSE 0 END) AS custodyFeeRate,
        SUM(CASE WHEN sales_service_fee_rate IS NULL THEN 1 ELSE 0 END) AS salesServiceFeeRate,
        SUM(CASE WHEN fee_json IS NULL OR fee_json = '' THEN 1 ELSE 0 END) AS feeJson
        FROM otc_funds`).first()
    ]);
    return json({
      items: (rowsResult?.results || []).map(feeRowToAdminItem),
      total: Number(countRow?.total) || 0,
      page,
      pageSize,
      stats: {
        total: Number(statsRow?.total) || 0,
        annualFeeRate: Number(statsRow?.annualFeeRate) || 0,
        redeemFeeRate: Number(statsRow?.redeemFeeRate) || 0,
        managementFeeRate: Number(statsRow?.managementFeeRate) || 0,
        custodyFeeRate: Number(statsRow?.custodyFeeRate) || 0,
        salesServiceFeeRate: Number(statsRow?.salesServiceFeeRate) || 0,
        feeJson: Number(statsRow?.feeJson) || 0
      },
      filters: { q: query, missing, kind }
    }, { origin });
  }

  if (request.method !== 'PATCH') return json({ message: 'method not allowed' }, { status: 405, origin });
  const normalizedCode = normalizeFundCode(code);
  if (!normalizedCode) return json({ message: '基金代码必须是 6 位数字' }, { status: 400, origin });
  let patch;
  try {
    patch = normalizeFundAdminPatch(await readBody(request));
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : String(error) }, { status: 400, origin });
  }

  const current = await db.prepare(`SELECT ${FUND_ADMIN_SELECT} FROM otc_funds WHERE code = ?`).bind(normalizedCode).first();
  const currentFee = parseFeeJson(current?.fee_json);
  const nextFee = {
    ...currentFee,
    ...patch,
    code: normalizedCode,
    source: 'admin',
    fetchedAt: nowIso()
  };
  const name = patch.name || current?.name || normalizedCode;
  await db.prepare(`
    INSERT INTO otc_funds (
      code, name, fee_fund_type,
      annual_fee_rate, management_fee_rate, custody_fee_rate,
      sales_service_fee_rate, redeem_fee_rate,
      fee_source, fee_notice, fee_json, fee_synced_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?, datetime('now'))
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      fee_fund_type = excluded.fee_fund_type,
      annual_fee_rate = excluded.annual_fee_rate,
      management_fee_rate = excluded.management_fee_rate,
      custody_fee_rate = excluded.custody_fee_rate,
      sales_service_fee_rate = excluded.sales_service_fee_rate,
      redeem_fee_rate = excluded.redeem_fee_rate,
      fee_source = 'admin',
      fee_notice = excluded.fee_notice,
      fee_json = excluded.fee_json,
      fee_synced_at = excluded.fee_synced_at,
      updated_at = datetime('now')
  `).bind(
    normalizedCode,
    name,
    nextFee.fundType || current?.fee_fund_type || 'unknown',
    nextFee.annualFeeRate ?? null,
    nextFee.managementFeeRate ?? null,
    nextFee.custodyFeeRate ?? null,
    nextFee.salesServiceFeeRate ?? null,
    nextFee.redeemFeeRate ?? null,
    nextFee.notice || null,
    JSON.stringify(nextFee),
    nowIso()
  ).run();
  const saved = await db.prepare(`SELECT ${FUND_ADMIN_SELECT} FROM otc_funds WHERE code = ?`).bind(normalizedCode).first();
  return json({ ok: true, item: feeRowToAdminItem(saved || { ...current, ...saved, code: normalizedCode }) }, { origin });
}

async function handleRegister(request, env, origin) {
  const body = await readBody(request);
  const username = normalizeUsername(body.username);
  const passwordHash = String(body.passwordHash || '').trim();
  if (username.length < 3) return json({ message: '用户名至少 3 位' }, { status: 400, origin });
  if (passwordHash.length < 32) return json({ message: '密码不合法' }, { status: 400, origin });
  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return json({ message: '用户名已存在' }, { status: 409, origin });
  const user = { id: randomId('usr_'), username };
  const salt = randomId('pwd_');
  const storedHash = await hashPasswordCredential(passwordHash, salt);
  await env.DB.prepare('INSERT INTO users (id, username, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user.id, username, storedHash, salt, nowIso(), nowIso()).run();
  return json(await createSession(env, user), { origin });
}

async function handleLogin(request, env, origin) {
  const body = await readBody(request);
  const username = normalizeUsername(body.username);
  const passwordHash = String(body.passwordHash || '').trim();
  const user = await env.DB.prepare('SELECT id, username, password_hash, password_salt FROM users WHERE username = ?').bind(username).first();
  const expectedHash = user ? await hashPasswordCredential(passwordHash, user.password_salt || '') : '';
  if (!user || user.password_hash !== expectedHash) return json({ message: '用户名或密码不正确' }, { status: 401, origin });
  const session = await createSession(env, user);
  return json(session, { origin });
}

function normalizeSyncV2Key(value = '') {
  const key = String(value || '').trim();
  return SYNC_V2_ACCOUNT_KEY_SET.has(key) ? key : '';
}

function syncV2RowToItem(row, { includePayload = false } = {}) {
  if (!row) return null;
  const item = {
    syncKey: String(row.syncKey || row.sync_key || ''),
    revision: Number(row.revision) || 0,
    contentHash: String(row.contentHash || row.content_hash || ''),
    cipherSha256: String(row.cipherSha256 || row.cipher_sha256 || ''),
    updatedAt: String(row.updatedAt || row.updated_at || ''),
    clientUpdatedAt: String(row.clientUpdatedAt || row.client_updated_at || ''),
    deletedAt: String(row.deletedAt || row.deleted_at || '')
  };
  if (includePayload) {
    try {
      item.encryptedPayload = JSON.parse(String(row.encryptedPayload || row.encrypted_payload || ''));
    } catch {
      item.encryptedPayload = null;
    }
  }
  return item;
}

async function selectSyncV2Item(env, userId, syncKey) {
  return env.DB.prepare('SELECT sync_key AS syncKey, revision, content_hash AS contentHash, ' +
    'cipher_sha256 AS cipherSha256, encrypted_payload AS encryptedPayload, ' +
    'updated_at AS updatedAt, client_updated_at AS clientUpdatedAt, deleted_at AS deletedAt ' +
    'FROM sync_v2_items WHERE user_id = ? AND sync_key = ?')
    .bind(userId, syncKey)
    .first();
}

async function listSyncV2Items(env, userId, keys = null, includePayload = false) {
  const columns = 'sync_key AS syncKey, revision, content_hash AS contentHash, ' +
    'cipher_sha256 AS cipherSha256, updated_at AS updatedAt, ' +
    'client_updated_at AS clientUpdatedAt, deleted_at AS deletedAt' +
    (includePayload ? ', encrypted_payload AS encryptedPayload' : '');
  const bindings = [userId];
  let keyClause = '';
  if (Array.isArray(keys)) {
    const allowed = keys.map(normalizeSyncV2Key).filter(Boolean);
    if (!allowed.length) return [];
    keyClause = ' AND sync_key IN (' + allowed.map(() => '?').join(', ') + ')';
    bindings.push(...allowed);
  }
  const result = await env.DB.prepare('SELECT ' + columns + ' FROM sync_v2_items WHERE user_id = ?' + keyClause + ' ORDER BY sync_key ASC')
    .bind(...bindings)
    .all();
  return result?.results || [];
}

async function handleSyncV2Meta(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const rows = await listSyncV2Items(env, user.id);
  return json({ schemaVersion: 2, items: rows.map((row) => syncV2RowToItem(row)) }, { origin });
}

async function handleSyncV2ItemsGet(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const rawKeys = new URL(request.url).searchParams.get('keys');
  const keys = rawKeys == null
    ? null
    : String(rawKeys).split(',').map((value) => {
      try { return decodeURIComponent(value); } catch { return ''; }
    });
  const rows = await listSyncV2Items(env, user.id, keys, true);
  return json({ schemaVersion: 2, items: rows.map((row) => syncV2RowToItem(row, { includePayload: true })) }, { origin });
}

function syncV2ConflictResponse(origin, current, message = '该同步 key 已被其它设备更新，请重新合并') {
  return json({
    message,
    code: 'SYNC_V2_REVISION_MISMATCH',
    item: syncV2RowToItem(current, { includePayload: true })
  }, { status: 409, origin });
}

async function handleSyncV2ItemPut(request, env, origin, requestedKey) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const syncKey = normalizeSyncV2Key(requestedKey);
  if (!syncKey) return json({ message: '不允许同步该 key', code: 'SYNC_V2_KEY_NOT_ALLOWED' }, { status: 400, origin });

  const body = await readBody(request);
  const forbiddenIdentityFields = ['clientId', 'userId', 'username', 'end', 'notifyClientId'];
  if (forbiddenIdentityFields.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    return json({ message: 'V2 同步身份只能来自 Authorization Bearer Token', code: 'SYNC_V2_IDENTITY_FIELD_FORBIDDEN' }, { status: 400, origin });
  }

  const encryptedPayload = body.encryptedPayload;
  if (!encryptedPayload
    || Number(encryptedPayload.version) !== 3
    || encryptedPayload.source !== 'ai-dca-secure-sync-v2'
    || !encryptedPayload.ciphertext
    || !encryptedPayload.crypto?.wrappedDek
    || !encryptedPayload.crypto?.iv) {
    return json({ message: 'V2 密文格式不合法', code: 'SYNC_V2_PAYLOAD_INVALID' }, { status: 400, origin });
  }
  if (Object.prototype.hasOwnProperty.call(encryptedPayload, 'rememberedKey')) {
    return json({ message: '设备密钥不能上传到服务器', code: 'SYNC_V2_KEY_MATERIAL_FORBIDDEN' }, { status: 400, origin });
  }

  const encoded = JSON.stringify(encryptedPayload);
  if (encoded.length > 8 * 1024 * 1024) {
    return json({ message: '单个同步 key 数据过大', code: 'SYNC_V2_PAYLOAD_TOO_LARGE' }, { status: 413, origin });
  }
  const contentHash = String(body.contentHash || encryptedPayload.meta?.contentHash || '').trim().slice(0, 256);
  if (!contentHash) return json({ message: '缺少内容 hash', code: 'SYNC_V2_CONTENT_HASH_REQUIRED' }, { status: 400, origin });
  if (encryptedPayload.meta?.contentHash && String(encryptedPayload.meta.contentHash) !== contentHash) {
    return json({ message: '内容 hash 与密文元数据不一致', code: 'SYNC_V2_CONTENT_HASH_MISMATCH' }, { status: 400, origin });
  }

  const baseRevision = body.baseRevision == null || body.baseRevision === '' ? 0 : Number(body.baseRevision);
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    return json({ message: 'baseRevision 不合法', code: 'SYNC_V2_BASE_REVISION_INVALID' }, { status: 400, origin });
  }
  const deletedAt = String(body.deletedAt || '').slice(0, 40);
  const clientUpdatedAt = String(body.clientUpdatedAt || '').slice(0, 40);
  const cipherSha256 = await sha256Hex(encoded);
  const current = await selectSyncV2Item(env, user.id, syncKey);

  if (current && String(current.contentHash || '') === contentHash && String(current.deletedAt || '') === deletedAt) {
    return json({ ok: true, unchanged: true, item: syncV2RowToItem(current) }, { origin });
  }
  if (current && Number(current.revision) !== baseRevision) return syncV2ConflictResponse(origin, current);
  if (!current && baseRevision !== 0) return syncV2ConflictResponse(origin, null, '该同步 key 已被其它设备创建，请重新拉取');

  const revision = current ? Number(current.revision) + 1 : 1;
  const updatedAt = nowIso();
  if (current) {
    const result = await env.DB.prepare('UPDATE sync_v2_items ' +
      'SET revision = ?, content_hash = ?, cipher_sha256 = ?, encrypted_payload = ?, ' +
      'updated_at = ?, client_updated_at = ?, deleted_at = ? ' +
      'WHERE user_id = ? AND sync_key = ? AND revision = ?')
      .bind(revision, contentHash, cipherSha256, encoded, updatedAt, clientUpdatedAt, deletedAt, user.id, syncKey, baseRevision)
      .run();
    if (result?.meta?.changes != null && Number(result.meta.changes) !== 1) {
      return syncV2ConflictResponse(origin, await selectSyncV2Item(env, user.id, syncKey));
    }
  } else {
    try {
      await env.DB.prepare('INSERT INTO sync_v2_items ' +
        '(user_id, sync_key, revision, content_hash, cipher_sha256, encrypted_payload, ' +
        'updated_at, client_updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(user.id, syncKey, revision, contentHash, cipherSha256, encoded, updatedAt, clientUpdatedAt, deletedAt)
        .run();
    } catch (error) {
      const raced = await selectSyncV2Item(env, user.id, syncKey);
      if (raced) return syncV2ConflictResponse(origin, raced, '该同步 key 已被其它设备创建，请重新拉取');
      throw error;
    }
  }

  const saved = await selectSyncV2Item(env, user.id, syncKey);
  return json({
    ok: true,
    item: syncV2RowToItem(saved || { syncKey, revision, contentHash, cipherSha256, updatedAt, clientUpdatedAt, deletedAt })
  }, { origin });
}


export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '*';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    await ensureSchema(env);
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/api/sync/analytics/track') return handleTrackAnalytics(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/api/sync/analytics/switch-today-summary') return handleSwitchTodaySummaryGet(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/api/sync/admin/analytics') return handleAdminAnalytics(request, env, origin);
      const fundAdminMatch = url.pathname.match(/^\/api\/sync\/admin\/funds(?:\/(\d{6}))?$/);
      if (fundAdminMatch && ((request.method === 'GET' && !fundAdminMatch[1]) || (request.method === 'PATCH' && fundAdminMatch[1]))) {
        return handleAdminFunds(request, env, origin, fundAdminMatch[1] || '');
      }
      if (request.method === 'POST' && url.pathname === '/api/sync/auth/register') return handleRegister(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/api/sync/auth/login') return handleLogin(request, env, origin);
      if (url.pathname.startsWith('/api/sync/v2/') && !isSyncV2TestRequest(request, env)) {
        return json({ message: 'V2 同步仅在 test 环境开放' }, { status: 404, origin });
      }
      if (request.method === 'GET' && url.pathname === '/api/sync/v2/items/meta') return handleSyncV2Meta(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/api/sync/v2/items') return handleSyncV2ItemsGet(request, env, origin);
      const syncV2ItemMatch = url.pathname.match(/^\/api\/sync\/v2\/items\/([^/]+)$/);
      if (request.method === 'PUT' && syncV2ItemMatch) {
        let requestedKey = '';
        try { requestedKey = decodeURIComponent(syncV2ItemMatch[1]); } catch { requestedKey = ''; }
        return handleSyncV2ItemPut(request, env, origin, requestedKey);
      }
      if (request.method === 'GET' && url.pathname === '/api/sync/health') return json({ ok: true, service: 'sync', at: nowIso() }, { origin });
      return json({ message: 'not found' }, { status: 404, origin });
    } catch (err) {
      return json({ message: err?.message || 'server error' }, { status: 500, origin });
    }
  },
  async scheduled(controller, env) {
    try {
      await ensureSchema(env);
      const result = await pruneOldAnalyticsEvents(env, Number(controller?.scheduledTime) || Date.now());
      console.log('[sync] analytics retention cleanup', JSON.stringify(result));
    } catch (error) {
      console.log('[sync] analytics retention cleanup failed', JSON.stringify({
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  }
};
