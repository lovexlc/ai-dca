import { jsonResponse, readOrigin } from './notifyHttp.js';
import { VERIFIED_NOTIFY_USER_ID_HEADER, VERIFIED_NOTIFY_USERNAME_HEADER } from './notifyAccountAuth.js';
import { buildAccountClientId, normalizeNotifyUserId } from './clientSettings.js';
import { maskServerChan3SendKey } from './channels/serverChan3.js';
import { maskEmailAddress, normalizeEmailConfig } from './channels/email.js';

const TABLE = 'notify_user_records';
function text(value = '', max = 240) { return String(value ?? '').trim().slice(0, max); }
function parse(value, fallback = {}) { try { const data = JSON.parse(String(value || '')); return data && typeof data === 'object' ? data : fallback; } catch { return fallback; } }
function accountOf(request) {
  const userId = normalizeNotifyUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER));
  const username = text(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER), 48).toLowerCase();
  if (!userId || !username) { const error = new Error('请先登录账户。'); error.status = 401; error.code = 'AUTH_REQUIRED'; throw error; }
  return { userId, username, clientId: buildAccountClientId(userId) };
}
function timedResponse(payload, request, startedAt, queryMs) {
  const response = jsonResponse(payload, { origin: readOrigin(request) });
  const headers = new Headers(response.headers);
  headers.set('server-timing', `query;dur=${queryMs}, total;dur=${Date.now() - startedAt}`);
  return new Response(response.body, { status: response.status, headers });
}

async function loadSummary(env, account) {
  const ids = [`${account.clientId}::bark`, `${account.clientId}::serverchan3`, `${account.clientId}::email`];
  const [rowsResult, counts] = await Promise.all([
    env.SYNC_DB.prepare(`SELECT record_type, record_id, payload FROM ${TABLE}
      WHERE owner_user_id = ? AND ((record_type = 'client' AND record_id = ?)
        OR (record_type = 'client-channel' AND record_id IN (?, ?, ?))
        OR (record_type = 'client-meta' AND record_id = ?))`)
      .bind(account.userId, account.clientId, ...ids, account.clientId).all(),
    env.SYNC_DB.prepare(`SELECT
      SUM(CASE WHEN record_type = 'event' THEN 1 ELSE 0 END) AS event_count,
      SUM(CASE WHEN record_type = 'delivery-failure' THEN 1 ELSE 0 END) AS failure_count,
      SUM(CASE WHEN record_type = 'registration' THEN 1 ELSE 0 END) AS registration_count
      FROM ${TABLE} WHERE owner_user_id = ?`).bind(account.userId).first()
  ]);
  const state = { client: {}, meta: {}, bark: '', server: {}, email: {} };
  for (const row of rowsResult?.results || []) {
    const payload = parse(row.payload);
    if (row.record_type === 'client') state.client = payload;
    else if (row.record_type === 'client-meta') state.meta = payload;
    else if (String(row.record_id).endsWith('::bark')) state.bark = text(payload.barkDeviceKey);
    else if (String(row.record_id).endsWith('::serverchan3')) state.server = payload.serverChan3 || {};
    else if (String(row.record_id).endsWith('::email')) state.email = payload.email || {};
  }
  return { state, counts: counts || {} };
}

async function loadDetails(env, account) {
  const [eventsResult, failuresResult, registrationsResult] = await Promise.all([
    env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'event' ORDER BY updated_at DESC LIMIT 30`).bind(account.userId).all(),
    env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'delivery-failure' ORDER BY updated_at DESC LIMIT 30`).bind(account.userId).all(),
    env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'registration' ORDER BY updated_at DESC LIMIT 64`).bind(account.userId).all()
  ]);
  const events = (eventsResult?.results || []).map((row) => parse(row.payload)?.value).filter(Boolean);
  const failures = (failuresResult?.results || []).map((row) => parse(row.payload)?.value).filter(Boolean);
  const registrations = (registrationsResult?.results || []).map((row) => parse(row.payload)).filter(Boolean);
  return { events, failures, registrations };
}

export async function handleAccountStatus(request, env) {
  const startedAt = Date.now();
  const account = accountOf(request);
  const queryStartedAt = Date.now();
  if (new URL(request.url).pathname.endsWith('/details')) {
    const { events, failures, registrations } = await loadDetails(env, account);
    const currentRegistrations = registrations.filter((item) => (item?.pairedClients || []).some((paired) => paired?.groupId === account.clientId || paired?.clientId === account.clientId));
    const queryMs = Date.now() - queryStartedAt;
    return timedResponse({ ok: true, schemaVersion: 1, data: {
      account: { clientId: account.clientId, accountClientId: account.clientId },
      delivery: { eventCount: events.length, lastEvent: events[0] || null, failureCount: failures.length, failures },
      webSockets: { groupMemberClientIds: currentRegistrations.flatMap((item) => (item.pairedClients || []).map((paired) => paired.clientId)).filter(Boolean), registrations, currentClientRegistrations: currentRegistrations }
    } }, request, startedAt, queryMs);
  }
  const { state, counts } = await loadSummary(env, account);
  const queryMs = Date.now() - queryStartedAt;
  const email = normalizeEmailConfig(state.email || {});
  const registrationCount = Number(counts.registration_count) || 0;
  const data = {
    account: { clientId: account.clientId, accountClientId: account.clientId, username: account.username, label: text(state.client.clientLabel) || `账号通知 · ${account.username}`, notifyGroupId: account.clientId },
    channels: {
      bark: { configured: Boolean(state.bark), deviceKey: state.bark },
      serverChan3: { uid: text(state.server?.uid), sendKeyMasked: maskServerChan3SendKey(state.server?.sendKey || ''), configured: Boolean(text(state.server?.uid) && text(state.server?.sendKey)) },
      email: { maskedAddress: maskEmailAddress(email.address), verified: Boolean(email.verified), verifiedAt: text(email.verifiedAt) || null, enabled: Boolean(email.enabled), configured: Boolean(email.address && email.verified && email.enabled) },
      webWs: { configured: registrationCount > 0 }
    },
    rules: { planRuleCount: Number(state.meta?.counts?.planRuleCount) || 0, dcaRuleCount: Number(state.meta?.counts?.dcaRuleCount) || 0, totalRuleCount: Number(state.meta?.counts?.totalRuleCount) || 0 },
    timestamps: { lastSyncedAt: text(state.meta?.lastSyncedAt) || null, lastCheckedAt: text(state.meta?.lastCheckedAt) || null, lastTestedAt: text(state.meta?.lastTestedAt) || null },
    delivery: { eventCount: Number(counts.event_count) || 0, failureCount: Number(counts.failure_count) || 0 },
    webSockets: { groupId: account.clientId, groupMemberCount: registrationCount, registrationCount, currentClientId: account.clientId, currentClientRegistrationCount: registrationCount, pairedRegistrationCount: registrationCount, unpairedRegistrationCount: 0 }
  };
  return timedResponse({ ok: true, schemaVersion: 1, data }, request, startedAt, queryMs);
}

export async function handleAccountEvents(request, env) {
  const startedAt = Date.now(); const account = accountOf(request); const queryStartedAt = Date.now();
  const result = await env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'event' ORDER BY updated_at DESC LIMIT 30`).bind(account.userId).all();
  const events = (result?.results || []).map((row) => parse(row.payload)?.value).filter((event) => event && typeof event === 'object');
  return timedResponse({ events }, request, startedAt, Date.now() - queryStartedAt);
}
