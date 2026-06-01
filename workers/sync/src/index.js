const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function corsHeaders(origin = '*') {
  return {
    'access-control-allow-origin': origin,
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
  try {
    await env.DB.prepare("ALTER TABLE backups ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''").run();
  } catch {
    // 现有表可能已存在。
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
  return { userId: user.id, username: user.username, accessToken, refreshToken, expiresAt: expires };
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
  const id = String(body.id || randomId('evt_')).slice(0, 96);
  const type = String(body.type || '').trim().slice(0, 64);
  if (!type) return json({ message: 'missing event type' }, { status: 400, origin });
  const createdAt = String(body.createdAt || nowIso()).slice(0, 40);
  const eventDate = String(body.date || createdAt.slice(0, 10) || nowIso().slice(0, 10)).slice(0, 10);
  await env.DB.prepare(`INSERT OR IGNORE INTO analytics_events
    (id, type, user_id, username, visitor_id, session_id, path, event_date, created_at, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id,
      type,
      String(body.userId || '').slice(0, 96),
      normalizeUsername(body.username || ''),
      String(body.visitorId || '').slice(0, 120),
      String(body.sessionId || '').slice(0, 120),
      String(body.path || '').slice(0, 500),
      eventDate,
      createdAt,
      JSON.stringify(body.meta || {}).slice(0, 4000)
    ).run();
  return json({ ok: true }, { origin });
}

async function handleAdminAnalytics(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  if (user.username !== 'lovexl') return json({ message: '无管理员权限' }, { status: 403, origin });
  const url = new URL(request.url);
  const rangeDays = Math.max(1, Math.min(Number(url.searchParams.get('rangeDays')) || 30, 365));
  const since = new Date(Date.now() - (rangeDays - 1) * 86400000).toISOString().slice(0, 10);
  const usersRow = await env.DB.prepare('SELECT COUNT(*) AS total FROM users').first();
  const cardsRows = await env.DB.prepare(`SELECT
    COUNT(CASE WHEN type = 'page_view' THEN 1 END) AS pv,
    COUNT(DISTINCT CASE WHEN type = 'page_view' THEN visitor_id END) AS uv,
    COUNT(CASE WHEN type = 'ai_used' THEN 1 END) AS aiEvents,
    COUNT(DISTINCT CASE WHEN type = 'ai_used' THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS aiUsers,
    COUNT(CASE WHEN type IN ('notify_enabled','notify_used') THEN 1 END) AS notifyEvents,
    COUNT(DISTINCT CASE WHEN type IN ('notify_enabled','notify_used') THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS notifyUsers,
    COUNT(CASE WHEN type = 'switch_worker_run' THEN 1 END) AS switchRuns,
    COUNT(DISTINCT CASE WHEN type = 'switch_worker_run' THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS switchUsers
    FROM analytics_events WHERE event_date >= ?`).bind(since).first();
  const dailyRows = await env.DB.prepare(`SELECT event_date AS date,
    COUNT(CASE WHEN type = 'page_view' THEN 1 END) AS pv,
    COUNT(DISTINCT CASE WHEN type = 'page_view' THEN visitor_id END) AS uv,
    COUNT(CASE WHEN type = 'switch_worker_run' THEN 1 END) AS switchRuns
    FROM analytics_events WHERE event_date >= ? GROUP BY event_date ORDER BY event_date`).bind(since).all();
  const pagesRows = await env.DB.prepare(`SELECT path AS key,
    COUNT(*) AS pv,
    COUNT(DISTINCT visitor_id) AS uv
    FROM analytics_events WHERE event_date >= ? AND type = 'page_view'
    GROUP BY path ORDER BY pv DESC LIMIT 8`).bind(since).all();
  const recentRows = await env.DB.prepare(`SELECT id, type, user_id AS userId, username, visitor_id AS visitorId, path, event_date AS date, created_at AS createdAt, meta
    FROM analytics_events WHERE event_date >= ? ORDER BY created_at DESC LIMIT 20`).bind(since).all();
  const platformRows = await env.DB.prepare(`SELECT
    COUNT(DISTINCT CASE WHEN type = 'notify_enabled' AND json_extract(meta, '$.hasBark') = 1 THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS iosUsers,
    COUNT(DISTINCT CASE WHEN type = 'notify_used' AND json_extract(meta, '$.platform') = 'android' THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS androidUsers,
    COUNT(DISTINCT CASE WHEN type = 'notify_enabled' AND EXISTS (SELECT 1 FROM json_each(json_extract(meta, '$.platforms')) WHERE value = 'android') THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS androidEnabledUsers,
    COUNT(DISTINCT CASE WHEN type = 'notify_enabled' AND EXISTS (SELECT 1 FROM json_each(json_extract(meta, '$.platforms')) WHERE value = 'pc') THEN COALESCE(NULLIF(user_id, ''), visitor_id) END) AS pcUsers
    FROM analytics_events WHERE event_date >= ? AND type IN ('notify_enabled','notify_used')`).bind(since).first();

  return json({
    rangeDays,
    generatedAt: nowIso(),
    cards: {
      registeredUsers: Number(usersRow?.total) || 0,
      pv: Number(cardsRows?.pv) || 0,
      uv: Number(cardsRows?.uv) || 0,
      aiUsers: Number(cardsRows?.aiUsers) || 0,
      notifyUsers: Number(cardsRows?.notifyUsers) || 0,
      switchRuns: Number(cardsRows?.switchRuns) || 0,
      notifyPlatformUsers: {
        ios: Number(platformRows?.iosUsers) || 0,
        android: (Number(platformRows?.androidUsers) || 0) || (Number(platformRows?.androidEnabledUsers) || 0),
        pc: Number(platformRows?.pcUsers) || 0
      }
    },
    daily: (dailyRows.results || []).map((row) => ({
      date: String(row.date || '').slice(5),
      fullDate: row.date,
      pv: Number(row.pv) || 0,
      uv: Number(row.uv) || 0,
      switchRuns: Number(row.switchRuns) || 0
    })),
    pages: pagesRows.results || [],
    features: [
      { key: 'AI 使用', value: Number(cardsRows?.aiEvents) || 0, users: Number(cardsRows?.aiUsers) || 0 },
      { key: '通知使用', value: Number(cardsRows?.notifyEvents) || 0, users: Number(cardsRows?.notifyUsers) || 0 },
      { key: '切换运行', value: Number(cardsRows?.switchRuns) || 0, users: Number(cardsRows?.switchUsers) || 0 }
    ],
    recent: (recentRows.results || []).map((row) => ({ ...row, meta: (() => { try { return JSON.parse(row.meta || '{}'); } catch { return {}; } })() }))
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
  const meta = await env.DB.prepare('SELECT version, updated_at AS updatedAt, key_count AS keyCount, bytes FROM backups WHERE user_id = ?').bind(user.id).first();
  return json(meta || { version: null, updatedAt: '', keyCount: 0, bytes: 0 }, { origin });
}

async function handleGetLatest(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const meta = await env.DB.prepare('SELECT version, updated_at AS updatedAt, key_count AS keyCount, bytes, kv_key AS kvKey FROM backups WHERE user_id = ?').bind(user.id).first();
  if (!meta) return json({ version: null, encryptedEnvelope: null }, { origin });
  const encryptedEnvelope = await env.SYNC_BACKUPS.get(meta.kvKey, { type: 'json' });
  return json({ ...meta, encryptedEnvelope }, { origin });
}

async function handlePutLatest(request, env, origin) {
  const user = await requireUser(request, env);
  if (!user) return json({ message: '未登录' }, { status: 401, origin });
  const body = await readBody(request);
  const encryptedEnvelope = body.encryptedEnvelope || {};
  if (!encryptedEnvelope.ciphertext || encryptedEnvelope.source !== 'ai-dca-secure-sync') {
    return json({ message: '密文备份格式不合法' }, { status: 400, origin });
  }
  const current = await env.DB.prepare('SELECT version, kv_key AS kvKey, updated_at AS updatedAt, key_count AS keyCount, bytes, content_hash AS contentHash FROM backups WHERE user_id = ?').bind(user.id).first();
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
  const baseVersion = body.baseVersion == null ? null : Number(body.baseVersion);
  if (current && baseVersion !== null && Number(current.version) !== baseVersion) {
    return json({ message: '云端数据已更新，请先处理冲突', currentVersion: current.version }, { status: 409, origin });
  }
  const version = current ? Number(current.version) + 1 : 1;
  const kvKey = current?.kvKey || `backup:${user.id}`;
  const encoded = JSON.stringify(encryptedEnvelope);
  await env.SYNC_BACKUPS.put(kvKey, encoded);
  const updatedAt = nowIso();
  const keyCount = Number(encryptedEnvelope?.meta?.keyCount) || 0;
  if (current) {
    await env.DB.prepare('UPDATE backups SET version = ?, updated_at = ?, key_count = ?, bytes = ?, content_hash = ? WHERE user_id = ?')
      .bind(version, updatedAt, keyCount, encoded.length, incomingHash, user.id).run();
  } else {
    await env.DB.prepare('INSERT INTO backups (user_id, version, kv_key, updated_at, key_count, bytes, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(user.id, version, kvKey, updatedAt, keyCount, encoded.length, incomingHash).run();
  }
  return json({ version, updatedAt, keyCount, bytes: encoded.length }, { origin });
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
