import { jsonResponse, readOrigin } from './notifyHttp.js';
import { VERIFIED_NOTIFY_USER_ID_HEADER, VERIFIED_NOTIFY_USERNAME_HEADER } from './notifyAccountAuth.js';
import { buildAccountClientId, normalizeNotifyUserId } from './clientSettings.js';
import { deliverNotification } from './deliveryEngine.js';

const TABLE = 'notify_user_records';
function text(value = '', max = 5000) { return String(value ?? '').trim().slice(0, max); }
function parse(value, fallback = {}) { try { const data = JSON.parse(String(value || '')); return data && typeof data === 'object' ? data : fallback; } catch { return fallback; } }
function accountOf(request) { const userId = normalizeNotifyUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER)); const username = text(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER), 48).toLowerCase(); if (!userId || !username) { const error = new Error('请先登录账户。'); error.status = 401; error.code = 'AUTH_REQUIRED'; throw error; } return { userId, username, clientId: buildAccountClientId(userId) }; }
function normalizeTarget(value = '') { const target = text(value, 32).toLowerCase(); if (target === 'ios') return 'bark'; if (['android', 'andriod', 'serverchan'].includes(target)) return 'serverchan3'; return ['bark', 'serverchan3', 'email', 'pc', 'ws'].includes(target) ? target : ''; }
function notificationFrom(payload = {}) { return { eventId: text(payload.eventId, 240) || `notify-test-${Date.now()}`, eventType: text(payload.eventType, 80) || 'test', title: text(payload.title, 240) || '交易计划测试提醒', body: text(payload.body, 12000) || '这是一条测试通知，用来校验当前已接入的提醒通道是否可用。', body_md: text(payload.body_md || payload.bodyMd, 30000), summary: text(payload.summary, 1000) || '测试通知', ruleId: text(payload.ruleId, 240) || 'test', symbol: text(payload.symbol, 80), strategyName: text(payload.strategyName, 160), triggerCondition: text(payload.triggerCondition, 500), purchaseAmount: text(payload.purchaseAmount, 80), detailUrl: text(payload.detailUrl || payload.url, 1000), url: text(payload.url || payload.detailUrl, 1000), links: payload.links && typeof payload.links === 'object' ? payload.links : null, target: text(payload.target, 120), params: payload.params && typeof payload.params === 'object' ? payload.params : null };
async function loadAccountDeliverySettings(env, account) {
  const [channelRows, registrationRows, clientRow] = await Promise.all([
    env.SYNC_DB.prepare(`SELECT record_id, payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'client-channel' AND record_id IN (?, ?, ?)`).bind(account.userId, `${account.clientId}::bark`, `${account.clientId}::serverchan3`, `${account.clientId}::email`).all(),
    env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'registration' ORDER BY updated_at DESC LIMIT 64`).bind(account.userId).all(),
    env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'client' AND record_id = ?`).bind(account.userId, account.clientId).first()
  ]);
  const settings = { barkDeviceKey: '', serverChan3: {}, email: {}, gcmRegistrations: (registrationRows?.results || []).map((row) => parse(row.payload)).filter(Boolean), notifyGroupId: account.clientId, clientLabel: parse(clientRow?.payload)?.clientLabel || `账号通知 · ${account.username}` };
  for (const row of channelRows?.results || []) { const value = parse(row.payload); if (String(row.record_id).endsWith('::bark')) settings.barkDeviceKey = text(value.barkDeviceKey, 512); else if (String(row.record_id).endsWith('::serverchan3')) settings.serverChan3 = value.serverChan3 || {}; else if (String(row.record_id).endsWith('::email')) settings.email = value.email || {}; }
  return settings;
}
async function saveEvent(env, account, event) { const now = new Date().toISOString(); await env.SYNC_DB.prepare(`INSERT INTO ${TABLE} (owner_user_id, record_type, record_id, payload, revision, created_at, updated_at) VALUES (?, 'event', ?, ?, 1, ?, ?) ON CONFLICT(owner_user_id, record_type, record_id) DO UPDATE SET payload=excluded.payload, revision=${TABLE}.revision+1, updated_at=excluded.updated_at`).bind(account.userId, `${account.clientId}::${event.id}`, JSON.stringify({ clientId: account.clientId, createdAt: event.createdAt, value: event }), now, now).run(); }

export async function deliverAccountNotification(env, account, notification, targetChannels = null) {
  const settings = await loadAccountDeliverySettings(env, account);
  env.__notifySettings = settings; env.__notifyCurrentClientId = account.clientId;
  const delivery = await deliverNotification(env, notification, { targetChannels });
  const createdAt = new Date().toISOString(); const event = { id: notification.eventId, eventId: notification.eventId, messageId: notification.eventId, ruleId: notification.ruleId, eventType: notification.eventType, title: notification.title, body: notification.body, summary: notification.summary, status: delivery.status, channels: delivery.results, createdAt, reason: 'manual-test' };
  await saveEvent(env, account, event);
  return { deliveredCount: delivery.results.filter((item) => item.status === 'delivered' || (item.channel === 'pc' && item.status === 'queued')).length, events: [event], clientId: account.clientId, clientLabel: settings.clientLabel };
}

export async function handleDirectAccountTest(request, env) {
  const startedAt = Date.now(); const account = accountOf(request); const payload = await request.json().catch(() => ({})); const notification = notificationFrom(payload); const target = normalizeTarget(payload.targetChannel || payload.channel || payload.platform);
  const summary = await deliverAccountNotification(env, account, notification, target ? [target] : null);
  const response = jsonResponse({ ok: true, summary }, { origin: readOrigin(request) }); const headers = new Headers(response.headers); headers.set('server-timing', `total;dur=${Date.now() - startedAt}`); return new Response(response.body, { status: response.status, headers });
}
