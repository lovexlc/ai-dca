import { jsonResponse, readOrigin } from './notifyHttp.js';
import { VERIFIED_NOTIFY_USER_ID_HEADER, VERIFIED_NOTIFY_USERNAME_HEADER } from './notifyAccountAuth.js';
import { buildAccountClientId, normalizeNotifyUserId } from './clientSettings.js';
import { maskServerChan3SendKey } from './channels/serverChan3.js';
import { maskEmailAddress, normalizeEmailConfig } from './channels/email.js';

const TABLE = 'notify_user_records';
function text(value = '', max = 240) { return String(value ?? '').trim().slice(0, max); }
function parse(value, fallback = {}) { try { const data = JSON.parse(String(value || '')); return data && typeof data === 'object' ? data : fallback; } catch { return fallback; } }
function accountOf(request) { const userId = normalizeNotifyUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER)); const username = text(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER), 48).toLowerCase(); if (!userId || !username) { const error = new Error('请先登录账户。'); error.status = 401; error.code = 'AUTH_REQUIRED'; throw error; } return { userId, username, clientId: buildAccountClientId(userId) }; }
function timed(payload, request, startedAt, queryAt) { const queryMs = Date.now() - queryAt; const response = jsonResponse(payload, { origin: readOrigin(request) }); const headers = new Headers(response.headers); headers.set('server-timing', `query;dur=${queryMs}, total;dur=${Date.now() - startedAt}`); return new Response(response.body, { status: response.status, headers }); }
async function rows(env, owner, type, limit = 64) { const result = await env.SYNC_DB.prepare(`SELECT record_id, payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = ? ORDER BY updated_at DESC LIMIT ?`).bind(owner, type, limit).all(); return result?.results || []; }

async function statusSummary(request, env, account, startedAt, queryAt) {
  const ids = [`${account.clientId}::bark`, `${account.clientId}::serverchan3`, `${account.clientId}::email`];
  const [records, counts] = await Promise.all([
    env.SYNC_DB.prepare(`SELECT record_type, record_id, payload FROM ${TABLE} WHERE owner_user_id = ? AND ((record_type = 'client' AND record_id = ?) OR (record_type = 'client-channel' AND record_id IN (?, ?, ?)) OR (record_type = 'client-meta' AND record_id = ?))`).bind(account.userId, account.clientId, ...ids, account.clientId).all(),
    env.SYNC_DB.prepare(`SELECT SUM(record_type='event') event_count, SUM(record_type='delivery-failure') failure_count, SUM(record_type='registration') registration_count FROM ${TABLE} WHERE owner_user_id = ?`).bind(account.userId).first()
  ]);
  const state = { client: {}, meta: {}, bark: '', server: {}, email: {} };
  for (const row of records?.results || []) { const value = parse(row.payload); if (row.record_type === 'client') state.client = value; else if (row.record_type === 'client-meta') state.meta = value; else if (String(row.record_id).endsWith('::bark')) state.bark = text(value.barkDeviceKey); else if (String(row.record_id).endsWith('::serverchan3')) state.server = value.serverChan3 || {}; else if (String(row.record_id).endsWith('::email')) state.email = value.email || {}; }
  const email = normalizeEmailConfig(state.email); const registrationCount = Number(counts?.registration_count) || 0;
  return timed({ ok: true, schemaVersion: 1, data: {
    account: { clientId: account.clientId, accountClientId: account.clientId, username: account.username, label: text(state.client.clientLabel) || `账号通知 · ${account.username}`, notifyGroupId: account.clientId },
    channels: { bark: { configured: Boolean(state.bark), deviceKey: state.bark }, serverChan3: { uid: text(state.server.uid), sendKeyMasked: maskServerChan3SendKey(state.server.sendKey || ''), configured: Boolean(text(state.server.uid) && text(state.server.sendKey)) }, email: { maskedAddress: maskEmailAddress(email.address), verified: Boolean(email.verified), verifiedAt: text(email.verifiedAt) || null, enabled: Boolean(email.enabled), configured: Boolean(email.address && email.verified && email.enabled) }, webWs: { configured: registrationCount > 0 } },
    rules: { planRuleCount: Number(state.meta?.counts?.planRuleCount) || 0, dcaRuleCount: Number(state.meta?.counts?.dcaRuleCount) || 0, totalRuleCount: Number(state.meta?.counts?.totalRuleCount) || 0 },
    timestamps: { lastSyncedAt: text(state.meta.lastSyncedAt) || null, lastCheckedAt: text(state.meta.lastCheckedAt) || null, lastTestedAt: text(state.meta.lastTestedAt) || null },
    delivery: { eventCount: Number(counts?.event_count) || 0, failureCount: Number(counts?.failure_count) || 0 },
    webSockets: { groupId: account.clientId, groupMemberCount: registrationCount, registrationCount, currentClientId: account.clientId, currentClientRegistrationCount: registrationCount, pairedRegistrationCount: registrationCount, unpairedRegistrationCount: 0 }
  } }, request, startedAt, queryAt);
}

async function statusDetails(request, env, account, startedAt, queryAt) {
  const [eventRows, failureRows, registrationRows] = await Promise.all([rows(env, account.userId, 'event', 30), rows(env, account.userId, 'delivery-failure', 30), rows(env, account.userId, 'registration', 64)]);
  const events = eventRows.map((row) => parse(row.payload)?.value).filter(Boolean); const failures = failureRows.map((row) => parse(row.payload)?.value).filter(Boolean); const registrations = registrationRows.map((row) => parse(row.payload)).filter(Boolean);
  const current = registrations.filter((item) => (item.pairedClients || []).some((paired) => paired.groupId === account.clientId || paired.clientId === account.clientId));
  return timed({ ok: true, schemaVersion: 1, data: { account: { clientId: account.clientId, accountClientId: account.clientId }, delivery: { eventCount: events.length, lastEvent: events[0] || null, failureCount: failures.length, failures }, webSockets: { groupMemberClientIds: current.flatMap((item) => (item.pairedClients || []).map((paired) => paired.clientId)).filter(Boolean), registrations, currentClientRegistrations: current } } }, request, startedAt, queryAt);
}

export async function handleAccountStatus(request, env) { const startedAt = Date.now(); const queryAt = Date.now(); const account = accountOf(request); const view = new URL(request.url).searchParams.get('view'); return view === 'details' ? statusDetails(request, env, account, startedAt, queryAt) : statusSummary(request, env, account, startedAt, queryAt); }
export async function handleAccountEvents(request, env) { const startedAt = Date.now(); const queryAt = Date.now(); const account = accountOf(request); const result = await rows(env, account.userId, 'event', 30); return timed({ events: result.map((row) => parse(row.payload)?.value).filter(Boolean) }, request, startedAt, queryAt); }
