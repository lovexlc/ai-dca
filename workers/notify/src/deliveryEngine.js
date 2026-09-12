import { sendBarkNotification } from './channels/bark.js';
import { sendServerChan3Notification } from './channels/serverChan3.js';
import { maskEmailAddress, normalizeEmailConfig, sendVerifiedEmailNotification } from './channels/email.js';
import { hasWebWsCapability, isRegistrationPairedToScope, isWebWsRegistration, normalizeGcmRegistrations, normalizeNotifyGroupId } from './gcm.js';
import { tryPublishWs } from './wsHub.js';
import { settleNamedDeliveryJobs } from './deliverySettlement.js';

export const MAX_RECENT_EVENTS = 30;
export const MAX_CHANNEL_FAILURES = 10;
function text(value = '', max = 5000) { return String(value ?? '').trim().slice(0, max); }
function normalizeTargets(value = null) { if (!value) return null; const list = Array.isArray(value) ? value : [value]; const result = list.map((item) => text(item, 32).toLowerCase()).map((item) => item === 'ios' ? 'bark' : ['android', 'andriod', 'serverchan'].includes(item) ? 'serverchan3' : item).filter((item) => ['bark', 'serverchan3', 'email', 'pc', 'ws'].includes(item)); return result.length ? new Set(result) : null; }
function wants(targets, channel) { return !targets || targets.has(channel) || (channel === 'ws' && targets.has('pc')); }
function ownerFromSettings(settings = {}, clientId = '') { const explicit = text(settings.ownerUserId, 96); if (explicit) return explicit; const accountId = text(settings.accountClientId || settings.notifyGroupId || clientId, 120); return accountId.startsWith('account:') ? accountId.slice(8) : (clientId.startsWith('account:') ? clientId.slice(8) : ''); }

async function queueDelivery(env, notification, options, settings, clientId) {
  if (!env?.NOTIFY_JOBS?.send || env.__notifyDeliveryDirect === true || !clientId) return null;
  const ownerUserId = ownerFromSettings(settings, clientId);
  if (!ownerUserId) return null;
  const id = `notify-deliver:${text(notification.eventId, 120) || crypto.randomUUID?.() || Date.now()}`;
  await env.NOTIFY_JOBS.send({ id, type: 'notify-deliver', ownerUserId, clientId, notification, targetChannels: options.targetChannels || null, createdAt: new Date().toISOString() });
  return { status: 'delivered', results: [{ channel: 'queue', status: 'delivered', detail: '通知任务已进入发送队列', configKey: `queue:${clientId}`, configType: 'queue', configId: id, configLabel: '通知发送队列' }] };
}

export { settleNamedDeliveryJobs } from './deliverySettlement.js';

