import { sendBarkNotification } from './channels/bark.js';
import { sendServerChan3Notification } from './channels/serverChan3.js';
import {
  hasWebWsCapability,
  isRegistrationPairedToScope,
  isWebWsRegistration,
  normalizeGcmRegistrations,
  normalizeNotifyGroupId
} from './gcm.js';
import { tryPublishWs } from './wsHub.js';

export const MAX_RECENT_EVENTS = 30;
export const MAX_CHANNEL_FAILURES = 10;

function parseIsoTimestamp(value = '') {
  const timestamp = Date.parse(String(value || '').trim());
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function resolveGcmRegistrationPriority(registration = {}, currentClientId = '', currentGroupId = '') {
  const pairedClients = Array.isArray(registration?.pairedClients) ? registration.pairedClients : [];
  const currentClientPair = currentGroupId
    ? pairedClients.find((client) => normalizeNotifyGroupId(client?.groupId || client?.clientId) === currentGroupId) || null
    : currentClientId
      ? pairedClients.find((client) => client.clientId === currentClientId) || null
    : null;

  return Math.max(
    parseIsoTimestamp(currentClientPair?.lastSeenAt),
    parseIsoTimestamp(currentClientPair?.pairedAt),
    parseIsoTimestamp(registration?.updatedAt),
    parseIsoTimestamp(registration?.createdAt)
  );
}

function selectGcmRegistrationsForDelivery(registrations = [], { currentClientId = '', currentGroupId = '', limit = 0 } = {}) {
  if (!(limit > 0) || registrations.length <= limit) {
    return registrations;
  }

  return [...registrations]
    .sort((left, right) => {
      const priorityDiff = resolveGcmRegistrationPriority(right, currentClientId, currentGroupId) - resolveGcmRegistrationPriority(left, currentClientId, currentGroupId);
      if (priorityDiff) {
        return priorityDiff;
      }

      return String(left?.id || '').localeCompare(String(right?.id || ''));
    })
    .slice(0, limit);
}

function normalizeDeliveryTargetChannels(channels = null) {
  if (!channels) return null;
  const list = Array.isArray(channels) ? channels : [channels];
  const normalized = list
    .map((channel) => String(channel || '').trim().toLowerCase())
    .map((channel) => {
      if (channel === 'ios') return 'bark';
      if (channel === 'android' || channel === 'andriod' || channel === 'serverchan') return 'serverchan3';
      return channel;
    })
    .filter((channel) => ['bark', 'serverchan3', 'pc', 'ws'].includes(channel));
  return normalized.length ? new Set(normalized) : null;
}

function shouldDeliverToChannel(targetChannels, channel = '') {
  return !targetChannels || targetChannels.has(String(channel || '').trim().toLowerCase());
}

export async function deliverNotification(env, notification, options = {}) {
  const settings = typeof env.__notifySettings === 'object' && env.__notifySettings ? env.__notifySettings : {};
  const results = [];
  const barkDeviceKey = String(settings.barkDeviceKey || '').trim();
  const serverChan3 = settings.serverChan3 && typeof settings.serverChan3 === 'object' ? settings.serverChan3 : {};
  const serverChan3Uid = String(serverChan3.uid || '').trim();
  const serverChan3SendKey = String(serverChan3.sendKey || '').trim();
  const currentClientId = String(env.__notifyCurrentClientId || '').trim();
  const currentGroupId = normalizeNotifyGroupId(settings.notifyGroupId || currentClientId);
  const currentClientLabel = String(settings.clientLabel || '').trim();
  const barkConfigKey = currentClientId ? `bark-client:${currentClientId}` : 'bark-client:unknown';
  const serverChan3ConfigKey = currentClientId ? `serverchan3-client:${currentClientId}` : 'serverchan3-client:unknown';
  const limitGcmRegistrations = Math.max(Number(options.limitGcmRegistrations) || 0, 0);
  const targetChannels = normalizeDeliveryTargetChannels(options.targetChannels);
  const shouldDeliverBark = shouldDeliverToChannel(targetChannels, 'bark');
  const shouldDeliverServerChan3 = shouldDeliverToChannel(targetChannels, 'serverchan3');
  const shouldDeliverPc = shouldDeliverToChannel(targetChannels, 'pc');
  const shouldDeliverWs = shouldDeliverToChannel(targetChannels, 'ws') || shouldDeliverPc;
  const gcmRegistrations = normalizeGcmRegistrations(settings.gcmRegistrations);
  const selectedWsRegistrations = gcmRegistrations.filter((registration) => (
    isWebWsRegistration(registration)
    && hasWebWsCapability(registration, 'notify')
    && (
    isRegistrationPairedToScope(registration, {
      clientId: currentClientId,
      currentGroupId: currentGroupId || currentClientId
    })
    )
  ));
  const wsRegistrationsToDeliver = selectGcmRegistrationsForDelivery(selectedWsRegistrations, {
    currentClientId,
    currentGroupId,
    limit: limitGcmRegistrations
  });

  if (shouldDeliverBark) {
    try {
      results.push({
        ...(await sendBarkNotification({
          ...notification,
          url: notification.url || notification.detailUrl || '',
          deviceKey: barkDeviceKey
        })),
        configKey: barkConfigKey,
        configType: 'bark-client',
        configId: currentClientId || 'unknown',
        configLabel: currentClientLabel ? `Bark · ${currentClientLabel}` : 'Bark'
      });
    } catch (error) {
      results.push({
        channel: 'bark',
        status: 'failed',
        detail: error instanceof Error ? error.message : 'Bark 推送失败',
        configKey: barkConfigKey,
        configType: 'bark-client',
        configId: currentClientId || 'unknown',
        configLabel: currentClientLabel ? `Bark · ${currentClientLabel}` : 'Bark'
      });
    }
  }

  if (shouldDeliverServerChan3) {
    try {
      results.push({
        ...(await sendServerChan3Notification({
          ...notification,
          uid: serverChan3Uid,
          sendKey: serverChan3SendKey
        })),
        configKey: serverChan3ConfigKey,
        configType: 'serverchan3-client',
        configId: currentClientId || 'unknown',
        configLabel: currentClientLabel ? `Server酱³ · ${currentClientLabel}` : 'Server酱³'
      });
    } catch (error) {
      results.push({
        channel: 'serverchan3',
        status: 'failed',
        detail: error instanceof Error ? error.message : 'Server酱³ 推送失败',
        configKey: serverChan3ConfigKey,
        configType: 'serverchan3-client',
        configId: currentClientId || 'unknown',
        configLabel: currentClientLabel ? `Server酱³ · ${currentClientLabel}` : 'Server酱³'
      });
    }
  }

  if (shouldDeliverWs && selectedWsRegistrations.length) {
    const messageId = notification.eventId || '';
    const baseData = {
      messageId,
      eventId: messageId,
      eventType: notification.eventType || '',
      ruleId: notification.ruleId || '',
      summary: notification.summary || '',
      symbol: notification.symbol || '',
      strategyName: notification.strategyName || '',
      triggerCondition: notification.triggerCondition || '',
      purchaseAmount: notification.purchaseAmount || '',
      body_md: notification.body_md || '',
      detailUrl: notification.detailUrl || notification.url || '',
      url: notification.url || notification.detailUrl || '',
      links: notification.links || null,
      target: notification.target || '',
      params: notification.params || null
    };

    const wsSettledList = await Promise.allSettled(
      wsRegistrationsToDeliver.map((registration) =>
        tryPublishWs(env, registration.deviceInstallationId || registration.id, {
          messageId,
          eventId: messageId,
          title: notification.title,
          body: notification.body,
          data: baseData,
          source: 'notify'
        })
      )
    );
    const wsDeliveredFlags = wsSettledList.map((settled) => {
      if (settled.status !== 'fulfilled') return false;
      const v = settled.value || {};
      return Boolean(v.ok) && Number(v.delivered || 0) > 0;
    });

    wsRegistrationsToDeliver.forEach((registration, idx) => {
      const baseMeta = {
        configKey: `web-ws-registration:${registration.id}`,
        configType: 'web-ws-registration',
        configId: registration.id,
        configLabel: registration.deviceName || 'PC 浏览器实时通道'
      };
      if (wsDeliveredFlags[idx]) {
        const wsValue = wsSettledList[idx].status === 'fulfilled' ? (wsSettledList[idx].value || {}) : {};
        results.push({
          channel: 'ws',
          status: 'delivered',
          detail: `PC 浏览器实时通道送达（连接数 ${Number(wsValue.delivered || 0)}）`,
          ...baseMeta
        });
        return;
      }
      const wsValue = wsSettledList[idx].status === 'fulfilled' ? (wsSettledList[idx].value || {}) : {};
      if (wsValue.queued) {
        results.push({
          channel: 'ws',
          status: 'queued',
          detail: `PC 浏览器当前离线，已写入离线队列（待投递 ${Number(wsValue.queueSize || 0)} 条）`,
          ...baseMeta
        });
        return;
      }
      const wsError = wsSettledList[idx].status === 'rejected' ? wsSettledList[idx].reason : null;
      results.push({
        channel: 'ws',
        status: 'failed',
        detail: wsError instanceof Error ? wsError.message : (wsValue.error || '实时通道投递失败，未能入队'),
        ...baseMeta
      });
    });
  }

  if (shouldDeliverPc && currentClientId.startsWith('web:')) {
    // 检查 web 虚拟设备是否已通过 WS 送达
    const webWsDeviceId = `web-ws:${currentClientId}`;
    const webWsResult = results.find((r) => (
      r.configType === 'web-ws-registration' && r.configId === webWsDeviceId && r.channel === 'ws' && r.status === 'delivered'
    ));

    if (webWsResult) {
      results.push({
        channel: 'ws',
        status: 'delivered',
        detail: 'PC 浏览器实时通道送达',
        configKey: `pc-client:${currentClientId}`,
        configType: 'pc-client',
        configId: currentClientId,
        configLabel: currentClientLabel ? `PC · ${currentClientLabel}` : 'PC 浏览器'
      });
    } else {
      results.push({
        channel: 'pc',
        status: 'queued',
        detail: '已写入事件，等待 PC 浏览器轮询拉取后本地弹窗',
        configKey: `pc-client:${currentClientId}`,
        configType: 'pc-client',
        configId: currentClientId,
        configLabel: currentClientLabel ? `PC · ${currentClientLabel}` : 'PC 浏览器'
      });
    }
  }

  const deliveredCount = results.filter((result) => String(result?.status || '') === 'delivered' || (String(result?.channel || '') === 'pc' && String(result?.status || '') === 'queued')).length;
  const configuredCount = results.filter((result) => result.status !== 'skipped').length;

  try {
    console.log('[notify][deliver] result', JSON.stringify({
      eventId: notification.eventId || '',
      eventType: notification.eventType || '',
      clientId: String(env.__notifyCurrentClientId || ''),
      delivered: deliveredCount,
      configured: configuredCount,
      wsRegSelected: selectedWsRegistrations.length,
      wsRegToDeliver: wsRegistrationsToDeliver.length,
      barkConfigured: !!barkDeviceKey,
      serverChan3Configured: !!(serverChan3Uid && serverChan3SendKey),
      results: results.map((r) => ({
        channel: r.channel,
        status: r.status,
        detail: r.detail,
        configLabel: r.configLabel
      }))
    }));
  } catch (_logErr) {
    // ignore
  }

  const allTerminal = results.length > 0 && results.every((result) => {
    const status = String(result?.status || '').trim();
    return status === 'delivered' || status === 'skipped' || (String(result?.channel || '').trim() === 'pc' && status === 'queued');
  });
  const anyDelivered = results.some((result) => String(result?.status || '') === 'delivered' || (String(result?.channel || '') === 'pc' && String(result?.status || '') === 'queued'));
  const overallStatus = allTerminal && anyDelivered
    ? 'delivered'
    : configuredCount > 0 ? 'failed' : 'skipped';

  return {
    results,
    status: overallStatus
  };
}

export function buildChannelRemovalEvent(removal, nowIso) {
  const channelLabel = String(removal.configLabel || '').trim() || (removal.configType === 'bark-client'
    ? 'Bark'
    : removal.configType === 'serverchan3-client'
      ? 'Server酱³'
      : removal.configType === 'gotify-client'
        ? `Gotify 账号 ${removal.configId || ''}`.trim()
        : 'Gotify 默认通道');

  return {
    id: `channel-removal:${removal.configKey}:${Date.now()}`,
    ruleId: `channel:${removal.configKey}`,
    title: '通知配置已自动移除',
    body: `${channelLabel} 连续推送失败 ${removal.failures} 次，已从通知配置中自动移除。`,
    summary: `${channelLabel} 已移除`,
    status: 'failed',
    channels: [{
      channel: removal.channel,
      status: 'removed',
      detail: removal.detail || '连续失败超过阈值，已自动移除'
    }],
    createdAt: nowIso,
    reason: 'auto-remove-failed-channel'
  };
}

export function updateDeliveryFailures(previousFailures, results = [], nowIso) {
  const nextFailures = { ...previousFailures };
  const removals = [];
  const removalMap = new Map();

  for (const result of results) {
    const configKey = String(result?.configKey || '').trim();
    if (!configKey || result?.status === 'skipped') {
      continue;
    }

    const status = String(result?.status || '').trim();
    const isPcQueued = String(result?.channel || '').trim() === 'pc' && status === 'queued';
    if (status === 'delivered' || isPcQueued) {
      delete nextFailures[configKey];
      continue;
    }

    const previous = nextFailures[configKey] || {};
    const nextCount = Math.max(Number(previous.count) || 0, 0) + 1;
    nextFailures[configKey] = {
      configKey,
      configType: String(result.configType || previous.configType || '').trim(),
      configId: String(result.configId || previous.configId || '').trim(),
      configLabel: String(result.configLabel || previous.configLabel || '').trim(),
      channel: String(result.channel || previous.channel || '').trim(),
      count: nextCount,
      lastFailureAt: nowIso,
      detail: String(result.detail || '').trim()
    };

    if (nextCount >= MAX_CHANNEL_FAILURES && !removalMap.has(configKey)) {
      const removal = {
        configKey,
        configType: nextFailures[configKey].configType,
        configId: nextFailures[configKey].configId,
        configLabel: nextFailures[configKey].configLabel,
        channel: nextFailures[configKey].channel,
        failures: nextCount,
        detail: nextFailures[configKey].detail
      };
      removalMap.set(configKey, removal);
      removals.push(removal);
      delete nextFailures[configKey];
    }
  }

  return {
    nextFailures,
    removals
  };
}
