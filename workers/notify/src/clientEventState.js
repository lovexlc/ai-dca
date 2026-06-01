import { attachDeliveryAckToEvent } from './ack.js';
import { getClientRecord, normalizeClientId, normalizeSettings } from './clientSettings.js';

export function getClientRecentEvents(clientRecord = {}) {
  return Array.isArray(clientRecord?.state?.recentEvents) ? clientRecord.state.recentEvents : [];
}

function getClientDeliveryAcks(clientRecord = {}) {
  return (typeof clientRecord?.state?.deliveryAcks === 'object' && clientRecord.state.deliveryAcks)
    ? clientRecord.state.deliveryAcks
    : {};
}

export function attachClientDeliveryAcks(event = {}, clientRecord = {}) {
  return attachDeliveryAckToEvent(event, getClientDeliveryAcks(clientRecord));
}

function hasPcQueuedChannel(event = {}) {
  return Array.isArray(event?.channels)
    && event.channels.some((channel) => String(channel?.channel || '').trim() === 'pc'
      && String(channel?.status || '').trim() === 'queued');
}

function isSuccessfulEventChannel(channel = {}) {
  const status = String(channel?.status || '').trim();
  return status === 'delivered'
    || status === 'skipped'
    || (String(channel?.channel || '').trim() === 'pc' && status === 'queued');
}

function isPositiveEventChannel(channel = {}) {
  const status = String(channel?.status || '').trim();
  return status === 'delivered'
    || (String(channel?.channel || '').trim() === 'pc' && status === 'queued');
}

function shouldTreatEventAsDelivered(event = {}) {
  const channels = Array.isArray(event?.channels) ? event.channels : [];
  return channels.length > 0
    && channels.every(isSuccessfulEventChannel)
    && channels.some(isPositiveEventChannel);
}

export function normalizeEventForClient(event = {}) {
  if (!event || String(event?.status || '').trim() === 'delivered') return event;
  return shouldTreatEventAsDelivered(event)
    ? { ...event, status: 'delivered' }
    : event;
}

export function shouldExposeEventForClientPoll(event = {}) {
  if (!event) return false;
  if (String(event?.status || '').trim() !== 'delivered') return true;
  // PC 浏览器以 /events 轮询为投递通道；即使 overall status 已视为 delivered，
  // 仍需把包含 pc/queued channel 的事件返回给浏览器完成本地弹窗。
  return hasPcQueuedChannel(event);
}

export function getClientDeliveryFailures(clientRecord = {}) {
  return Object.values(typeof clientRecord?.state?.deliveryFailures === 'object' && clientRecord.state.deliveryFailures
    ? clientRecord.state.deliveryFailures
    : {});
}

export function buildEmptyRunSummary() {
  return {
    triggeredCount: 0,
    deliveredCount: 0,
    events: [],
    clientCount: 0,
    clients: []
  };
}

export function appendClientRunSummary(summary = buildEmptyRunSummary(), clientSummary = {}) {
  const nextEvents = [
    ...(Array.isArray(summary.events) ? summary.events : []),
    ...(Array.isArray(clientSummary.events) ? clientSummary.events : [])
  ].sort((left, right) => (
    Date.parse(String(right?.createdAt || '')) - Date.parse(String(left?.createdAt || ''))
  )).slice(0, 30);

  return {
    triggeredCount: Number(summary.triggeredCount) + (Number(clientSummary.triggeredCount) || 0),
    deliveredCount: Number(summary.deliveredCount) + (Number(clientSummary.deliveredCount) || 0),
    events: nextEvents,
    clientCount: Number(summary.clientCount) + 1,
    clients: [
      ...(Array.isArray(summary.clients) ? summary.clients : []),
      {
        clientId: String(clientSummary.clientId || '').trim(),
        clientLabel: String(clientSummary.clientLabel || '').trim(),
        triggeredCount: Number(clientSummary.triggeredCount) || 0,
        deliveredCount: Number(clientSummary.deliveredCount) || 0,
        eventCount: Array.isArray(clientSummary.events) ? clientSummary.events.length : 0
      }
    ]
  };
}

export function applySettingsRemovals(settings, clientId = '', removals = []) {
  const nextSettings = normalizeSettings(settings);

  for (const removal of removals) {
    const configType = String(removal?.configType || '').trim();
    const configKey = String(removal?.configKey || '').trim();
    const configId = String(removal?.configId || '').trim();

    if (!configType || !configKey) {
      continue;
    }

    if (configType === 'bark-client') {
      const targetClientId = normalizeClientId(configId || clientId);

      if (!targetClientId) {
        continue;
      }

      nextSettings.clients[targetClientId] = {
        ...getClientRecord(nextSettings, targetClientId),
        barkDeviceKey: ''
      };
      continue;
    }

    if (configType === 'gotify-client') {
      nextSettings.gotifyClients = nextSettings.gotifyClients.filter((client) => `gotify-client:${client.id}` !== configKey && String(client.id || '').trim() !== configId);
      continue;
    }

    if (configType === 'gotify-legacy') {
      nextSettings.gotifyBaseUrl = '';
      nextSettings.gotifyToken = '';
    }
  }

  return nextSettings;
}
