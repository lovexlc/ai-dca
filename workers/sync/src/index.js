const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
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

function isAdminUsername(username = '') {
  return ADMIN_USERNAMES.has(String(username || '').trim().toLowerCase());
}

const ADMIN_ANALYTICS_SECTIONS = new Set([
  'overview',
  'traffic',
  'pages',
  'activity',
  'ads',
  'engagement',
  'survey',
  'featureDetails',
  'recent'
]);

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
    'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
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
  try {
    await env.DB.prepare("ALTER TABLE users ADD COLUMN password_salt TEXT NOT NULL DEFAULT ''").run();
  } catch {
    // Existing databases may already have this column.
  }
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
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS backups (
    user_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    kv_key TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    key_count INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL DEFAULT ''
  )`).run();
  for (const alter of [
    "ALTER TABLE backups ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE backups ADD COLUMN envelope TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE backups ADD COLUMN cipher_sha256 TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE backups ADD COLUMN last_end_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE backups ADD COLUMN last_end_type TEXT NOT NULL DEFAULT ''"
  ]) {
    try {
      await env.DB.prepare(alter).run();
    } catch {
      // 现有表可能已存在该列。
    }
  }
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
  let accepted = 0;
  for (const rawEvent of events) {
    if (!rawEvent || typeof rawEvent !== 'object') continue;
    const id = String(rawEvent.id || randomId('evt_')).slice(0, 96);
    const type = String(rawEvent.type || '').trim().slice(0, 64);
    if (!type) continue;
    const createdAt = String(rawEvent.createdAt || nowIso()).slice(0, 40);
    const eventDate = String(rawEvent.date || createdAt.slice(0, 10) || nowIso().slice(0, 10)).slice(0, 10);
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
  const rangeDays = Math.max(1, Math.min(Number(url.searchParams.get('rangeDays')) || 30, 365));
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
  const cardsRows = wants('overview') ? await env.DB.prepare(`SELECT
    COUNT(CASE WHEN type = 'page_view' THEN 1 END) AS pv,
    COUNT(DISTINCT CASE WHEN type = 'page_view' THEN COALESCE(NULLIF(user_id, ''), NULLIF(visitor_id, '')) END) AS uv,
    COUNT(CASE WHEN type = 'ai_used' THEN 1 END) AS aiEvents,
    COUNT(DISTINCT CASE WHEN type = 'ai_used' THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS aiUsers,
    COUNT(CASE WHEN type IN ('notify_enabled','notify_used') THEN 1 END) AS notifyEvents,
    COUNT(DISTINCT CASE WHEN type IN ('notify_enabled','notify_used') THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS notifyUsers,
    COUNT(CASE WHEN type = 'switch_worker_run' THEN 1 END) AS switchRuns,
    COUNT(DISTINCT CASE WHEN type = 'switch_worker_run' THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS switchUsers
    FROM analytics_events WHERE event_date >= ?`).bind(since).first() : null;
  const overviewDailyActiveRows = wants('overview') ? await env.DB.prepare(`SELECT
    event_date AS date,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), NULLIF(visitor_id, ''))) AS activeUsers
    FROM analytics_events
    WHERE event_date >= ?
      AND type IN ('page_view', 'page_engagement')
      AND COALESCE(NULLIF(user_id, ''), NULLIF(visitor_id, '')) IS NOT NULL
      AND NOT (type = 'switch_worker_run' AND json_extract(meta, '$.reason') = 'switch-cron')
    GROUP BY event_date ORDER BY event_date`).bind(since).all() : { results: [] };
  const dailyRows = wants('traffic') ? await env.DB.prepare(`SELECT event_date AS date,
    COUNT(CASE WHEN type = 'page_view' THEN 1 END) AS pv,
    COUNT(DISTINCT CASE WHEN type = 'page_view' THEN COALESCE(NULLIF(user_id, ''), NULLIF(visitor_id, '')) END) AS uv,
    COUNT(DISTINCT CASE
      WHEN type IN ('page_view', 'page_engagement')
        THEN COALESCE(NULLIF(user_id, ''), NULLIF(visitor_id, ''))
      END) AS activeUsers,
    COUNT(DISTINCT CASE
      WHEN visitor_id != '' AND COALESCE(NULLIF(user_id, ''), NULLIF(username, ''), '') = ''
        THEN visitor_id
      END) AS visitorUsers,
    COUNT(CASE WHEN type = 'switch_worker_run' THEN 1 END) AS switchRuns
    FROM analytics_events WHERE event_date >= ? GROUP BY event_date ORDER BY event_date`).bind(since).all() : { results: [] };
  const pagesRows = wants('pages') ? await env.DB.prepare(`SELECT path AS key,
    COUNT(*) AS pv,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), NULLIF(visitor_id, ''))) AS uv
    FROM analytics_events WHERE event_date >= ? AND type = 'page_view'
    GROUP BY path ORDER BY pv DESC LIMIT 8`).bind(since).all() : { results: [] };
  const recentRows = wants('recent') ? await env.DB.prepare(`SELECT id, type, user_id AS userId, username, visitor_id AS visitorId, path, event_date AS date, created_at AS createdAt, meta
    FROM analytics_events WHERE event_date >= ? ORDER BY created_at DESC LIMIT 20`).bind(since).all() : { results: [] };
  const userActivityRows = wants('pages') ? await env.DB.prepare(`SELECT
    COALESCE(NULLIF(username, ''), visitor_id) AS user,
    username,
    COUNT(*) AS events,
    COUNT(DISTINCT type) AS eventTypes,
    MAX(created_at) AS lastActive
    FROM analytics_events WHERE event_date >= ? AND COALESCE(NULLIF(username, ''), visitor_id) != ''
    AND NOT (type = 'switch_worker_run' AND json_extract(meta, '$.reason') = 'switch-cron')
    GROUP BY COALESCE(NULLIF(username, ''), visitor_id)
    ORDER BY lastActive DESC LIMIT 20`).bind(since).all() : { results: [] };
  const hourlyRows = wants('activity') ? await env.DB.prepare(`SELECT
    CAST(strftime('%H', created_at) AS INTEGER) AS hour,
    COUNT(*) AS events,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), visitor_id)) AS users
    FROM analytics_events WHERE event_date >= ?
    AND NOT (type = 'switch_worker_run' AND json_extract(meta, '$.reason') = 'switch-cron')
    GROUP BY hour ORDER BY hour`).bind(since).all() : { results: [] };
  const dowRows = wants('activity') ? await env.DB.prepare(`SELECT
    CAST(strftime('%w', created_at) AS INTEGER) AS dow,
    COUNT(*) AS events,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), visitor_id)) AS users
    FROM analytics_events WHERE event_date >= ?
    AND NOT (type = 'switch_worker_run' AND json_extract(meta, '$.reason') = 'switch-cron')
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
  const adSummaryRow = wants('overview', 'ads') ? await env.DB.prepare(`SELECT
    COUNT(CASE WHEN type = 'ad_slot_view' THEN 1 END) AS views,
    COUNT(CASE WHEN type = 'ad_slot_click' THEN 1 END) AS clicks,
    COUNT(DISTINCT CASE WHEN type IN ('ad_slot_view', 'ad_slot_click') THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS users,
    AVG(CASE WHEN type = 'ad_slot_view' THEN CAST(json_extract(meta, '$.visibleMs') AS REAL) END) AS avgVisibleMs
    FROM analytics_events WHERE event_date >= ? AND type IN ('ad_slot_view','ad_slot_click')`).bind(since).first() : null;
  const adSlotRows = wants('ads') ? await env.DB.prepare(`SELECT
    COALESCE(json_extract(meta, '$.slotId'), 'unknown') AS slotId,
    COALESCE(json_extract(meta, '$.pageTab'), '') AS pageTab,
    COALESCE(json_extract(meta, '$.position'), '') AS position,
    COALESCE(json_extract(meta, '$.adProvider'), '') AS adProvider,
    COUNT(CASE WHEN type = 'ad_slot_view' THEN 1 END) AS views,
    COUNT(CASE WHEN type = 'ad_slot_click' THEN 1 END) AS clicks,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), visitor_id)) AS users,
    AVG(CASE WHEN type = 'ad_slot_view' THEN CAST(json_extract(meta, '$.visibleMs') AS REAL) END) AS avgVisibleMs
    FROM analytics_events WHERE event_date >= ? AND type IN ('ad_slot_view','ad_slot_click')
    GROUP BY slotId, pageTab, position, adProvider
    ORDER BY views DESC LIMIT 20`).bind(since).all() : { results: [] };
  const engagementSummaryRow = wants('overview', 'engagement') ? await env.DB.prepare(`SELECT
    COUNT(CASE WHEN type = 'session_start' THEN 1 END) AS sessions,
    COUNT(DISTINCT CASE WHEN type = 'session_start' THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS sessionUsers,
    COUNT(CASE WHEN type = 'session_heartbeat' THEN 1 END) AS heartbeats,
    COUNT(CASE WHEN type = 'page_engagement' THEN 1 END) AS pageEvents,
    AVG(CASE WHEN type = 'page_engagement' THEN CAST(json_extract(meta, '$.durationMs') AS REAL) END) AS avgDurationMs,
    AVG(CASE WHEN type = 'page_engagement' THEN CAST(json_extract(meta, '$.activeTimeMs') AS REAL) END) AS avgActiveTimeMs,
    AVG(CASE WHEN type = 'page_engagement' THEN CAST(json_extract(meta, '$.maxScrollPct') AS REAL) END) AS avgScrollPct
    FROM analytics_events WHERE event_date >= ? AND type IN ('session_start','session_heartbeat','page_engagement')`).bind(since).first() : null;
  const engagementTabRows = wants('engagement') ? await env.DB.prepare(`SELECT
    COALESCE(json_extract(meta, '$.tab'), 'unknown') AS tab,
    COUNT(*) AS events,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), visitor_id)) AS users,
    AVG(CAST(json_extract(meta, '$.durationMs') AS REAL)) AS avgDurationMs,
    AVG(CAST(json_extract(meta, '$.activeTimeMs') AS REAL)) AS avgActiveTimeMs,
    AVG(CAST(json_extract(meta, '$.maxScrollPct') AS REAL)) AS avgScrollPct
    FROM analytics_events WHERE event_date >= ? AND type = 'page_engagement'
    GROUP BY tab ORDER BY events DESC LIMIT 20`).bind(since).all() : { results: [] };
  const premiumSurveyRow = wants('overview', 'survey') ? await env.DB.prepare(`SELECT
    COUNT(*) AS submits,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), visitor_id)) AS users
    FROM analytics_events WHERE event_date >= ? AND type = 'premium_survey_submit'`).bind(since).first() : null;
  const premiumSurveyInterestRows = wants('survey') ? await env.DB.prepare(`SELECT
    interest.value AS key,
    COUNT(*) AS count
    FROM analytics_events AS event,
      json_each(CASE
        WHEN json_valid(event.meta) AND json_type(event.meta, '$.interestOptions') = 'array'
          THEN json_extract(event.meta, '$.interestOptions')
        ELSE '[]'
      END) AS interest
    WHERE event.event_date >= ? AND event.type = 'premium_survey_submit' AND interest.value IS NOT NULL AND interest.value != ''
    GROUP BY interest.value ORDER BY count DESC LIMIT 20`).bind(since).all() : { results: [] };
  const premiumSurveyPriceRows = wants('survey') ? await env.DB.prepare(`SELECT
    COALESCE(json_extract(meta, '$.priceOption'), '') AS key,
    COUNT(*) AS count
    FROM analytics_events
    WHERE event_date >= ? AND type = 'premium_survey_submit' AND COALESCE(json_extract(meta, '$.priceOption'), '') != ''
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
    WHERE event.event_date >= ? AND event.type = 'premium_survey_submit' AND completed.value IS NOT NULL AND completed.value != ''
    GROUP BY completed.value ORDER BY count DESC LIMIT 20`).bind(since).all() : { results: [] };
  const premiumSurveyCustomTextRows = wants('survey') ? await env.DB.prepare(`SELECT
    substr(trim(COALESCE(json_extract(meta, '$.customText'), '')), 1, 160) AS text,
    COUNT(*) AS count,
    MAX(created_at) AS lastAt
    FROM analytics_events
    WHERE event_date >= ? AND type = 'premium_survey_submit' AND trim(COALESCE(json_extract(meta, '$.customText'), '')) != ''
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
      FROM analytics_events WHERE event_date >= ? AND (${featureWhere})
    )
    WHERE prefix IS NOT NULL
    GROUP BY prefix`).bind(since, ...FEATURE_PREFIXES.map((item) => `${item.prefix}_%`)).all() : { results: [] };
  const featureDetailRows = wants('featureDetails') ? await env.DB.prepare(`SELECT
    type,
    COUNT(*) AS count,
    COUNT(CASE WHEN json_extract(meta, '$.status') = 'success' THEN 1 END) AS success,
    COUNT(CASE WHEN json_extract(meta, '$.status') IN ('error', 'validation_error') THEN 1 END) AS error,
    COUNT(DISTINCT COALESCE(NULLIF(user_id, ''), visitor_id)) AS users
    FROM analytics_events WHERE event_date >= ? AND (${featureWhere})
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
      notifyPlatformUsers: {
        ios: Number(platformRows?.iosUsers) || 0,
        serverchan3: Number(platformRows?.serverChan3Users) || 0,
        pc: Number(platformRows?.pcUsers) || 0,
        unknown: Number(platformRows?.unknownUsers) || 0
      }
    },
    daily: (dailyRows.results || []).map((row) => ({
      date: String(row.date || '').slice(5),
      fullDate: row.date,
      pv: Number(row.pv) || 0,
      uv: Number(row.uv) || 0,
      activeUsers: Number(row.activeUsers) || 0,
      visitorUsers: Number(row.visitorUsers) || 0,
      switchRuns: Number(row.switchRuns) || 0
    })),
    pages: pagesRows.results || [],
    features: [
      { key: 'AI 使用', value: Number(cardsRows?.aiEvents) || 0, users: Number(cardsRows?.aiUsers) || 0 },
      { key: '通知使用', value: Number(cardsRows?.notifyEvents) || 0, users: Number(cardsRows?.notifyUsers) || 0 },
      { key: '切换运行', value: Number(cardsRows?.switchRuns) || 0, users: Number(cardsRows?.switchUsers) || 0 }
    ],
    featureDetails,
    ads: {
      views: Number(adSummaryRow?.views) || 0,
      clicks: Number(adSummaryRow?.clicks) || 0,
      users: Number(adSummaryRow?.users) || 0,
      ctr: Number(adSummaryRow?.views) ? (Number(adSummaryRow?.clicks) || 0) / Number(adSummaryRow.views) : 0,
      avgVisibleMs: Number(adSummaryRow?.avgVisibleMs) || 0,
      slots: (adSlotRows.results || []).map((row) => ({
        slotId: String(row.slotId || 'unknown'),
        pageTab: String(row.pageTab || ''),
        position: String(row.position || ''),
        adProvider: String(row.adProvider || ''),
        views: Number(row.views) || 0,
        clicks: Number(row.clicks) || 0,
        users: Number(row.users) || 0,
        ctr: Number(row.views) ? (Number(row.clicks) || 0) / Number(row.views) : 0,
        avgVisibleMs: Number(row.avgVisibleMs) || 0
      }))
    },
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
  const meta = await env.DB.prepare('SELECT version, updated_at AS updatedAt, key_count AS keyCount, bytes FROM backups WHERE user_id = ?').bind(user.id).first();
  return json({ ...session, latestBackupMeta: meta || null }, { origin });
}

async function handleMeta(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const meta = await env.DB.prepare('SELECT version, updated_at AS updatedAt, key_count AS keyCount, bytes, content_hash AS contentHash, last_end_id AS lastEndId, last_end_type AS lastEndType FROM backups WHERE user_id = ?').bind(user.id).first();
  return json(meta || { version: null, updatedAt: '', keyCount: 0, bytes: 0, contentHash: '', lastEndId: '', lastEndType: '' }, { origin });
}

async function handleGetLatest(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const meta = await env.DB.prepare('SELECT version, updated_at AS updatedAt, key_count AS keyCount, bytes, kv_key AS kvKey, envelope, cipher_sha256 AS cipherSha256, content_hash AS contentHash, last_end_id AS lastEndId, last_end_type AS lastEndType FROM backups WHERE user_id = ?').bind(user.id).first();
  if (!meta) return json({ version: null, encryptedEnvelope: null }, { origin });
  let encoded = meta.envelope ? String(meta.envelope) : '';
  let backfilled = false;
  if (!encoded) {
    // 旧行：密文仅在 KV，回退读取并惰性回填进 D1（强一致主存储）。
    const legacy = await env.SYNC_BACKUPS.get(meta.kvKey);
    encoded = legacy ? String(legacy) : '';
    backfilled = Boolean(encoded);
  } else if (meta.cipherSha256) {
    // 校验 D1 内密文完整性：不一致绝不把坏 blob 发给端侧。
    const actual = await sha256Hex(encoded);
    if (actual !== String(meta.cipherSha256)) {
      return json({ message: '云端密文完整性校验失败，请重传备份', code: 'STORAGE_CORRUPTED' }, { status: 409, origin });
    }
  }
  if (!encoded) return json({ version: null, encryptedEnvelope: null }, { origin });
  let encryptedEnvelope = null;
  try {
    encryptedEnvelope = JSON.parse(encoded);
  } catch {
    return json({ message: '云端密文解析失败，请重传备份', code: 'STORAGE_CORRUPTED' }, { status: 409, origin });
  }
  if (backfilled) {
    // 旧 KV blob 回填进 D1 主存储，不改版本，幂等。
    const cipherSha = await sha256Hex(encoded);
    try {
      await env.DB.prepare('UPDATE backups SET envelope = ?, cipher_sha256 = ? WHERE user_id = ?')
        .bind(encoded, cipherSha, user.id).run();
    } catch {
      // 回填失败不影响本次读取。
    }
  }
  return json({
    version: meta.version,
    updatedAt: meta.updatedAt,
    keyCount: meta.keyCount,
    bytes: meta.bytes,
    kvKey: meta.kvKey,
    contentHash: meta.contentHash || '',
    lastEndId: meta.lastEndId || '',
    lastEndType: meta.lastEndType || '',
    encryptedEnvelope
  }, { origin });
}

async function handlePutLatest(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const body = await readBody(request);
  const encryptedEnvelope = body.encryptedEnvelope || {};
  if (!encryptedEnvelope.ciphertext || encryptedEnvelope.source !== 'ai-dca-secure-sync') {
    return json({ message: '密文备份格式不合法' }, { status: 400, origin });
  }
  const current = await env.DB.prepare('SELECT version, kv_key AS kvKey, updated_at AS updatedAt, key_count AS keyCount, bytes, content_hash AS contentHash, last_end_id AS lastEndId FROM backups WHERE user_id = ?').bind(user.id).first();
  const incomingHash = String(encryptedEnvelope?.meta?.contentHash || '');
  // 内容未变化：保持版本号不变，不重写 KV，不报冲突。
  if (current && incomingHash && incomingHash === String(current.contentHash || '')) {
    return json({
      version: Number(current.version),
      updatedAt: current.updatedAt,
      keyCount: Number(current.keyCount) || 0,
      bytes: Number(current.bytes) || 0,
      unchanged: true
    }, { origin });
  }
  // 端标识（安装实例粒度）：同端连续修改只覆盖、不涨版本；跨端接管才涨版本。
  const end = body.end && typeof body.end === 'object' ? body.end : {};
  const endId = String(end.id || '').slice(0, 80);
  const endType = String(end.type || '').slice(0, 40);
  const sameEnd = Boolean(current && endId && endId === String(current.lastEndId || ''));
  const baseVersion = body.baseVersion == null ? null : Number(body.baseVersion);
  // 乐观锁仅用于跨端并发：同端（即同一安装）连续写入直接覆盖，不做 baseVersion 校验。
  if (current && !sameEnd && baseVersion !== null && Number(current.version) !== baseVersion) {
    return json({ message: '云端数据已更新，请先处理冲突', currentVersion: current.version }, { status: 409, origin });
  }
  const version = current ? (sameEnd ? Number(current.version) : Number(current.version) + 1) : 1;
  const kvKey = current?.kvKey || `backup:${user.id}`;
  const encoded = JSON.stringify(encryptedEnvelope);
  const cipherSha = await sha256Hex(encoded);
  const updatedAt = nowIso();
  const keyCount = Number(encryptedEnvelope?.meta?.keyCount) || 0;
  // 强一致主存储：密文 BLOB + 完整性校验和 + 版本元数据写入同一 D1 行（单次原子写）。
  if (current) {
    await env.DB.prepare('UPDATE backups SET version = ?, updated_at = ?, key_count = ?, bytes = ?, content_hash = ?, envelope = ?, cipher_sha256 = ?, last_end_id = ?, last_end_type = ? WHERE user_id = ?')
      .bind(version, updatedAt, keyCount, encoded.length, incomingHash, encoded, cipherSha, endId, endType, user.id).run();
  } else {
    await env.DB.prepare('INSERT INTO backups (user_id, version, kv_key, updated_at, key_count, bytes, content_hash, envelope, cipher_sha256, last_end_id, last_end_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(user.id, version, kvKey, updatedAt, keyCount, encoded.length, incomingHash, encoded, cipherSha, endId, endType).run();
  }
  // KV 镜像仅为旧 Worker 回滚兼容（尽力而为，不阻塞、不影响一致性）。
  try {
    await env.SYNC_BACKUPS.put(kvKey, encoded);
  } catch {
    // 镜像失败不影响主存储一致性。
  }
  return json({ version, updatedAt, keyCount, bytes: encoded.length, contentHash: incomingHash, lastEndId: endId, lastEndType: endType, sameEnd }, { origin });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '*';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    await ensureSchema(env);
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/api/sync/analytics/track') return handleTrackAnalytics(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/api/sync/admin/analytics') return handleAdminAnalytics(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/api/sync/auth/register') return handleRegister(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/api/sync/auth/login') return handleLogin(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/api/sync/meta') return handleMeta(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/api/sync/latest') return handleGetLatest(request, env, origin);
      if (request.method === 'PUT' && url.pathname === '/api/sync/latest') return handlePutLatest(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/api/sync/health') return json({ ok: true, service: 'sync', at: nowIso() }, { origin });
      return json({ message: 'not found' }, { status: 404, origin });
    } catch (err) {
      return json({ message: err?.message || 'server error' }, { status: 500, origin });
    }
  }
};
