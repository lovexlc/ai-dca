import { jsonResponse, readOrigin } from './notifyHttp.js';
import { VERIFIED_NOTIFY_USER_ID_HEADER, VERIFIED_NOTIFY_USERNAME_HEADER } from './notifyAccountAuth.js';
import { buildAccountClientId, normalizeNotifyUserId } from './clientSettings.js';
import { holdingsRuleKey, normalizeHoldingsDigest } from './holdingsNavSupport.js';
import { normalizeSwitchConfig, switchConfigKey, switchSnapshotKey } from './switchStrategy.js';

const TABLE = 'notify_user_records';
function text(value = '', max = 240) { return String(value ?? '').trim().slice(0, max); }
function parse(value, fallback = null) { try { const data = JSON.parse(String(value || '')); return data && typeof data === 'object' ? data : fallback; } catch { return fallback; } }
function accountOf(request) {
  const userId = normalizeNotifyUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER));
  const username = text(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER), 48).toLowerCase();
  if (!userId || !username) { const error = new Error('请先登录账户。'); error.status = 401; error.code = 'AUTH_REQUIRED'; throw error; }
  return { userId, username, clientId: buildAccountClientId(userId) };
}
async function readUserKv(env, owner, key) {
  const row = await env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'user-kv' AND record_id = ?`).bind(owner, key).first();
  return parse(row?.payload, null);
}
async function writeUserKv(env, owner, key, value) {
  const now = new Date().toISOString();
  await env.SYNC_DB.prepare(`INSERT INTO ${TABLE} (owner_user_id, record_type, record_id, payload, revision, created_at, updated_at)
    VALUES (?, 'user-kv', ?, ?, 1, ?, ?)
    ON CONFLICT(owner_user_id, record_type, record_id) DO UPDATE SET payload = excluded.payload, revision = ${TABLE}.revision + 1, updated_at = excluded.updated_at`)
    .bind(owner, key, JSON.stringify(value), now, now).run();
}
function timed(payload, request, startedAt) {
  const totalMs = Date.now() - startedAt;
  const response = jsonResponse(payload, { origin: readOrigin(request) });
  const headers = new Headers(response.headers); headers.set('server-timing', `total;dur=${totalMs}`);
  return new Response(response.body, { status: response.status, headers });
}

export async function handleFastHoldingsRule(request, env) {
  const startedAt = Date.now(); const account = accountOf(request); const key = holdingsRuleKey(account.clientId);
  if (request.method === 'GET') {
    const stored = await readUserKv(env, account.userId, key);
    return timed(stored ? { enabled: Boolean(stored.enabled), digest: stored.digest || null, updatedAt: stored.updatedAt || '' } : { enabled: false, digest: null, updatedAt: '' }, request, startedAt);
  }
  const payload = await request.json().catch(() => ({}));
  const value = { enabled: Boolean(payload.enabled), digest: normalizeHoldingsDigest(payload.digest), updatedAt: new Date().toISOString(), clientLabel: `账号通知 · ${account.username}`, accountUsername: account.username };
  await writeUserKv(env, account.userId, key, value);
  return timed({ enabled: value.enabled, digest: value.digest, updatedAt: value.updatedAt }, request, startedAt);
}

export async function handleFastSwitchConfig(request, env) {
  const startedAt = Date.now(); const account = accountOf(request); const key = switchConfigKey(account.clientId);
  if (request.method === 'GET') {
    const stored = await readUserKv(env, account.userId, key);
    return timed({ ok: true, clientId: account.clientId, config: stored ? normalizeSwitchConfig(stored) : normalizeSwitchConfig({ enabled: false }) }, request, startedAt);
  }
  const payload = await request.json().catch(() => ({}));
  const value = normalizeSwitchConfig({ ...payload, clientLabel: `账号通知 · ${account.username}`, updatedAt: new Date().toISOString() });
  await writeUserKv(env, account.userId, key, value);
  return timed({ ok: true, config: value }, request, startedAt);
}

export async function handleFastSwitchSnapshot(request, env) {
  const startedAt = Date.now(); const account = accountOf(request);
  const [snapshot, config] = await Promise.all([
    readUserKv(env, account.userId, switchSnapshotKey(account.clientId)),
    readUserKv(env, account.userId, switchConfigKey(account.clientId))
  ]);
  return timed({ ok: true, snapshot, config: config ? normalizeSwitchConfig(config) : normalizeSwitchConfig({ enabled: false }) }, request, startedAt);
}
