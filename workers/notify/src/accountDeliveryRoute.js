import { jsonResponse, readOrigin } from './notifyHttp.js';
import { VERIFIED_NOTIFY_USER_ID_HEADER, VERIFIED_NOTIFY_USERNAME_HEADER } from './notifyAccountAuth.js';
import { buildAccountClientId, normalizeNotifyUserId } from './clientSettings.js';
import { deliverNotification } from './deliveryEngine.js';
import { finishDeliveryAttempt, markTriggerOutboxDelivered, reserveDeliveryAttempt } from './notifyReliabilityStorage.js';

const TABLE = 'notify_user_records';
function text(value = '', max = 5000) { return String(value ?? '').trim().slice(0, max); }
function parse(value, fallback = {}) { try { const data = JSON.parse(String(value || '')); return data && typeof data === 'object' ? data : fallback; } catch { return fallback; } }
function accountOf(request) { const userId = normalizeNotifyUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER)); const username = text(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER), 48).toLowerCase(); if (!userId || !username) { const error = new Error('请先登录账户。'); error.status = 401; error.code = 'AUTH_REQUIRED'; throw error; } return { userId, username, clientId: buildAccountClientId(userId) }; }
function normalizeTarget(value = '') { const target = text(value, 32).toLowerCase(); if (target === 'ios') return 'bark'; if (['android', 'andriod', 'serverchan'].includes(target)) return 'serverchan3'; if (target === 'ws') return 'pc'; return ['bark', 'serverchan3', 'email', 'pc'].includes(target) ? target : ''; }
function notificationFrom(payload = {}) { return { eventId: text(payload.eventId, 240) || `notify-test-${Date.now()}`, eventType: text(payload.eventType, 80) || 'test', title: text(payload.title, 240) || '交易计划测试提醒', body: text(payload.body, 12000) || '这是一条测试通知，用来校验当前已接入的提醒通道是否可用。', body_md: text(payload.body_md || payload.bodyMd, 30000), summary: text(payload.summary, 1000) || '测试通知', ruleId: text(payload.ruleId, 240) || 'test', symbol: text(payload.symbol, 80), strategyName: text(payload.strategyName, 160), triggerCondition: text(payload.triggerCondition, 500), purchaseAmount: text(payload.purchaseAmount, 80), detailUrl: text(payload.detailUrl || payload.url, 1000), url: text(payload.url || payload.detailUrl, 1000), links: payload.links && typeof payload.links === 'object' ? payload.links : null, target: text(payload.target, 120), params: payload.params && typeof payload.params === 'object' ? payload.params : null };
async function loadAccountDeliverySettings(env, account) {
  const [channelRows, registrationRows, clientRow] = await Promise.all([
    env.SYNC_DB.prepare(`SELECT record_id, payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'client-channel' AND record_id IN (?, ?, ?)`).bind(account.userId, `${account.clientId}::bark`, `${account.clientId}::serverchan3`, `${account.clientId}::email`).all(),
    env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'registration' ORDER BY updated_at DESC LIMIT 64`).bind(account.userId).all(),
    env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'client' AND record_id = ?`).bind(account.userId, account.clientId).first()
  ]);
  const profile = parse(clientRow?.payload);
  const settings = { barkDeviceKey: '', serverChan3: {}, email: {}, gcmRegistrations: (registrationRows?.results || []).map((row) => parse(row.payload)).filter(Boolean), ownerUserId: account.userId, accountClientId: account.clientId, notifyGroupId: account.clientId, clientLabel: profile.clientLabel || `账号通知 · ${account.username || account.userId}` };
  for (const row of channelRows?.results || []) { const value = parse(row.payload); if (String(row.record_id).endsWith('::bark')) settings.barkDeviceKey = text(value.barkDeviceKey, 512); else if (String(row.record_id).endsWith('::serverchan3')) settings.serverChan3 = value.serverChan3 || {}; else if (String(row.record_id).endsWith('::email')) settings.email = value.email || {}; }
  return settings;
}
async function saveEvent(env, account, event) { const now = new Date().toISOString(); await env.SYNC_DB.prepare(`INSERT INTO ${TABLE} (owner_user_id, record_type, record_id, payload, revision, created_at, updated_at) VALUES (?, 'event', ?, ?, 1, ?, ?) ON CONFLICT(owner_user_id, record_type, record_id) DO UPDATE SET payload=excluded.payload, revision=${TABLE}.revision+1, updated_at=excluded.updated_at`).bind(account.userId, `${account.clientId}::${event.id}`, JSON.stringify({ clientId: account.clientId, createdAt: event.createdAt, value: event }), now, now).run(); }
function channelsOf(targetChannels) { const input = targetChannels ? (Array.isArray(targetChannels) ? targetChannels : [targetChannels]) : ['bark', 'serverchan3', 'email', 'pc']; return Array.from(new Set(input.map(normalizeTarget).filter(Boolean))); }
async function deliverOneChannel(env, account, notification, channel) {
  const reservation = await reserveDeliveryAttempt(env, account.userId, notification.eventId, channel);
  if (!reservation.reserved) return reservation.result || { channel, status: 'skipped', detail: '幂等命中，未重复发送' };
  let result;
  try {
    const delivery = await deliverNotification(env, notification, { targetChannels: [channel] });
    const rows = Array.isArray(delivery?.results) ? delivery.results : [];
    result = rows.length === 1 ? rows[0] : { channel, status: delivery?.status || 'failed', detail: rows.map((item) => `${item.channel}:${item.status}`).join(', ') || '通知渠道无返回', results: rows };
  } catch (error) { result = { channel, status: 'failed', detail: error instanceof Error ? error.message : String(error) }; }
  await finishDeliveryAttempt(env, account.userId, notification.eventId, channel, result);
  return result;
}
export async function deliverAccountNotification(env, account, notification, targetChannels = null, reason = 'worker-delivery') {
  const settings = await loadAccountDeliverySettings(env, account);
  const previousDirect = env.__notifyDeliveryDirect; const previousSettings = env.__notifySettings; const previousClientId = env.__notifyCurrentClientId;
  env.__notifySettings = settings; env.__notifyCurrentClientId = account.clientId; env.__notifyDeliveryDirect = true;
  let results;
  try { results = await Promise.all(channelsOf(targetChannels).map((channel) => deliverOneChannel(env, account, notification, channel))); }
  finally { env.__notifyDeliveryDirect = previousDirect; env.__notifySettings = previousSettings; env.__notifyCurrentClientId = previousClientId; }
  const delivered = results.some((item) => item.status === 'delivered' || item.status === 'queued');
  const status = delivered ? 'delivered' : results.some((item) => item.status === 'failed') ? 'failed' : 'skipped';
  const createdAt = new Date().toISOString(); const event = { id: notification.eventId, eventId: notification.eventId, messageId: notification.eventId, ruleId: notification.ruleId, eventType: notification.eventType, title: notification.title, body: notification.body, body_md: notification.body_md || '', summary: notification.summary, symbol: notification.symbol || '', strategyName: notification.strategyName || '', triggerCondition: notification.triggerCondition || '', detailUrl: notification.detailUrl || notification.url || '', status, channels: results, createdAt, reason };
  await saveEvent(env, account, event);
  return { deliveredCount: results.filter((item) => item.status === 'delivered' || item.status === 'queued').length, events: [event], clientId: account.clientId, clientLabel: settings.clientLabel };
}
export async function deliverQueuedAccountNotification(env, job = {}) {
  const userId = normalizeNotifyUserId(job.ownerUserId); const clientId = text(job.clientId, 120) || buildAccountClientId(userId);
  if (!userId || !clientId || !job.notification) throw new Error('通知发送任务缺少账号或消息。');
  const result = await deliverAccountNotification(env, { userId, username: '', clientId }, job.notification, job.targetChannels || null, 'worker-delivery');
  await markTriggerOutboxDelivered(env, job.outboxId);
  return result;
}
export async function handleDirectAccountTest(request, env) {
  const startedAt = Date.now(); const account = accountOf(request); const payload = await request.json().catch(() => ({})); const notification = notificationFrom(payload); const target = normalizeTarget(payload.targetChannel || payload.channel || payload.platform);
  const summary = await deliverAccountNotification(env, account, notification, target ? [target] : null, 'manual-test');
  const response = jsonResponse({ ok: true, summary }, { origin: readOrigin(request) }); const headers = new Headers(response.headers); headers.set('server-timing', `total;dur=${Date.now() - startedAt}`); return new Response(response.body, { status: response.status, headers });
}
