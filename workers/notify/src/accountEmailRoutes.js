import { jsonResponse, readOrigin } from './notifyHttp.js';
import { VERIFIED_NOTIFY_USER_ID_HEADER, VERIFIED_NOTIFY_USERNAME_HEADER } from './notifyAccountAuth.js';
import { buildAccountClientId, hashText, normalizeNotifyUserId } from './clientSettings.js';
import { clearEmailVerification, createEmailVerification, getRequestIp, getVerifiedEmailVerification, verifyEmailCode } from './emailVerification.js';
import { maskEmailAddress, normalizeEmailAddress, normalizeEmailConfig } from './channels/email.js';

const RECORDS = 'notify_user_records';
const BINDINGS = 'notify_channel_bindings';
function text(value = '', max = 240) { return String(value ?? '').trim().slice(0, max); }
function parse(value, fallback = {}) { try { const data = JSON.parse(String(value || '')); return data && typeof data === 'object' ? data : fallback; } catch { return fallback; } }
function accountOf(request) { const userId = normalizeNotifyUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER)); const username = text(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER), 48).toLowerCase(); if (!userId || !username) { const error = new Error('请先登录账户。'); error.status = 401; error.code = 'AUTH_REQUIRED'; throw error; } return { userId, username, clientId: buildAccountClientId(userId) }; }
function publicEmail(email = {}) { const value = normalizeEmailConfig(email); return { maskedAddress: maskEmailAddress(value.address), verified: value.verified, verifiedAt: value.verifiedAt, enabled: value.enabled }; }
async function readEmail(env, account) { const row = await env.SYNC_DB.prepare(`SELECT payload FROM ${RECORDS} WHERE owner_user_id = ? AND record_type = 'client-channel' AND record_id = ?`).bind(account.userId, `${account.clientId}::email`).first(); return normalizeEmailConfig(parse(row?.payload)?.email || {}); }
async function writeEmail(env, account, email, hash = '') { const now = new Date().toISOString(); const payload = JSON.stringify({ clientId: account.clientId, email: normalizeEmailConfig(email) }); const statements = [env.SYNC_DB.prepare(`INSERT INTO ${RECORDS} (owner_user_id, record_type, record_id, payload, revision, created_at, updated_at) VALUES (?, 'client-channel', ?, ?, 1, ?, ?) ON CONFLICT(owner_user_id, record_type, record_id) DO UPDATE SET payload=excluded.payload, revision=${RECORDS}.revision+1, updated_at=excluded.updated_at`).bind(account.userId, `${account.clientId}::email`, payload, now, now), env.SYNC_DB.prepare(`DELETE FROM ${BINDINGS} WHERE owner_user_id = ? AND channel_type = 'email'`).bind(account.userId)]; if (hash) statements.push(env.SYNC_DB.prepare(`INSERT INTO ${BINDINGS} (channel_type, token_hash, owner_user_id, client_id, channel_identity, created_at, updated_at) VALUES ('email', ?, ?, ?, ?, ?, ?) ON CONFLICT(channel_type, token_hash) DO UPDATE SET owner_user_id=excluded.owner_user_id, client_id=excluded.client_id, channel_identity=excluded.channel_identity, updated_at=excluded.updated_at`).bind(hash, account.userId, account.clientId, maskEmailAddress(email.address), now, now)); await env.SYNC_DB.batch(statements); }
function response(payload, request, startedAt) { const result = jsonResponse(payload, { origin: readOrigin(request) }); const headers = new Headers(result.headers); headers.set('server-timing', `total;dur=${Date.now() - startedAt}`); return new Response(result.body, { status: result.status, headers }); }

export async function handleFastEmailRoute(request, env, pathname) {
  const startedAt = Date.now(); const account = accountOf(request); const origin = readOrigin(request);
  if (pathname.endsWith('/status')) { const email = await readEmail(env, account); return response({ ok: true, binding: { scope: 'account', accountClientId: account.clientId }, email: publicEmail(email) }, request, startedAt); }
  const payload = await request.json().catch(() => ({}));
  if (pathname.endsWith('/send-code')) { const email = normalizeEmailAddress(payload.email); if (!email) return jsonResponse({ error: '请输入有效的邮箱地址。' }, { status: 400, origin }); const result = await createEmailVerification(env, { userId: account.userId, email, ip: getRequestIp(request) }); return response({ ok: true, maskedAddress: maskEmailAddress(result.email), expiresAt: result.expiresAt }, request, startedAt); }
  if (pathname.endsWith('/verify')) { const result = await verifyEmailCode(env, { userId: account.userId, email: payload.email, code: payload.code }); return response({ ok: true, verified: true, pendingSave: true, maskedAddress: maskEmailAddress(result.email), verifiedAt: result.verifiedAt }, request, startedAt); }
  if (pathname.endsWith('/save')) {
    const email = normalizeEmailAddress(payload.email); if (!email) return jsonResponse({ error: '请输入有效的邮箱地址。' }, { status: 400, origin });
    const verified = await getVerifiedEmailVerification(env, { userId: account.userId, email }); const tokenHash = await hashText(verified.email);
    const binding = await env.SYNC_DB.prepare(`SELECT owner_user_id FROM ${BINDINGS} WHERE channel_type = 'email' AND token_hash = ?`).bind(tokenHash).first();
    if (binding?.owner_user_id && binding.owner_user_id !== account.userId && payload.rebind !== true) return jsonResponse({ error: '该邮箱已绑定其他账号，需要确认重新绑定。', code: 'EMAIL_REBIND_REQUIRED', canRebind: true }, { status: 409, origin });
    if (binding?.owner_user_id && binding.owner_user_id !== account.userId) await env.SYNC_DB.prepare(`DELETE FROM ${RECORDS} WHERE owner_user_id = ? AND record_type = 'client-channel' AND json_extract(payload, '$.email.address') = ?`).bind(binding.owner_user_id, verified.email).run();
    const value = { address: verified.email, verified: true, verifiedAt: verified.verifiedAt, enabled: true }; await writeEmail(env, account, value, tokenHash); await clearEmailVerification(env, account.userId);
    return response({ ok: true, binding: { scope: 'account', accountClientId: account.clientId }, email: publicEmail(value) }, request, startedAt);
  }
  const current = await readEmail(env, account);
  if (pathname.endsWith('/enable') && (!current.address || !current.verified)) return jsonResponse({ error: '邮箱尚未完成验证。' }, { status: 400, origin });
  const value = { ...current, enabled: pathname.endsWith('/enable') }; await writeEmail(env, account, value, current.address ? await hashText(current.address) : '');
  return response({ ok: true, email: publicEmail(value) }, request, startedAt);
}