async function actualDelivery(env, notification, options, settings, clientId) {
  const targets = normalizeTargets(options.targetChannels); const label = text(settings.clientLabel, 120); const jobs = [];
  if (wants(targets, 'bark')) jobs.push({ channel: 'bark', promise: (async () => ({ ...(await sendBarkNotification({ ...notification, url: notification.url || notification.detailUrl || '', deviceKey: text(settings.barkDeviceKey, 512) })), configKey: `bark-client:${clientId}`, configType: 'bark-client', configId: clientId, configLabel: label ? `Bark · ${label}` : 'Bark' }))() });
  if (wants(targets, 'serverchan3')) { const config = settings.serverChan3 || {}; jobs.push({ channel: 'serverchan3', promise: (async () => ({ ...(await sendServerChan3Notification({ ...notification, uid: text(config.uid, 240), sendKey: text(config.sendKey, 512) })), configKey: `serverchan3-client:${clientId}`, configType: 'serverchan3-client', configId: clientId, configLabel: label ? `Server酱³ · ${label}` : 'Server酱³' }))() }); }
  if (wants(targets, 'email')) { const email = normalizeEmailConfig(settings.email || {}); jobs.push({ channel: 'email', promise: (async () => ({ ...(await sendVerifiedEmailNotification({ ...notification, email, detailUrl: notification.detailUrl || notification.url || '' }, env)), configKey: `email-client:${clientId}`, configType: 'email-client', configId: clientId, configLabel: email.address ? `Email · ${maskEmailAddress(email.address)}` : 'Email' }))() }); }
  const results = await settleNamedDeliveryJobs(jobs);
  const groupId = normalizeNotifyGroupId(settings.notifyGroupId || clientId); const registrations = normalizeGcmRegistrations(settings.gcmRegistrations).filter((registration) => isWebWsRegistration(registration) && hasWebWsCapability(registration, 'notify') && isRegistrationPairedToScope(registration, { clientId, currentGroupId: groupId }));
  if (wants(targets, 'ws') && registrations.length) {
    const selected = options.limitGcmRegistrations > 0 ? registrations.slice(0, options.limitGcmRegistrations) : registrations;
    const wsResults = await Promise.allSettled(selected.map((registration) => tryPublishWs(env, registration.deviceInstallationId || registration.id, { messageId: notification.eventId || '', eventId: notification.eventId || '', title: notification.title, body: notification.body, data: { ...notification, messageId: notification.eventId || '' }, source: 'notify' })));
    wsResults.forEach((item, index) => { const registration = selected[index]; const value = item.status === 'fulfilled' ? item.value || {} : {}; results.push({ channel: 'ws', status: value.ok && Number(value.delivered || 0) > 0 ? 'delivered' : value.queued ? 'queued' : 'failed', detail: value.ok ? `PC 浏览器送达（${Number(value.delivered || 0)}）` : value.queued ? 'PC 浏览器离线，已进入离线队列' : (item.reason?.message || value.error || '实时通道投递失败'), configKey: `web-ws-registration:${registration.id}`, configType: 'web-ws-registration', configId: registration.id, configLabel: registration.deviceName || 'PC 浏览器' }); });
  }
  if (wants(targets, 'pc') && !results.some((item) => item.channel === 'ws' && item.status === 'delivered')) results.push({ channel: 'pc', status: 'queued', detail: '已写入事件，等待 PC 浏览器拉取', configKey: `pc-client:${clientId}`, configType: 'pc-client', configId: clientId, configLabel: label ? `PC · ${label}` : 'PC 浏览器' });
  const delivered = results.some((item) => item.status === 'delivered' || item.status === 'queued');
  return { results, status: delivered ? 'delivered' : results.some((item) => item.status !== 'skipped') ? 'failed' : 'skipped' };
}

export async function deliverNotification(env, notification, options = {}) {
  const settings = env.__notifySettings && typeof env.__notifySettings === 'object' ? env.__notifySettings : {}; const clientId = text(env.__notifyCurrentClientId, 120);
  const queued = await queueDelivery(env, notification, options, settings, clientId); if (queued) return queued;
  return actualDelivery(env, notification, options, settings, clientId);
}

export function buildChannelRemovalEvent(removal, nowIso) { const label = text(removal.configLabel, 160) || '通知通道'; return { id: `channel-removal:${removal.configKey}:${Date.now()}`, ruleId: `channel:${removal.configKey}`, title: removal.configType === 'email-client' ? '邮件提醒已自动关闭' : '通知配置已自动移除', body: `${label} 连续推送失败 ${removal.failures} 次，已停止使用。`, summary: `${label} 已停用`, status: 'failed', channels: [{ channel: removal.channel, status: 'removed', detail: removal.detail || '连续失败超过阈值' }], createdAt: nowIso, reason: 'auto-remove-failed-channel' }; }
export function updateDeliveryFailures(previousFailures, results = [], nowIso) {
  const nextFailures = { ...(previousFailures || {}) }; const removals = [];
  for (const result of results) { const key = text(result?.configKey, 240); if (!key || result.status === 'skipped' || result.channel === 'queue') continue; if (result.status === 'delivered' || result.status === 'queued') { delete nextFailures[key]; continue; } const previous = nextFailures[key] || {}; const count = (Number(previous.count) || 0) + 1; const value = { configKey: key, configType: text(result.configType), configId: text(result.configId), configLabel: text(result.configLabel), channel: text(result.channel), count, lastFailureAt: nowIso, detail: text(result.detail, 500) }; if (count >= MAX_CHANNEL_FAILURES) { removals.push({ ...value, failures: count }); delete nextFailures[key]; } else nextFailures[key] = value; }
  return { nextFailures, removals };
}
