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
const WRITER_LEASE_SECONDS = 30;
const MAX_SYNC_SNAPSHOT_BYTES = 12 * 1024 * 1024;
const MAX_USER_DATA_RESOURCE_BYTES = 2 * 1024 * 1024;
const USER_DATA_RESOURCE_IDS = new Set([
  'aiDcaFundHoldingsLedger',
  'aiDcaFundHoldingsState',
  'aiDcaAccountAllocationSettings',
  'aiDcaTradeLedger',
  'aiDcaTradeLedgerArchive',
  'aiDcaAccumulationState',
  'aiDcaPositionSnapshot',
  'aiDcaPlanStore',
  'aiDcaPlanState',
  'aiDcaDcaStore',
  'aiDcaDcaState',
  'aiDcaSellPlanStore',
  'aiDcaSwitchStrategyPrefs',
  'aiDcaSwitchStrategyWorkerConfig',
  'aiDcaSwitchWatchlist',
  'aiDcaVixState',
  'aiDcaNotifyClientConfig',
  'aiDcaWebNotifyConfig',
  'aiDcaMarketAlerts',
  'aiDcaHoldingAlerts',
  'aiDcaWorkspacePrefs',
  'aiDcaHomeDashboardState',
  'markets:watchlist:v1',
  'markets:groups:v1',
  'markets:columnVisibility',
  'markets:tableViewState:v1',
  'aiDcaAnalyticsOptOut_v1',
  'aiDcaPremiumState'
]);
const USER_DATA_SCHEMA_VERSION = 1;
const SECURE_CONFIG_KEYS = new Set([
  'aiDcaFundHoldingsLedger',
  'aiDcaFundHoldingsState',
  'aiDcaAccountAllocationSettings',
  'aiDcaTradeLedger',
  'aiDcaTradeLedgerArchive',
  'aiDcaAccumulationState',
  'aiDcaPositionSnapshot',
  'aiDcaPlanStore',
  'aiDcaPlanState',
  'aiDcaDcaStore',
  'aiDcaDcaState',
  'aiDcaSellPlanStore',
  'aiDcaSwitchStrategyPrefs',
  'aiDcaSwitchStrategyWorkerConfig',
  'aiDcaSwitchWatchlist',
  'aiDcaVixState',
  'aiDcaNotifyClientConfig',
  'aiDcaWebNotifyConfig',
  'aiDcaMarketAlerts',
  'aiDcaHoldingAlerts',
  'aiDcaWorkspacePrefs',
  'aiDcaHomeDashboardState',
  'markets:watchlist:v1',
  'aiDcaAnalyticsOptOut_v1',
  'aiDcaPremiumState'
]);

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
    'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
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

function normalizeSecureConfigKey(value = '') {
  const key = String(value || '').trim();
  return SECURE_CONFIG_KEYS.has(key) ? key : '';
}

function normalizeUserDataResource(value = '') {
  const resource = String(value || '').trim();
  return USER_DATA_RESOURCE_IDS.has(resource) ? resource : '';
}

function normalizeMutationId(value = '') {
  return String(value || '').trim().slice(0, 160);
}

function normalizeSchemaVersion(value) {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 && version <= 100 ? version : USER_DATA_SCHEMA_VERSION;
}

function userDataStorageKey(userId, resourceId, mutationId) {
  return `userdata:${String(userId || '').trim()}:${resourceId}:${mutationId}`;
}

function userDataPrefix(userId) {
  return `userdata:${String(userId || '').trim()}:`;
}

