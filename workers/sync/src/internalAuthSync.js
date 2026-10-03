/**
 * 内部认证同步接口：接收 cn 主机本地认证服务的 outbox 事件并幂等应用到 D1。
 *
 * 本地服务实际发送的格式（services/auth/src/syncWorker.js）：
 *   { "eventId": "evt_xxx", "eventType": "user.register" | "user.login", "payload": {...} }
 * 为向前兼容，同时接受 snake_case 变体（event_id / event_type）。
 * payload_hash 由服务端根据 payload 的规范 JSON 计算，不信任客户端传入值。
 *
 * 安全：
 * - 必须携带 Authorization: Bearer <INTERNAL_SYNC_TOKEN>（恒定时间比较）
 * - 未配置 INTERNAL_SYNC_TOKEN 时返回 503，拒绝服务，避免误开放
 */

function nowIso() {
  return new Date().toISOString();
}

function json(payload, { status = 200, origin = '*' } = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'access-control-allow-origin': origin,
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

async function sha256Hex(text = '') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 恒定时间字符串比较，防止时序攻击。 */
function timingSafeEqual(a, b) {
  const ab = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/** 规范 JSON：递归按键排序，保证同一 payload 每次哈希一致。 */
function canonicalJson(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function pickEventFields(body) {
  const eventId = body?.eventId ?? body?.event_id ?? '';
  const eventType = body?.eventType ?? body?.event_type ?? '';
  const payload = body?.payload;
  return { eventId: String(eventId), eventType: String(eventType), payload };
}

function isUniqueViolation(err) {
  return String(err?.message || '').includes('UNIQUE constraint failed');
}

async function runBatch(env, statements) {
  if (!statements.length) return;
  if (env.DB && typeof env.DB.batch === 'function') {
    await env.DB.batch(statements);
    return;
  }
  for (const statement of statements) await statement.run();
}

/**
 * user.register 事件：幂等 upsert 用户。
 * 返回 { status, body }，由调用方转为 Response。
 */
async function applyUserRegister(env, payload) {
  const id = String(payload?.id || '').trim();
  const username = String(payload?.username || '').trim().toLowerCase();
  const passwordHash = String(payload?.password_hash || '');
  const passwordSalt = String(payload?.password_salt || '');
  const createdAt = String(payload?.created_at || '') || nowIso();
  const updatedAt = String(payload?.updated_at || '') || nowIso();

  if (!id || username.length < 3) return { status: 400, body: { error: '事件 payload 非法：用户 id/username 缺失' } };
  if (passwordHash.length < 32) return { status: 400, body: { error: '事件 payload 非法：password_hash 缺失' } };

  const existing = await env.DB.prepare(
    'SELECT id, username, password_hash, password_salt FROM users WHERE username = ? OR id = ?'
  )
    .bind(username, id)
    .first();

  if (existing) {
    if (existing.username !== username) {
      // 同 id 但 username 不同：不允许改名式覆盖
      return { status: 409, body: { error: '用户 id 已被占用且用户名不一致' } };
    }
    if (existing.id !== id) {
      // 同 username 但 id 不同：用户名已被占用
      return { status: 409, body: { error: '用户名已被占用' } };
    }
    // 同 id 同 username：凭证必须完全一致，否则拒绝（防重放覆盖）
    if (existing.password_hash !== passwordHash || String(existing.password_salt || '') !== passwordSalt) {
      return { status: 409, body: { error: '用户凭证冲突，拒绝覆盖' } };
    }
    // 完全一致：幂等跳过用户写入
    return { status: 200, body: null };
  }

  return {
    status: 200,
    body: null,
    statements: [
      env.DB.prepare(
        'INSERT INTO users (id, username, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(id, username, passwordHash, passwordSalt, createdAt, updatedAt),
    ],
  };
}

/**
 * user.login 事件：确认用户存在并更新 last_login_at。
 * 本地服务已完成密码校验，这里只做存在性校验与登录时间同步。
 */
async function applyUserLogin(env, payload) {
  const id = String(payload?.id || '').trim();
  const username = String(payload?.username || '').trim().toLowerCase();
  const lastLoginAt = String(payload?.last_login_at || '') || nowIso();

  if (!id || !username) return { status: 400, body: { error: '事件 payload 非法：用户 id/username 缺失' } };

  const existing = await env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(id).first();
  if (!existing) return { status: 404, body: { error: '用户不存在，登录事件无法应用' } };
  if (existing.username !== username) return { status: 409, body: { error: '用户 id 与用户名不一致' } };

  return {
    status: 200,
    body: null,
    statements: [
      env.DB.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').bind(
        lastLoginAt,
        nowIso(),
        id
      ),
    ],
  };
}

/**
 * 可选的 session 同步（payload.session = {token_hash, user_id, created_at, expires_at}）。
 * 已存在的 session 永不修改（尤其不得延长 expires_at）。
 */
async function applySession(env, session) {
  const tokenHash = String(session?.token_hash || '');
  const userId = String(session?.user_id || '');
  const createdAt = String(session?.created_at || '') || nowIso();
  const expiresAt = String(session?.expires_at || '');

  if (!tokenHash || !userId || !expiresAt) return { status: 400, body: { error: '事件 payload 非法：session 字段缺失' } };

  const existing = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .bind(tokenHash)
    .first();

  if (existing) {
    if (existing.user_id !== userId || existing.expires_at !== expiresAt) {
      return { status: 409, body: { error: '会话冲突，拒绝覆盖已有会话' } };
    }
    return { status: 200, body: null };
  }

  return {
    status: 200,
    body: null,
    statements: [
      env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(
        tokenHash,
        userId,
        createdAt,
        expiresAt
      ),
    ],
  };
}

export async function handleInternalAuthSync(request, env, origin = '*') {
  const configuredToken = String(env?.INTERNAL_SYNC_TOKEN || '');
  if (!configuredToken) {
    return json({ error: '内部同步接口未启用' }, { status: 503, origin });
  }

  const auth = request.headers.get('authorization') || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!provided || !timingSafeEqual(provided, configuredToken)) {
    return json({ error: '未授权' }, { status: 401, origin });
  }

  const body = await readBody(request);
  const { eventId, eventType, payload } = pickEventFields(body);
  if (!eventId) return json({ error: '缺少 eventId' }, { status: 400, origin });
  if (!payload || typeof payload !== 'object') return json({ error: '缺少 payload' }, { status: 400, origin });
  if (eventType !== 'user.register' && eventType !== 'user.login') {
    return json({ error: `未知的事件类型：${eventType}` }, { status: 400, origin });
  }

  const payloadHash = await sha256Hex(canonicalJson(payload));

  // 1. 幂等检查
  let recorded = null;
  try {
    recorded = await env.DB.prepare('SELECT payload_hash FROM sync_events WHERE event_id = ?')
      .bind(eventId)
      .first();
  } catch {
    return json({ error: 'sync_events 表不可用' }, { status: 500, origin });
  }
  if (recorded) {
    if (recorded.payload_hash === payloadHash) {
      return json({ ok: true, deduplicated: true }, { origin });
    }
    return json({ error: '事件 payload 冲突' }, { status: 409, origin });
  }

  // 2. 按事件类型应用
  const applier = eventType === 'user.register' ? applyUserRegister : applyUserLogin;
  const applied = await applier(env, payload);
  if (applied.status !== 200) {
    return json(applied.body || { error: '事件应用失败' }, { status: applied.status, origin });
  }

  const statements = [
    env.DB.prepare('INSERT INTO sync_events (event_id, payload_hash, applied_at) VALUES (?, ?, ?)').bind(
      eventId,
      payloadHash,
      nowIso()
    ),
    ...(applied.statements || []),
  ];

  // 可选 session 同步（当前本地服务不发送，保留向前兼容）
  if (payload.session && typeof payload.session === 'object') {
    const sessionApplied = await applySession(env, payload.session);
    if (sessionApplied.status !== 200) {
      return json(sessionApplied.body || { error: '会话应用失败' }, { status: sessionApplied.status, origin });
    }
    statements.push(...(sessionApplied.statements || []));
  }

  // 3. 同一批次原子提交
  try {
    await runBatch(env, statements);
  } catch (err) {
    if (isUniqueViolation(err)) {
      // 并发下另一请求已先应用：重新读取确认
      const raced = await env.DB.prepare('SELECT payload_hash FROM sync_events WHERE event_id = ?')
        .bind(eventId)
        .first()
        .catch(() => null);
      if (raced && raced.payload_hash === payloadHash) {
        return json({ ok: true, deduplicated: true }, { origin });
      }
      return json({ error: '事件应用冲突' }, { status: 409, origin });
    }
    throw err;
  }

  return json({ ok: true }, { origin });
}