function secureConfigStorageKey(userId, key) {
  return `secure-config:${String(userId || '').trim()}:${key}`;
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
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_SYNC_SNAPSHOT_BYTES) throw Object.assign(new Error('请求体过大'), { status: 413, code: 'PAYLOAD_TOO_LARGE' });
  try {
    const text = await request.text();
    if (text.length > MAX_SYNC_SNAPSHOT_BYTES) throw Object.assign(new Error('请求体过大'), { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    return text ? JSON.parse(text) : {};
  } catch (error) {
    if (error?.message === '请求体过大') throw error;
    return {};
  }
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
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_events_date_created ON analytics_events (event_date, created_at DESC)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS analytics_daily_stats (
    event_date TEXT PRIMARY KEY,
    pv INTEGER NOT NULL DEFAULT 0,
    switch_runs INTEGER NOT NULL DEFAULT 0
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS analytics_daily_users (
    event_date TEXT NOT NULL,
    identity TEXT NOT NULL,
    is_visitor_only INTEGER NOT NULL DEFAULT 0,
    has_page_view INTEGER NOT NULL DEFAULT 0,
    has_page_engagement INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_date, identity)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS analytics_daily_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_daily_users_date_flags
    ON analytics_daily_users (event_date, has_page_view, has_page_engagement)`).run();
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
    "ALTER TABLE backups ADD COLUMN last_end_type TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE backups ADD COLUMN sync_mode TEXT NOT NULL DEFAULT 'legacy'"
  ]) {
    try {
      await env.DB.prepare(alter).run();
    } catch {
      // 现有表可能已存在该列。
    }
  }
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sync_accounts (
    user_id TEXT PRIMARY KEY,
    migration_status TEXT NOT NULL DEFAULT 'migration_pending',
    migration_completed_at TEXT NOT NULL DEFAULT '',
    migration_completed_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sync_devices (
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_type TEXT NOT NULL DEFAULT '',
    migration_status TEXT NOT NULL DEFAULT 'pending',
    local_signature TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, device_id)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sync_leases (
    user_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    device_type TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`).run();
  try {
    await env.DB.prepare("ALTER TABLE sync_leases ADD COLUMN session_id TEXT NOT NULL DEFAULT ''").run();
  } catch {
    // Existing v2 deployments may already have the session column.
  }
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_data_resources (
    user_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    schema_version INTEGER NOT NULL DEFAULT 1,
    kv_key TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL DEFAULT '',
    cipher_sha256 TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    mutation_id TEXT NOT NULL DEFAULT '',
    bytes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, resource_id)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_data_mutations (
    user_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    kv_key TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL DEFAULT '',
    cipher_sha256 TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, resource_id, mutation_id)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_data_migrations (
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source_hash TEXT NOT NULL DEFAULT '',
    local_signature TEXT NOT NULL DEFAULT '',
    completed_resources TEXT NOT NULL DEFAULT '[]',
    started_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, device_id)
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_user_data_resources_user_updated ON user_data_resources (user_id, updated_at DESC)').run();
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

function normalizeDeviceId(value = '') {
  return String(value || '').trim().slice(0, 120);
}

function normalizeDeviceType(value = '') {
  return String(value || '').trim().slice(0, 40);
}

function isFiniteRevision(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && Number.isSafeInteger(number);
}

function validateEncryptedEnvelope(encryptedEnvelope = {}) {
  if (!encryptedEnvelope || typeof encryptedEnvelope !== 'object') return '密文备份格式不合法';
  if (encryptedEnvelope.source !== 'ai-dca-secure-sync') return '密文备份格式不合法';
  if (typeof encryptedEnvelope.ciphertext !== 'string' || !encryptedEnvelope.ciphertext) return '密文备份格式不合法';
  if (encryptedEnvelope.ciphertext.length > MAX_SYNC_SNAPSHOT_BYTES) return '密文备份过大';
  const version = Number(encryptedEnvelope.version);
  if (!Number.isInteger(version) || version < 2 || version > 3) return '不支持的备份版本';
  if (!encryptedEnvelope.crypto || typeof encryptedEnvelope.crypto !== 'object') return '密文备份格式不合法';
  try {
    if (JSON.stringify(encryptedEnvelope).length > MAX_SYNC_SNAPSHOT_BYTES) return '密文备份过大';
  } catch {
    return '密文备份格式不合法';
  }
  return '';
}

async function ensureSyncAccount(env, userId) {
  const now = nowIso();
  await env.DB.prepare(`INSERT OR IGNORE INTO sync_accounts
    (user_id, migration_status, migration_completed_at, migration_completed_by, created_at, updated_at)
    VALUES (?, 'migration_pending', '', '', ?, ?)`)
    .bind(userId, now, now).run();
  return env.DB.prepare('SELECT user_id AS userId, migration_status AS migrationStatus, migration_completed_at AS migrationCompletedAt, migration_completed_by AS migrationCompletedBy FROM sync_accounts WHERE user_id = ?')
    .bind(userId).first();
}

async function currentSyncBackup(env, userId) {
  return env.DB.prepare(`SELECT version, kv_key AS kvKey, updated_at AS updatedAt, key_count AS keyCount, bytes,
    content_hash AS contentHash, envelope, cipher_sha256 AS cipherSha256, last_end_id AS lastEndId,
    last_end_type AS lastEndType, sync_mode AS syncMode
    FROM backups WHERE user_id = ?`).bind(userId).first();
}

async function readStoredEncryptedEnvelope(env, user, row) {
  if (!row) return null;
  let encoded = row.envelope ? String(row.envelope) : '';
  if (!encoded && row.kvKey && env.SYNC_BACKUPS) {
    const legacy = await env.SYNC_BACKUPS.get(row.kvKey);
    encoded = legacy ? String(legacy) : '';
  } else if (encoded && row.cipherSha256) {
    const actual = await sha256Hex(encoded);
    if (actual !== String(row.cipherSha256)) {
      throw Object.assign(new Error('云端密文完整性校验失败，请重传备份'), { code: 'STORAGE_CORRUPTED', status: 409 });
    }
  }
  if (!encoded) return null;
  let encryptedEnvelope;
  try {
    encryptedEnvelope = JSON.parse(encoded);
  } catch {
    throw Object.assign(new Error('云端密文解析失败，请重传备份'), { code: 'STORAGE_CORRUPTED', status: 409 });
  }
  if (!row.envelope && row.kvKey) {
    try {
      await env.DB.prepare('UPDATE backups SET envelope = ?, cipher_sha256 = ? WHERE user_id = ?')
        .bind(encoded, await sha256Hex(encoded), user.id).run();
    } catch {
      // KV 兼容回填失败不影响本次读取。
    }
  }
  return encryptedEnvelope;
}

async function currentWriter(env, userId) {
  return env.DB.prepare(`SELECT device_id AS deviceId, device_type AS deviceType,
    session_id AS sessionId, token_hash AS tokenHash, acquired_at AS acquiredAt, expires_at AS expiresAt
    FROM sync_leases WHERE user_id = ?`).bind(userId).first();
}

async function currentDevice(env, userId, deviceId) {
  if (!deviceId) return null;
  return env.DB.prepare(`SELECT device_id AS deviceId, device_type AS deviceType,
    migration_status AS migrationStatus, local_signature AS localSignature,
    first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, completed_at AS completedAt
    FROM sync_devices WHERE user_id = ? AND device_id = ?`).bind(userId, deviceId).first();
}

function leaseIsActive(lease, now = Date.now()) {
  return Boolean(lease && Date.parse(String(lease.expiresAt || '')) > now);
}

function writerSummary(lease, deviceId = '', sessionId = '') {
  if (!lease || !leaseIsActive(lease)) return null;
  return {
    deviceId: String(lease.deviceId || ''),
    deviceType: String(lease.deviceType || ''),
    sessionId: String(lease.sessionId || ''),
    expiresAt: String(lease.expiresAt || ''),
    isCurrentDevice: Boolean(
      deviceId
        && String(lease.deviceId || '') === String(deviceId)
        && (!lease.sessionId || !sessionId || String(lease.sessionId) === String(sessionId))
    )
  };
}


function analyticsEventIdentity(event = {}) {
  return String(event.userId || event.visitorId || '').trim();
}

async function updateDailyAnalyticsAggregate(env, events = []) {
  const dailyStats = new Map();
  const dailyUsers = new Map();
  for (const event of events) {
    const date = String(event.date || event.createdAt || nowIso()).slice(0, 10);
    const type = String(event.type || '');
    const stats = dailyStats.get(date) || { pv: 0, switchRuns: 0 };
    if (type === 'page_view') stats.pv += 1;
    if (type === 'switch_worker_run') stats.switchRuns += 1;
    dailyStats.set(date, stats);
    const identity = analyticsEventIdentity(event);
    if (!identity) continue;
    const key = date + '\u0000' + identity;
    const user = dailyUsers.get(key) || { date, identity, isVisitorOnly: 0, hasPageView: 0, hasPageEngagement: 0 };
    if (type === 'page_view') user.hasPageView = 1;
    if (type === 'page_engagement') user.hasPageEngagement = 1;
    if (!event.userId && event.visitorId) user.isVisitorOnly = 1;
    dailyUsers.set(key, user);
  }
  const statements = [];
  for (const [date, stats] of dailyStats) {
    statements.push(env.DB.prepare(`INSERT INTO analytics_daily_stats (event_date, pv, switch_runs) VALUES (?, ?, ?)
      ON CONFLICT(event_date) DO UPDATE SET pv = pv + excluded.pv, switch_runs = switch_runs + excluded.switch_runs`).bind(date, stats.pv, stats.switchRuns));
  }
  for (const user of dailyUsers.values()) {
    statements.push(env.DB.prepare(`INSERT INTO analytics_daily_users (event_date, identity, is_visitor_only, has_page_view, has_page_engagement) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(event_date, identity) DO UPDATE SET
        is_visitor_only = MAX(is_visitor_only, excluded.is_visitor_only),
        has_page_view = MAX(has_page_view, excluded.has_page_view),
        has_page_engagement = MAX(has_page_engagement, excluded.has_page_engagement)
    `).bind(user.date, user.identity, user.isVisitorOnly, user.hasPageView, user.hasPageEngagement));
  }
  if (!statements.length) return;
  if (typeof env.DB.batch === 'function') {
    await env.DB.batch(statements);
    return;
  }
  for (const statement of statements) await statement.run();
}

async function backfillDailyAnalytics(env) {
  const marker = await env.DB.prepare("SELECT value FROM analytics_daily_meta WHERE key = 'core_v1'").first();
  if (marker?.value === '1') return;
  await env.DB.prepare(`INSERT INTO analytics_daily_stats (event_date, pv, switch_runs)
    SELECT event_date,
      SUM(CASE WHEN type = 'page_view' THEN 1 ELSE 0 END),
      SUM(CASE WHEN type = 'switch_worker_run' THEN 1 ELSE 0 END)
    FROM analytics_events GROUP BY event_date
    ON CONFLICT(event_date) DO UPDATE SET pv = excluded.pv, switch_runs = excluded.switch_runs`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO analytics_daily_users (event_date, identity, is_visitor_only, has_page_view, has_page_engagement)
    SELECT event_date,
      COALESCE(NULLIF(user_id, ''), NULLIF(visitor_id, '')),
      MAX(CASE WHEN visitor_id != '' AND user_id = '' THEN 1 ELSE 0 END),
      MAX(CASE WHEN type = 'page_view' THEN 1 ELSE 0 END),
      MAX(CASE WHEN type = 'page_engagement' THEN 1 ELSE 0 END)
    FROM analytics_events
    WHERE COALESCE(NULLIF(user_id, ''), NULLIF(visitor_id, '')) IS NOT NULL
    GROUP BY event_date, COALESCE(NULLIF(user_id, ''), NULLIF(visitor_id, ''))`).run();
  await env.DB.prepare("INSERT OR REPLACE INTO analytics_daily_meta (key, value) VALUES ('core_v1', '1')").run();
}

async function handleTrackAnalytics(request, env, origin) {
  const body = await readBody(request);
  const events = Array.isArray(body?.events) ? body.events.slice(0, 50) : [body];
  const acceptedEvents = [];
  for (const rawEvent of events) {
    if (!rawEvent || typeof rawEvent !== 'object') continue;
    const id = String(rawEvent.id || randomId('evt_')).slice(0, 96);
    const type = String(rawEvent.type || '').trim().slice(0, 64);
    if (!type) continue;
    const createdAt = String(rawEvent.createdAt || nowIso()).slice(0, 40);
    const eventDate = String(rawEvent.date || createdAt.slice(0, 10) || nowIso().slice(0, 10)).slice(0, 10);
    const normalizedEvent = {
      id,
      type,
      createdAt,
      date: eventDate,
      userId: String(rawEvent.userId || '').slice(0, 96),
      username: normalizeUsername(rawEvent.username || ''),
      visitorId: String(rawEvent.visitorId || '').slice(0, 120),
      sessionId: String(rawEvent.sessionId || '').slice(0, 120),
      path: String(rawEvent.path || '').slice(0, 500),
      meta: JSON.stringify(rawEvent.meta || {}).slice(0, 4000)
    };
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO analytics_events
      (id, type, user_id, username, visitor_id, session_id, path, event_date, created_at, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        normalizedEvent.id,
        normalizedEvent.type,
        normalizedEvent.userId,
        normalizedEvent.username,
        normalizedEvent.visitorId,
        normalizedEvent.sessionId,
        normalizedEvent.path,
        normalizedEvent.date,
        normalizedEvent.createdAt,
        normalizedEvent.meta
      ).run();
    if (result?.meta?.changes === 0) continue;
    acceptedEvents.push(normalizedEvent);
  }
  if (!acceptedEvents.length) return json({ message: 'missing event type' }, { status: 400, origin });
  await updateDailyAnalyticsAggregate(env, acceptedEvents);
  return json({ ok: true, accepted: acceptedEvents.length }, { origin });
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
  if (wants('overview', 'traffic')) await backfillDailyAnalytics(env);
  const usersRow = wants('overview') ? await env.DB.prepare('SELECT COUNT(*) AS total FROM users').first() : null;
  const visitorUsersRow = wants('overview') ? await env.DB.prepare(`SELECT
    COUNT(DISTINCT visitor_id) AS total
    FROM analytics_events
    WHERE visitor_id != ''
      AND COALESCE(NULLIF(user_id, ''), NULLIF(username, ''), '') = ''`).first() : null;
  const cardsRows = wants('overview') ? await env.DB.prepare(`SELECT
    (SELECT COALESCE(SUM(pv), 0) FROM analytics_daily_stats WHERE event_date >= ?) AS pv,
    (SELECT COUNT(*) FROM analytics_daily_users WHERE event_date >= ? AND has_page_view = 1) AS uv,
    COUNT(CASE WHEN type = 'ai_used' THEN 1 END) AS aiEvents,
    COUNT(DISTINCT CASE WHEN type = 'ai_used' THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS aiUsers,
    COUNT(CASE WHEN type IN ('notify_enabled','notify_used') THEN 1 END) AS notifyEvents,
    COUNT(DISTINCT CASE WHEN type IN ('notify_enabled','notify_used') THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS notifyUsers,
    COUNT(CASE WHEN type = 'switch_worker_run' THEN 1 END) AS switchRuns,
    COUNT(DISTINCT CASE WHEN type = 'switch_worker_run' THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS switchUsers
    FROM analytics_events WHERE event_date >= ?`).bind(since, since, since).first() : null;
  const overviewDailyActiveRows = wants('overview') ? await env.DB.prepare(`SELECT
    stats.event_date AS date,
    COUNT(CASE WHEN users.has_page_view = 1 OR users.has_page_engagement = 1 THEN 1 END) AS activeUsers
    FROM analytics_daily_stats AS stats
    LEFT JOIN analytics_daily_users AS users ON users.event_date = stats.event_date
    WHERE stats.event_date >= ?
    GROUP BY stats.event_date ORDER BY stats.event_date`).bind(since).all() : { results: [] };
  const dailyRows = wants('traffic') ? await env.DB.prepare(`SELECT
    stats.event_date AS date,
    stats.pv AS pv,
    COUNT(CASE WHEN users.has_page_view = 1 THEN 1 END) AS uv,
    COUNT(CASE WHEN users.has_page_view = 1 OR users.has_page_engagement = 1 THEN 1 END) AS activeUsers,
    COUNT(CASE WHEN users.is_visitor_only = 1 THEN 1 END) AS visitorUsers,
    stats.switch_runs AS switchRuns
    FROM analytics_daily_stats AS stats
    LEFT JOIN analytics_daily_users AS users ON users.event_date = stats.event_date
    WHERE stats.event_date >= ?
    GROUP BY stats.event_date ORDER BY stats.event_date`).bind(since).all() : { results: [] };
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

async function deleteAllUserCloudData(env, userId) {
  let deletedKeys = 0;
  if (env.SYNC_BACKUPS) {
    const prefixes = [userDataPrefix(userId), `secure-config:${String(userId || '').trim()}:`, `backup:${String(userId || '').trim()}`];
    for (const prefix of prefixes) {
      if (typeof env.SYNC_BACKUPS.list === 'function') {
        let cursor = undefined;
        do {
          const page = await env.SYNC_BACKUPS.list({ prefix, ...(cursor ? { cursor } : {}) });
          for (const item of page?.keys || []) {
            await env.SYNC_BACKUPS.delete(item.name);
            deletedKeys += 1;
          }
          cursor = page?.list_complete ? undefined : page?.cursor;
        } while (cursor);
      } else {
        await env.SYNC_BACKUPS.delete(prefix);
      }
    }
  }
  for (const statement of [
    'DELETE FROM user_data_mutations WHERE user_id = ?',
    'DELETE FROM user_data_resources WHERE user_id = ?',
    'DELETE FROM user_data_migrations WHERE user_id = ?',
    'DELETE FROM sync_devices WHERE user_id = ?',
    'DELETE FROM sync_leases WHERE user_id = ?',
    'DELETE FROM sync_accounts WHERE user_id = ?',
    'DELETE FROM backups WHERE user_id = ?'
  ]) {
    try { await env.DB.prepare(statement).bind(userId).run(); } catch { /* 旧数据库尚未有新表时继续清理其它表。 */ }
  }
  return deletedKeys;
}

async function handleDeleteLatest(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const body = await readBody(request);
  if (String(body?.confirmation || '') !== 'delete') {
    return json({ message: '请输入 delete 确认清除云端数据' }, { status: 400, origin });
  }

  const current = await env.DB.prepare('SELECT kv_key AS kvKey FROM backups WHERE user_id = ?').bind(user.id).first();
  const kvKey = String(current?.kvKey || 'backup:' + user.id);
  const deletedKeys = await deleteAllUserCloudData(env, user.id);

  return json({ ok: true, deleted: Boolean(current) || deletedKeys > 0, kvKey }, { origin });
}

// 新逐资源数据层的账号级清除入口。旧 /latest DELETE 保留同样语义，
// 这里提供明确的 /data 路径给新客户端，确保业务版本、迁移状态和旧快照一起删除。
async function handleDeleteUserDataAccount(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const body = await readBody(request);
  if (String(body?.confirmation || '') !== 'delete') {
    return json({ message: '请输入 delete 确认清除云端数据' }, { status: 400, origin });
  }
  const deletedKeys = await deleteAllUserCloudData(env, user.id);
  return json({ ok: true, deleted: true, deletedKeys }, { origin });
}

async function handleGetSecureConfig(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  if (!env.SYNC_BACKUPS) return json({ message: '同步 KV 未配置', code: 'KV_NOT_CONFIGURED' }, { status: 503, origin });
  const key = normalizeSecureConfigKey(new URL(request.url).searchParams.get('key'));
  if (!key) return json({ message: '不支持的同步配置 key', code: 'CONFIG_KEY_NOT_ALLOWED' }, { status: 400, origin });
  const stored = await env.SYNC_BACKUPS.getWithMetadata(secureConfigStorageKey(user.id, key), { type: 'text' });
  let encrypted = null;
  try { encrypted = stored?.value ? JSON.parse(String(stored.value)) : null; } catch { encrypted = null; }
  return json({ key, encrypted, updatedAt: String(stored?.metadata?.updatedAt || '') }, { origin });
}

async function handlePutSecureConfig(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  if (!env.SYNC_BACKUPS) return json({ message: '同步 KV 未配置', code: 'KV_NOT_CONFIGURED' }, { status: 503, origin });
  const body = await readBody(request);
  const key = normalizeSecureConfigKey(body.key);
  if (!key) return json({ message: '不支持的同步配置 key', code: 'CONFIG_KEY_NOT_ALLOWED' }, { status: 400, origin });
  const encrypted = body.encrypted;
  if (!encrypted || typeof encrypted !== 'object' || encrypted.source !== 'ai-dca-secure-sync' || !encrypted.ciphertext || !encrypted.crypto) {
    return json({ message: '加密配置格式不合法', code: 'ENCRYPTED_CONFIG_INVALID' }, { status: 400, origin });
  }
  const encoded = JSON.stringify(encrypted);
  if (encoded.length > 1024 * 1024) return json({ message: '同步配置过大', code: 'CONFIG_TOO_LARGE' }, { status: 413, origin });
  const updatedAt = nowIso();
  await env.SYNC_BACKUPS.put(secureConfigStorageKey(user.id, key), encoded, { metadata: { updatedAt } });
  return json({ ok: true, key, updatedAt }, { origin });
}

async function handleDeleteSecureConfig(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  if (!env.SYNC_BACKUPS) return json({ message: '同步 KV 未配置', code: 'KV_NOT_CONFIGURED' }, { status: 503, origin });
  const key = normalizeSecureConfigKey(new URL(request.url).searchParams.get('key'));
  if (!key) return json({ message: '不支持的同步配置 key', code: 'CONFIG_KEY_NOT_ALLOWED' }, { status: 400, origin });
  await env.SYNC_BACKUPS.delete(secureConfigStorageKey(user.id, key));
  return json({ ok: true, key, deleted: true }, { origin });
}

function userDataResponse(row, resourceId) {
  if (!row) return {
    resource: resourceId,
    revision: 0,
    schemaVersion: USER_DATA_SCHEMA_VERSION,
    updatedAt: '',
    contentHash: '',
    deleted: false,
    encrypted: null
  };
  return {
    resource: resourceId,
    revision: Number(row.revision) || 0,
    schemaVersion: Number(row.schemaVersion) || USER_DATA_SCHEMA_VERSION,
    updatedAt: String(row.updatedAt || ''),
    contentHash: String(row.contentHash || ''),
    deleted: Boolean(Number(row.deleted)),
    encrypted: null
  };
}

async function currentUserDataResource(env, userId, resourceId) {
  return env.DB.prepare(`SELECT user_id AS userId, resource_id AS resourceId,
    revision, schema_version AS schemaVersion, kv_key AS kvKey, content_hash AS contentHash,
    cipher_sha256 AS cipherSha256, updated_at AS updatedAt, deleted, mutation_id AS mutationId,
    bytes FROM user_data_resources WHERE user_id = ? AND resource_id = ?`)
    .bind(userId, resourceId).first();
}

async function existingUserDataMutation(env, userId, resourceId, mutationId) {
  if (!mutationId) return null;
  return env.DB.prepare(`SELECT user_id AS userId, resource_id AS resourceId,
    mutation_id AS mutationId, revision, schema_version AS schemaVersion, kv_key AS kvKey,
    content_hash AS contentHash, cipher_sha256 AS cipherSha256, updated_at AS updatedAt,
    deleted, bytes FROM user_data_mutations
    WHERE user_id = ? AND resource_id = ? AND mutation_id = ?`)
    .bind(userId, resourceId, mutationId).first();
}

async function userDataMutationResponse(env, row, resourceId) {
  const response = userDataResponse(row, resourceId);
  if (!row || Number(row.deleted)) return response;
  if (!env.SYNC_BACKUPS || !row.kvKey) {
    return { ...response, encrypted: null, retryable: true };
  }
  const encoded = await env.SYNC_BACKUPS.get(row.kvKey);
  if (encoded == null) {
    return null;
  }
  const actual = await sha256Hex(String(encoded));
  if (row.cipherSha256 && actual !== String(row.cipherSha256)) {
    throw Object.assign(new Error('用户数据密文完整性校验失败'), { code: 'STORAGE_CORRUPTED', status: 409 });
  }
  let encrypted;
  try { encrypted = JSON.parse(String(encoded)); } catch {
    throw Object.assign(new Error('用户数据密文解析失败'), { code: 'STORAGE_CORRUPTED', status: 409 });
  }
  return { ...response, encrypted };
}

function normalizeEncryptedResource(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.source !== 'ai-dca-secure-sync') return null;
  if (typeof value.ciphertext !== 'string' || !value.ciphertext) return null;
  if (!value.crypto || typeof value.crypto !== 'object') return null;
  return value;
}

async function handleUserDataManifest(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const account = await ensureSyncAccount(env, user.id);
  const rows = await env.DB.prepare(`SELECT resource_id AS resourceId, revision,
    schema_version AS schemaVersion, content_hash AS contentHash, updated_at AS updatedAt,
    deleted, bytes FROM user_data_resources WHERE user_id = ? ORDER BY resource_id`)
    .bind(user.id).all();
  const migration = await getUserDataMigration(env, user.id, new URL(request.url).searchParams.get('deviceId'));
  const legacy = await currentSyncBackup(env, user.id);
  return json({
    resources: (rows.results || []).map((row) => ({
      resourceId: String(row.resourceId || ''),
      revision: Number(row.revision) || 0,
      schemaVersion: Number(row.schemaVersion) || USER_DATA_SCHEMA_VERSION,
      contentHash: String(row.contentHash || ''),
      updatedAt: String(row.updatedAt || ''),
      deleted: Boolean(Number(row.deleted)),
      bytes: Number(row.bytes) || 0
    })),
    migration,
    legacySnapshot: Boolean(legacy),
    legacySnapshotMeta: legacy ? {
      version: Number(legacy.version) || 0,
      updatedAt: String(legacy.updatedAt || ''),
      contentHash: String(legacy.contentHash || ''),
      keyCount: Number(legacy.keyCount) || 0,
      bytes: Number(legacy.bytes) || 0
    } : null,
    accountStatus: String(account?.migrationStatus || 'migration_pending')
  }, { origin });
}

async function handleGetUserDataResource(request, env, origin, resourceId) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  if (!normalizeUserDataResource(resourceId)) return json({ message: '不支持的同步资源', code: 'RESOURCE_NOT_ALLOWED' }, { status: 400, origin });
  const row = await currentUserDataResource(env, user.id, resourceId);
  if (!row) return json(userDataResponse(null, resourceId), { origin });
  if (Number(row.deleted)) return json(userDataResponse(row, resourceId), { origin });
  const response = await userDataMutationResponse(env, row, resourceId);
  if (!response) return json({ message: '用户数据正在传播，请稍后重试', code: 'RESOURCE_NOT_PROPAGATED', resource: resourceId, revision: Number(row.revision) || 0 }, { status: 503, origin });
  return json(response, { origin });
}

function revisionConflict(resourceId, current, origin = '*') {
  return json({
    message: '云端资源已更新，请先拉取后合并',
    code: 'RESOURCE_REVISION_MISMATCH',
    resource: resourceId,
    currentRevision: Number(current?.revision) || 0,
    currentHash: String(current?.contentHash || ''),
    updatedAt: String(current?.updatedAt || '')
  }, { status: 409, origin });
}

async function handlePutUserDataResource(request, env, origin, resourceId) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  if (!normalizeUserDataResource(resourceId)) return json({ message: '不支持的同步资源', code: 'RESOURCE_NOT_ALLOWED' }, { status: 400, origin });
  if (!env.SYNC_BACKUPS) return json({ message: '同步 KV 未配置', code: 'KV_NOT_CONFIGURED' }, { status: 503, origin });
  const body = await readBody(request);
  const mutationId = normalizeMutationId(body.mutationId);
  if (!mutationId) return json({ message: '缺少 mutationId', code: 'MUTATION_REQUIRED' }, { status: 400, origin });
  const baseRevision = Number(body.baseRevision);
  if (!isFiniteRevision(baseRevision)) return json({ message: '缺少有效的 baseRevision', code: 'BASE_REVISION_REQUIRED' }, { status: 400, origin });
  const schemaVersion = normalizeSchemaVersion(body.schemaVersion);
  const encrypted = normalizeEncryptedResource(body.encrypted || body.encryptedEnvelope);
  if (!encrypted) return json({ message: '用户数据密文格式不合法', code: 'ENCRYPTED_RESOURCE_INVALID' }, { status: 400, origin });
  const encoded = JSON.stringify(encrypted);
  if (encoded.length > MAX_USER_DATA_RESOURCE_BYTES) return json({ message: '用户数据资源过大', code: 'RESOURCE_TOO_LARGE' }, { status: 413, origin });
  const existingMutation = await existingUserDataMutation(env, user.id, resourceId, mutationId);
  if (existingMutation) return json({ ...existingMutation, resource: resourceId, idempotent: true }, { origin });
  const current = await currentUserDataResource(env, user.id, resourceId);
  const currentRevision = Number(current?.revision) || 0;
  if (current && String(current.mutationId || '') === mutationId) {
    const replay = await userDataMutationResponse(env, current, resourceId);
    return json({ ...(replay || userDataResponse(current, resourceId)), idempotent: true }, { origin });
  }
  if (currentRevision !== baseRevision) return revisionConflict(resourceId, current, origin);
  const revision = currentRevision + 1;
  const updatedAt = nowIso();
  const kvKey = userDataStorageKey(user.id, resourceId, mutationId);
  const cipherSha256 = await sha256Hex(encoded);
  const contentHash = String(body.contentHash || body.hash || encrypted?.meta?.contentHash || '').slice(0, 256);
  await env.SYNC_BACKUPS.put(kvKey, encoded);
  try {
    let result;
    if (current) {
      result = await env.DB.prepare(`UPDATE user_data_resources SET revision = ?, schema_version = ?, kv_key = ?,
        content_hash = ?, cipher_sha256 = ?, updated_at = ?, deleted = 0, mutation_id = ?, bytes = ?
        WHERE user_id = ? AND resource_id = ? AND revision = ?`)
        .bind(revision, schemaVersion, kvKey, contentHash, cipherSha256, updatedAt, mutationId, encoded.length, user.id, resourceId, baseRevision).run();
    } else {
      result = await env.DB.prepare(`INSERT INTO user_data_resources
        (user_id, resource_id, revision, schema_version, kv_key, content_hash, cipher_sha256, updated_at, deleted, mutation_id, bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
        .bind(user.id, resourceId, revision, schemaVersion, kvKey, contentHash, cipherSha256, updatedAt, mutationId, encoded.length).run();
    }
    if (result?.meta?.changes === 0) return revisionConflict(resourceId, await currentUserDataResource(env, user.id, resourceId), origin);
    await env.DB.prepare(`INSERT OR IGNORE INTO user_data_mutations
      (user_id, resource_id, mutation_id, revision, schema_version, kv_key, content_hash, cipher_sha256, updated_at, deleted, bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
      .bind(user.id, resourceId, mutationId, revision, schemaVersion, kvKey, contentHash, cipherSha256, updatedAt, encoded.length).run();
  } catch (error) {
    const after = await currentUserDataResource(env, user.id, resourceId);
    if ((Number(after?.revision) || 0) !== baseRevision) return revisionConflict(resourceId, after, origin);
    throw error;
  }
  return json({ ok: true, resource: resourceId, revision, schemaVersion, updatedAt, contentHash, bytes: encoded.length, mutationId }, { origin });
}

async function handleDeleteUserDataResource(request, env, origin, resourceId) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  if (!normalizeUserDataResource(resourceId)) return json({ message: '不支持的同步资源', code: 'RESOURCE_NOT_ALLOWED' }, { status: 400, origin });
  const body = await readBody(request);
  const mutationId = normalizeMutationId(body.mutationId);
  const baseRevision = Number(body.baseRevision);
  if (!mutationId) return json({ message: '缺少 mutationId', code: 'MUTATION_REQUIRED' }, { status: 400, origin });
  if (!isFiniteRevision(baseRevision)) return json({ message: '缺少有效的 baseRevision', code: 'BASE_REVISION_REQUIRED' }, { status: 400, origin });
  const existingMutation = await existingUserDataMutation(env, user.id, resourceId, mutationId);
  if (existingMutation) return json({ ...existingMutation, resource: resourceId, idempotent: true }, { origin });
  const current = await currentUserDataResource(env, user.id, resourceId);
  const currentRevision = Number(current?.revision) || 0;
  if (current && String(current.mutationId || '') === mutationId) {
    return json({ ...userDataResponse(current, resourceId), idempotent: true }, { origin });
  }
  if (currentRevision !== baseRevision) return revisionConflict(resourceId, current, origin);
  const revision = currentRevision + 1;
  const updatedAt = nowIso();
  let result;
  if (current) {
    result = await env.DB.prepare(`UPDATE user_data_resources SET revision = ?, schema_version = ?, kv_key = '',
      content_hash = '', cipher_sha256 = '', updated_at = ?, deleted = 1, mutation_id = ?, bytes = 0
      WHERE user_id = ? AND resource_id = ? AND revision = ?`)
      .bind(revision, normalizeSchemaVersion(body.schemaVersion), updatedAt, mutationId, user.id, resourceId, baseRevision).run();
  } else {
    result = await env.DB.prepare(`INSERT INTO user_data_resources
      (user_id, resource_id, revision, schema_version, kv_key, content_hash, cipher_sha256, updated_at, deleted, mutation_id, bytes)
      VALUES (?, ?, ?, ?, '', '', '', ?, 1, ?, 0)`)
      .bind(user.id, resourceId, revision, normalizeSchemaVersion(body.schemaVersion), updatedAt, mutationId).run();
  }
  if (result?.meta?.changes === 0) return revisionConflict(resourceId, await currentUserDataResource(env, user.id, resourceId), origin);
  await env.DB.prepare(`INSERT OR IGNORE INTO user_data_mutations
    (user_id, resource_id, mutation_id, revision, schema_version, kv_key, content_hash, cipher_sha256, updated_at, deleted, bytes)
    VALUES (?, ?, ?, ?, ?, '', '', '', ?, 1, 0)`)
    .bind(user.id, resourceId, mutationId, revision, normalizeSchemaVersion(body.schemaVersion), updatedAt).run();
  return json({ ok: true, resource: resourceId, revision, schemaVersion: normalizeSchemaVersion(body.schemaVersion), updatedAt, deleted: true, mutationId }, { origin });
}

async function getUserDataMigration(env, userId, deviceId = '') {
  const normalized = normalizeDeviceId(deviceId);
  if (!normalized) return null;
  const row = await env.DB.prepare(`SELECT user_id AS userId, device_id AS deviceId, status,
    source_hash AS sourceHash, local_signature AS localSignature, completed_resources AS completedResources,
    started_at AS startedAt, updated_at AS updatedAt, completed_at AS completedAt
    FROM user_data_migrations WHERE user_id = ? AND device_id = ?`).bind(userId, normalized).first();
  if (!row) return { deviceId: normalized, status: 'pending', sourceHash: '', completedResources: [] };
  let completedResources = [];
  try { completedResources = JSON.parse(String(row.completedResources || '[]')); } catch { completedResources = []; }
  return { ...row, completedResources: Array.isArray(completedResources) ? completedResources : [] };
}

async function handleUserDataMigration(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  if (request.method === 'GET') {
    const migration = await getUserDataMigration(env, user.id, new URL(request.url).searchParams.get('deviceId'));
    const account = await ensureSyncAccount(env, user.id);
    const legacy = await currentSyncBackup(env, user.id);
    return json({ migration, accountStatus: account?.migrationStatus || 'migration_pending', legacySnapshot: Boolean(legacy) }, { origin });
  }
  const body = await readBody(request);
  const deviceId = normalizeDeviceId(body.deviceId);
  const action = String(body.action || '').trim().toLowerCase();
  if (!deviceId || !['begin', 'checkpoint', 'complete', 'discard'].includes(action)) {
    return json({ message: '迁移请求参数不合法', code: 'MIGRATION_REQUEST_INVALID' }, { status: 400, origin });
  }
  const previous = await getUserDataMigration(env, user.id, deviceId);
  const now = nowIso();
  const sourceHash = String(body.sourceHash || previous?.sourceHash || '').slice(0, 256);
  const localSignature = String(body.localSignature || previous?.localSignature || '').slice(0, 256);
  let completed = Array.isArray(previous?.completedResources) ? previous.completedResources : [];
  if (action === 'checkpoint') {
    const resource = normalizeUserDataResource(body.resourceId);
    if (!resource) return json({ message: '迁移资源不合法', code: 'RESOURCE_NOT_ALLOWED' }, { status: 400, origin });
    const checkpoint = { resourceId: resource, revision: Number(body.revision) || 0, contentHash: String(body.contentHash || '') };
    const byResource = new Map(completed.filter((item) => item && item.resourceId).map((item) => [String(item.resourceId), item]));
    byResource.set(resource, checkpoint);
    completed = [...byResource.values()];
  }
  const status = action === 'complete' ? 'completed' : action === 'discard' ? 'cancelled' : 'collecting';
  const completedAt = status === 'completed' ? now : String(previous?.completedAt || '');
  await env.DB.prepare(`INSERT INTO user_data_migrations
    (user_id, device_id, status, source_hash, local_signature, completed_resources, started_at, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, device_id) DO UPDATE SET status = excluded.status,
      source_hash = excluded.source_hash, local_signature = excluded.local_signature,
      completed_resources = excluded.completed_resources, updated_at = excluded.updated_at,
      completed_at = excluded.completed_at`)
    .bind(user.id, deviceId, status, sourceHash, localSignature, JSON.stringify(completed), previous?.startedAt || now, now, completedAt).run();
  return json({ ok: true, deviceId, status, sourceHash, completedResources: completed, completedAt }, { origin });
}

function syncError(message, code, status = 409, extra = {}) {
  return Object.assign(new Error(message), { code, status, ...extra });
}

async function handleV2RegisterDevice(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const body = await readBody(request);
  const deviceId = normalizeDeviceId(body.deviceId);
  const deviceType = normalizeDeviceType(body.deviceType);
  if (!deviceId) return json({ message: '缺少设备会话标识', code: 'DEVICE_REQUIRED' }, { status: 400, origin });
  const account = await ensureSyncAccount(env, user.id);
  const backup = await currentSyncBackup(env, user.id);
  const existing = await currentDevice(env, user.id, deviceId);
  const hasLocalData = Boolean(body.hasLocalData);
  const signature = String(body.localSignature || '').slice(0, 180);
  const now = nowIso();
  let migrationStatus = String(existing?.migrationStatus || '');
  if (!existing) {
    // 没有旧云端快照的新账号，或没有本地业务数据的新设备，直接进入 v2。
    migrationStatus = !backup || !hasLocalData ? 'completed' : 'pending';
    await env.DB.prepare(`INSERT INTO sync_devices
      (user_id, device_id, device_type, migration_status, local_signature, first_seen_at, last_seen_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(user.id, deviceId, deviceType, migrationStatus, signature, now, now, migrationStatus === 'completed' ? now : '').run();
  } else {
    migrationStatus = existing.migrationStatus || 'pending';
    await env.DB.prepare(`UPDATE sync_devices SET device_type = ?, local_signature = ?, last_seen_at = ?
      WHERE user_id = ? AND device_id = ?`)
      .bind(deviceType || existing.deviceType || '', signature, now, user.id, deviceId).run();
    // 账号迁移完成后重新出现且仍带有本机数据的旧会话，必须显式重新归集，不能静默覆盖云端。
    if (String(account?.migrationStatus || '') === 'completed' && migrationStatus !== 'completed' && hasLocalData) {
      migrationStatus = 'pending';
      await env.DB.prepare(`UPDATE sync_devices SET migration_status = 'pending', completed_at = ''
        WHERE user_id = ? AND device_id = ?`).bind(user.id, deviceId).run();
    }
  }
  const latestAccount = await ensureSyncAccount(env, user.id);
  return json({
    account: latestAccount || account,
    device: {
      deviceId,
      deviceType: deviceType || existing?.deviceType || '',
      migrationStatus,
      needsMigration: migrationStatus !== 'completed'
    },
    mode: backup ? (String(backup.syncMode || '') || 'legacy') : 'v2',
    revision: Number(backup?.version) || 0
  }, { origin });
}

async function handleV2Snapshot(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const url = new URL(request.url);
  const deviceId = normalizeDeviceId(url.searchParams.get('deviceId'));
  const deviceType = normalizeDeviceType(url.searchParams.get('deviceType'));
  const sessionId = normalizeDeviceId(url.searchParams.get('sessionId'));
  const account = await ensureSyncAccount(env, user.id);
  const device = await currentDevice(env, user.id, deviceId);
  const backup = await currentSyncBackup(env, user.id);
  const lease = await currentWriter(env, user.id);
  let encryptedEnvelope = null;
  try {
    encryptedEnvelope = await readStoredEncryptedEnvelope(env, user, backup);
  } catch (error) {
    return json({ message: error.message, code: error.code || 'STORAGE_CORRUPTED' }, { status: error.status || 409, origin });
  }
  return json({
    mode: backup ? (String(backup.syncMode || '') || 'legacy') : 'v2',
    revision: Number(backup?.version) || 0,
    updatedAt: backup?.updatedAt || '',
    keyCount: Number(backup?.keyCount) || 0,
    bytes: Number(backup?.bytes) || 0,
    contentHash: backup?.contentHash || '',
    encryptedEnvelope,
    migration: {
      accountStatus: account?.migrationStatus || 'migration_pending',
      accountCompletedAt: account?.migrationCompletedAt || '',
      deviceStatus: device?.migrationStatus || '',
      needsMigration: Boolean(device && device.migrationStatus !== 'completed'),
      deviceId,
      deviceType: deviceType || device?.deviceType || ''
    },
    writer: writerSummary(lease, deviceId, sessionId)
  }, { origin });
}

async function handleV2Devices(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const account = await ensureSyncAccount(env, user.id);
  const rows = await env.DB.prepare(`SELECT device_id AS deviceId, device_type AS deviceType,
    migration_status AS migrationStatus, local_signature AS localSignature,
    first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, completed_at AS completedAt
    FROM sync_devices WHERE user_id = ? ORDER BY last_seen_at DESC`).bind(user.id).all();
  const lease = await currentWriter(env, user.id);
  return json({ account, devices: rows.results || [], writer: writerSummary(lease) }, { origin });
}

async function handleV2StartDeviceMigration(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const body = await readBody(request);
  const deviceId = normalizeDeviceId(body.deviceId);
  if (!deviceId) return json({ message: '缺少设备会话标识', code: 'DEVICE_REQUIRED' }, { status: 400, origin });
  const device = await currentDevice(env, user.id, deviceId);
  if (!device) return json({ message: '设备未登记', code: 'DEVICE_NOT_REGISTERED' }, { status: 404, origin });
  const now = nowIso();
  await env.DB.prepare("UPDATE sync_devices SET migration_status = 'collecting', last_seen_at = ? WHERE user_id = ? AND device_id = ?")
    .bind(now, user.id, deviceId).run();
  return json({ ok: true, deviceId, migrationStatus: 'collecting' }, { origin });
}

async function handleV2CompleteDevice(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const body = await readBody(request);
  const deviceId = normalizeDeviceId(body.deviceId);
  if (!deviceId) return json({ message: '缺少设备会话标识', code: 'DEVICE_REQUIRED' }, { status: 400, origin });
  const device = await currentDevice(env, user.id, deviceId);
  if (!device) return json({ message: '设备未登记', code: 'DEVICE_NOT_REGISTERED' }, { status: 404, origin });
  const completedAt = nowIso();
  await env.DB.prepare(`UPDATE sync_devices SET migration_status = 'completed', completed_at = ?, last_seen_at = ?
    WHERE user_id = ? AND device_id = ?`).bind(completedAt, completedAt, user.id, deviceId).run();
  if (body.accountComplete) {
    await env.DB.prepare(`UPDATE sync_accounts SET migration_status = 'completed', migration_completed_at = ?,
      migration_completed_by = ?, updated_at = ? WHERE user_id = ?`)
      .bind(completedAt, deviceId, completedAt, user.id).run();
  }
  return json({ ok: true, deviceId, migrationStatus: 'completed', accountStatus: body.accountComplete ? 'completed' : 'migration_pending' }, { origin });
}

async function handleV2FinalizeMigration(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const pending = await env.DB.prepare(`SELECT COUNT(*) AS count FROM sync_devices
    WHERE user_id = ? AND migration_status != 'completed'`).bind(user.id).first();
  if (Number(pending?.count) > 0) {
    return json({ message: '仍有设备尚未完成归集', code: 'MIGRATION_DEVICES_PENDING', pendingDevices: Number(pending.count) }, { status: 409, origin });
  }
  const completedAt = nowIso();
  await env.DB.prepare(`UPDATE sync_accounts SET migration_status = 'completed', migration_completed_at = ?,
    migration_completed_by = ?, updated_at = ? WHERE user_id = ?`)
    .bind(completedAt, user.id, completedAt, user.id).run();
  return json({ ok: true, accountStatus: 'completed', completedAt }, { origin });
}

async function handleV2AcquireWriter(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const body = await readBody(request);
  const deviceId = normalizeDeviceId(body.deviceId);
  const deviceType = normalizeDeviceType(body.deviceType);
  const sessionId = normalizeDeviceId(body.sessionId) || 'legacy-session';
  const migration = body.migration === true;
  if (!deviceId) return json({ message: '缺少设备会话标识', code: 'DEVICE_REQUIRED' }, { status: 400, origin });
  const device = await currentDevice(env, user.id, deviceId);
  const deviceMigrationStatus = String(device?.migrationStatus || '');
  const migrationDevice = migration && ['pending', 'collecting'].includes(deviceMigrationStatus);
  if (!device || (deviceMigrationStatus !== 'completed' && !migrationDevice)) {
    return json({ message: '该设备尚未完成首次数据归集', code: 'MIGRATION_REQUIRED', deviceStatus: device?.migrationStatus || 'pending' }, { status: 409, origin });
  }
  const existing = await currentWriter(env, user.id);
  if (leaseIsActive(existing)
      && (String(existing.deviceId) !== deviceId || (existing.sessionId && String(existing.sessionId) !== sessionId))
      && !body.takeover) {
    return json({
      message: '已有其它设备持有编辑权',
      code: 'WRITER_BUSY',
      writer: writerSummary(existing, deviceId, sessionId)
    }, { status: 409, origin });
  }
  const writerToken = randomId('wrt_');
  const tokenHash = await sha256Hex(writerToken);
  const acquiredAt = nowIso();
  const expiresAt = new Date(Date.now() + WRITER_LEASE_SECONDS * 1000).toISOString();
  try {
    if (existing) {
      await env.DB.prepare(`UPDATE sync_leases SET device_id = ?, device_type = ?, session_id = ?, token_hash = ?, acquired_at = ?, expires_at = ?
        WHERE user_id = ?`).bind(deviceId, deviceType || device.deviceType || '', sessionId, tokenHash, acquiredAt, expiresAt, user.id).run();
    } else {
      await env.DB.prepare(`INSERT INTO sync_leases (user_id, device_id, device_type, session_id, token_hash, acquired_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(user.id, deviceId, deviceType, sessionId, tokenHash, acquiredAt, expiresAt).run();
    }
  } catch {
    const afterRace = await currentWriter(env, user.id);
    if (leaseIsActive(afterRace)
        && (String(afterRace.deviceId) !== deviceId || (afterRace.sessionId && String(afterRace.sessionId) !== sessionId))) {
      return json({ message: '已有其它设备持有编辑权', code: 'WRITER_BUSY', writer: writerSummary(afterRace, deviceId, sessionId) }, { status: 409, origin });
    }
    throw new Error('编辑权暂时不可用，请重试');
  }
  const backup = await currentSyncBackup(env, user.id);
  return json({
    writerToken,
    deviceId,
    deviceType: deviceType || device.deviceType || '',
    sessionId,
    acquiredAt,
    expiresAt,
    leaseTtlSeconds: WRITER_LEASE_SECONDS,
    revision: Number(backup?.version) || 0,
    takeover: Boolean(body.takeover),
    migration
  }, { origin });
}

async function requireWriterLease(request, env, user, body) {
  const deviceId = normalizeDeviceId(body.deviceId);
  const sessionId = normalizeDeviceId(body.sessionId);
  const writerToken = String(body.writerToken || '').trim();
  if (!deviceId || !writerToken) throw syncError('缺少编辑权凭证', 'WRITER_REQUIRED', 409);
  const lease = await currentWriter(env, user.id);
  const tokenHash = await sha256Hex(writerToken);
  if (!lease
      || String(lease.deviceId) !== deviceId
      || (lease.sessionId && String(lease.sessionId) !== sessionId)
      || String(lease.tokenHash) !== tokenHash
      || !leaseIsActive(lease)) {
    throw syncError('编辑权已失效，当前设备已切换为只读', 'WRITER_LEASE_LOST', 409, { writer: writerSummary(lease, deviceId, sessionId) });
  }
  return { deviceId, sessionId, writerToken, lease };
}

async function handleV2HeartbeatWriter(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const body = await readBody(request);
  try {
    const { deviceId, sessionId } = await requireWriterLease(request, env, user, body);
    const expiresAt = new Date(Date.now() + WRITER_LEASE_SECONDS * 1000).toISOString();
    await env.DB.prepare('UPDATE sync_leases SET expires_at = ? WHERE user_id = ? AND device_id = ? AND session_id = ?')
      .bind(expiresAt, user.id, deviceId, sessionId).run();
    return json({ ok: true, deviceId, sessionId, expiresAt, leaseTtlSeconds: WRITER_LEASE_SECONDS }, { origin });
  } catch (error) {
    return json({ message: error.message, code: error.code || 'WRITER_LEASE_LOST', writer: error.writer || null }, { status: error.status || 409, origin });
  }
}

async function handleV2ReleaseWriter(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const body = await readBody(request);
  try {
    const { deviceId, sessionId } = await requireWriterLease(request, env, user, body);
    await env.DB.prepare('DELETE FROM sync_leases WHERE user_id = ? AND device_id = ? AND session_id = ?').bind(user.id, deviceId, sessionId).run();
    return json({ ok: true, deviceId, sessionId }, { origin });
  } catch (error) {
    return json({ message: error.message, code: error.code || 'WRITER_LEASE_LOST' }, { status: error.status || 409, origin });
  }
}

async function handleV2PutSnapshot(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const body = await readBody(request);
  const encryptedEnvelope = body.encryptedEnvelope || {};
  const formatError = validateEncryptedEnvelope(encryptedEnvelope);
  if (formatError) return json({ message: formatError, code: 'INVALID_SNAPSHOT' }, { status: 400, origin });
  if (!isFiniteRevision(body.baseRevision)) return json({ message: '缺少有效的云端基线版本', code: 'BASE_REVISION_REQUIRED' }, { status: 400, origin });
  try {
    const { deviceId, sessionId, lease } = await requireWriterLease(request, env, user, body);
    const current = await currentSyncBackup(env, user.id);
    const currentRevision = Number(current?.version) || 0;
    const baseRevision = Number(body.baseRevision);
    if (baseRevision !== currentRevision) {
      return json({ message: '云端数据已被其它设备更新，请先拉取后再编辑', code: 'REVISION_MISMATCH', currentRevision, writer: writerSummary(await currentWriter(env, user.id), deviceId, sessionId) }, { status: 409, origin });
    }
    const incomingHash = String(encryptedEnvelope?.meta?.contentHash || '');
    if (current && incomingHash && incomingHash === String(current.contentHash || '')) {
      return json({ revision: currentRevision, version: currentRevision, updatedAt: current.updatedAt, keyCount: Number(current.keyCount) || 0, bytes: Number(current.bytes) || 0, contentHash: incomingHash, unchanged: true }, { origin });
    }
    const encoded = JSON.stringify(encryptedEnvelope);
    const cipherSha = await sha256Hex(encoded);
    const updatedAt = nowIso();
    const revision = currentRevision + 1;
    const keyCount = Number(encryptedEnvelope?.meta?.keyCount) || 0;
    const end = body.end && typeof body.end === 'object' ? body.end : {};
    const endId = String(end.id || deviceId).slice(0, 120);
    const endType = String(end.type || '').slice(0, 40);
    const kvKey = current?.kvKey || `backup:${user.id}`;
    if (current) {
      const updateResult = await env.DB.prepare(`UPDATE backups SET version = ?, updated_at = ?, key_count = ?, bytes = ?, content_hash = ?,
        envelope = ?, cipher_sha256 = ?, last_end_id = ?, last_end_type = ?, sync_mode = 'v2'
        WHERE user_id = ? AND version = ? AND EXISTS (
          SELECT 1 FROM sync_leases
          WHERE user_id = ? AND device_id = ? AND session_id = ? AND token_hash = ? AND expires_at > ?
        )`)
        .bind(revision, updatedAt, keyCount, encoded.length, incomingHash, encoded, cipherSha, endId, endType,
          user.id, baseRevision, user.id, deviceId, sessionId, lease.tokenHash, nowIso()).run();
      if (Number.isFinite(Number(updateResult?.meta?.changes)) && Number(updateResult.meta.changes) === 0) {
        const currentLease = await currentWriter(env, user.id);
        if (!currentLease || String(currentLease.tokenHash) !== String(lease.tokenHash)) {
          throw syncError('编辑权已失效，当前设备已切换为只读', 'WRITER_LEASE_LOST', 409, { writer: writerSummary(currentLease, deviceId, sessionId) });
        }
        return json({ message: '云端数据已被其它请求更新，请先拉取后再编辑', code: 'REVISION_MISMATCH', currentRevision: Number((await currentSyncBackup(env, user.id))?.version) || 0, writer: writerSummary(currentLease, deviceId, sessionId) }, { status: 409, origin });
      }
    } else {
      await env.DB.prepare(`INSERT INTO backups (user_id, version, kv_key, updated_at, key_count, bytes, content_hash, envelope, cipher_sha256, last_end_id, last_end_type, sync_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(user.id, revision, kvKey, updatedAt, keyCount, encoded.length, incomingHash, encoded, cipherSha, endId, endType, 'v2').run();
    }
    if (env.SYNC_BACKUPS) {
      try { await env.SYNC_BACKUPS.put(kvKey, encoded); } catch { /* D1 是主存储，KV 仅为兼容镜像。 */ }
    }
    return json({ revision, version: revision, updatedAt, keyCount, bytes: encoded.length, contentHash: incomingHash, deviceId, mode: 'v2' }, { origin });
  } catch (error) {
    return json({ message: error.message, code: error.code || 'WRITER_LEASE_LOST', writer: error.writer || null }, { status: error.status || 409, origin });
  }
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
      if (request.method === 'GET' && url.pathname === '/api/sync/data/manifest') return handleUserDataManifest(request, env, origin);
      if (request.method === 'DELETE' && url.pathname === '/api/sync/data') return handleDeleteUserDataAccount(request, env, origin);
      if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/api/sync/migration') return handleUserDataMigration(request, env, origin);
      if (url.pathname.startsWith('/api/sync/data/')) {
        const resourceId = normalizeUserDataResource(decodeURIComponent(url.pathname.slice('/api/sync/data/'.length)));
        if (!resourceId) return json({ message: '不支持的用户数据资源', code: 'RESOURCE_NOT_ALLOWED' }, { status: 400, origin });
        if (request.method === 'GET') return handleGetUserDataResource(request, env, origin, resourceId);
        if (request.method === 'PUT') return handlePutUserDataResource(request, env, origin, resourceId);
        if (request.method === 'DELETE') return handleDeleteUserDataResource(request, env, origin, resourceId);
      }
      if (request.method === 'GET' && url.pathname === '/api/sync/v2/snapshot') return handleV2Snapshot(request, env, origin);
      if (request.method === 'PUT' && url.pathname === '/api/sync/v2/snapshot') return handleV2PutSnapshot(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/api/sync/secure-config') return handleGetSecureConfig(request, env, origin);
      if (request.method === 'PUT' && url.pathname === '/api/sync/secure-config') return handlePutSecureConfig(request, env, origin);
      if (request.method === 'DELETE' && url.pathname === '/api/sync/secure-config') return handleDeleteSecureConfig(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/api/sync/v2/devices/register') return handleV2RegisterDevice(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/api/sync/v2/devices') return handleV2Devices(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/api/sync/v2/devices/collecting') return handleV2StartDeviceMigration(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/api/sync/v2/devices/complete') return handleV2CompleteDevice(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/api/sync/v2/migration/finalize') return handleV2FinalizeMigration(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/api/sync/v2/writer/acquire') return handleV2AcquireWriter(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/api/sync/v2/writer/heartbeat') return handleV2HeartbeatWriter(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/api/sync/v2/writer/release') return handleV2ReleaseWriter(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/api/sync/meta') return handleMeta(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/api/sync/latest') return handleGetLatest(request, env, origin);
      if (request.method === 'PUT' && url.pathname === '/api/sync/latest') return handlePutLatest(request, env, origin);
      if (request.method === 'DELETE' && url.pathname === '/api/sync/latest') return handleDeleteLatest(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/api/sync/health') return json({ ok: true, service: 'sync', at: nowIso() }, { origin });
      return json({ message: 'not found' }, { status: 404, origin });
    } catch (err) {
      console.error(JSON.stringify({ message: 'sync request failed', error: err?.message || 'server error', code: err?.code || '', path: url.pathname, method: request.method }));
      return json({ message: err?.message || 'server error', code: err?.code || '' }, { status: err?.status || 500, origin });
    }
  }
};
