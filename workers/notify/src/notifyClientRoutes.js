import { evaluatePositionDigest, evaluateSellPlanSignals, evaluateVixSignal } from './evaluator.js';
import { compileNotifyRules, normalizeNotifyPayload } from './rules.js';
import { recordDeliveryAck } from './ack.js';
import { jsonResponse, readOrigin } from './notifyHttp.js';
import { readJson, readSettings, writeJson, writeSettings } from './notifyStorage.js';
import {
  attachClientDeliveryAcks,
  getClientRecentEvents,
  normalizeEventForClient,
  shouldExposeEventForClientPoll
} from './clientEventState.js';
import { buildPublicGcmSetup } from './gcmPresentation.js';
import { maskServerChan3SendKey, normalizeServerChan3Config } from './channels/serverChan3.js';
import {
  buildScopedNotifySettings,
  ensureAuthenticatedClient,
  getClientRecord,
  normalizeClientName,
  NotifyClientError,
  readCurrentClientId,
  upsertClientRecord
} from './clientSettings.js';
import {
  handleStatusDetails,
  handleStatusSummary
} from './notifyStatusRoutes.js';

async function trackAnalyticsEvent(env, type, meta = {}) {
  try {
    const endpoint = String(env?.ANALYTICS_ENDPOINT || 'https://api.freebacktrack.tech/api/sync/analytics/track').trim();
    if (!endpoint || !type) return;
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: `worker:${type}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
        type,
        createdAt: new Date().toISOString(),
        date: new Date().toISOString().slice(0, 10),
        visitorId: String(meta.clientId || meta.reason || 'notify-worker'),
        userId: String(meta.ownerUserId || ''),
        meta
      })
    });
  } catch (_error) {
    // best effort only
  }
}

function currentClientIdFromRequest(request, payload = {}) {
  return readCurrentClientId(request) || String(payload?.clientId || '').trim();
}

function splitMarketAlertsByVenue(alerts = []) {
  return (Array.isArray(alerts) ? alerts : []).reduce((groups, alert) => {
    const kind = String(alert?.fundKind || alert?.kind || '').trim().toLowerCase();
    const venue = kind === 'otc' || kind === 'qdii' ? 'otc' : 'exchange';
    groups[venue].push(alert);
    return groups;
  }, { exchange: [], otc: [] });
}

function sameVerifiedOwner(record, auth) {
  if (!auth?.ownerUserId) return false;
  if (record?.ownerUserId === auth.ownerUserId) return true;

  // 历史通知记录可能保留旧 userId。账号用户名来自 Bearer 会话校验后的可信头，
  // 且 users.username 在账户库中唯一，所以同名记录应视为同一个认证账号并做惰性迁移。
  const currentUsername = String(auth.accountUsername || '').trim().toLowerCase();
  const recordUsername = String(record?.accountUsername || '').trim().toLowerCase();
  return Boolean(currentUsername && recordUsername === currentUsername);
}

function createChannelRebindError(channel) {
  const channelLabel = channel === 'bark' ? 'Bark' : 'Server酱³';
  const error = new NotifyClientError(
    `该 ${channelLabel} 通道已绑定其他账号，且当前输入与云端记录一致。需要先解绑原有绑定。`,
    409,
    'CHANNEL_REBIND_REQUIRED'
  );
  error.channel = channel;
  error.canRebind = true;
  return error;
}

function createChannelBindingMismatchError(channel) {
  const error = new NotifyClientError(
    '该 Server酱³ UID 已绑定其他账号，但当前 SendKey 与云端记录不一致。',
    409,
    'CHANNEL_BINDING_MISMATCH'
  );
  error.channel = channel;
  error.canRebind = false;
  return error;
}

function prepareUniqueChannelSettings(settings, currentClientId, auth, barkDeviceKey, serverChan3, options = {}) {
  if (!auth?.ownerUserId) return settings;
  const nextSettings = {
    ...settings,
    clients: { ...(settings.clients || {}) }
  };
  const normalizedBark = String(barkDeviceKey || '').trim();
  const normalizedServer = normalizeServerChan3Config(serverChan3 || {});
  const normalizedServerUid = String(normalizedServer.uid || '').trim().toLowerCase();
  const normalizedServerSendKey = String(normalizedServer.sendKey || '').trim();
  const rebindChannel = String(options?.rebindChannel || '').trim().toLowerCase();

  for (const [clientId, client] of Object.entries(settings.clients || {})) {
    if (clientId === currentClientId) continue;
    const sameBark = Boolean(normalizedBark && String(client?.barkDeviceKey || '').trim() === normalizedBark);
    const existingServer = normalizeServerChan3Config(client?.serverChan3 || {});
    const sameServerUid = Boolean(
      normalizedServerUid
      && String(existingServer.uid || '').trim().toLowerCase() === normalizedServerUid
    );
    const sameServerCredentials = Boolean(
      sameServerUid
      && normalizedServerSendKey
      && String(existingServer.sendKey || '').trim() === normalizedServerSendKey
    );
    if (!sameBark && !sameServerUid) continue;

    if (sameVerifiedOwner(client, auth)) {
      // 同账号历史 clientId 的重复绑定直接清理，账号记录成为唯一配置源。
      nextSettings.clients[clientId] = {
        ...client,
        ...(sameBark ? { barkDeviceKey: '' } : {}),
        ...(sameServerUid ? { serverChan3: normalizeServerChan3Config({}) } : {})
      };
      continue;
    }

    const updates = {};
    if (sameBark) {
      if (rebindChannel !== 'bark') throw createChannelRebindError('bark');
      updates.barkDeviceKey = '';
    }
    if (sameServerUid) {
      if (!sameServerCredentials) throw createChannelBindingMismatchError('serverchan3');
      if (rebindChannel !== 'serverchan3') throw createChannelRebindError('serverchan3');
      updates.serverChan3 = normalizeServerChan3Config({});
    }
    nextSettings.clients[clientId] = { ...client, ...updates };
  }

  return nextSettings;
}

async function handleStatus(request, env) {
  const view = new URL(request.url).searchParams.get('view');
  if (view === 'details') {
    return handleStatusDetails(request, env);
  }
  return handleStatusSummary(request, env);
}

async function handleAck(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const result = await recordDeliveryAck(env, payload, {
    requireToken: true,
    source: payload.source || 'http'
  });
  return jsonResponse(result, { origin });
}

async function handleEvents(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const record = getClientRecord(settings, auth.clientId);
  const events = getClientRecentEvents(record, 30)
    .filter((event) => shouldExposeEventForClientPoll(event, auth.deviceClientId || auth.clientId))
    .map((event) => normalizeEventForClient(event));

  return jsonResponse({
    ok: true,
    clientId: auth.deviceClientId || auth.clientId,
    accountClientId: auth.clientId,
    events
  }, { origin });
}

async function handleSync(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const currentClientLabel = normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '');
  const auth = await ensureAuthenticatedClient(request, settings, {
    clientLabel: currentClientLabel,
    accountUsername: payload?.accountUsername || '',
    payload
  });
  settings = auth.settings;
  const currentClientId = auth.clientId;
  const existingClient = auth.clientRecord;
  const notifyPayload = normalizeNotifyPayload(payload);
  const compiled = compileNotifyRules(notifyPayload);
  const splitAlerts = splitMarketAlertsByVenue(notifyPayload?.alerts || []);
  const syncedAt = String(notifyPayload?.syncedAt || new Date().toISOString());
  const nextPayload = {
    ...notifyPayload,
    syncedAt,
    alerts: notifyPayload?.alerts || [],
    exchangeAlerts: splitAlerts.exchange,
    otcAlerts: splitAlerts.otc
  };
  const nextSettings = upsertClientRecord(settings, currentClientId, {
    clientLabel: existingClient.clientLabel || `账号通知 · ${auth.accountUsername || ''}`,
    accountUsername: auth.accountUsername || existingClient.accountUsername,
    ownerUserId: auth.ownerUserId || existingClient.ownerUserId,
    accountClientId: currentClientId,
    isDeviceOnly: false,
    notifyGroupId: currentClientId,
    payload: nextPayload,
    meta: {
      ...(existingClient.meta || {}),
      counts: compiled.summary,
      lastSyncedAt: syncedAt
    }
  });
  await writeSettings(env, nextSettings);
  await trackAnalyticsEvent(env, 'notify_settings_sync', {
    clientId: currentClientId,
    ownerUserId: auth.ownerUserId,
    accountUsername: auth.accountUsername,
    alertCount: (nextPayload.alerts || []).length
  });

  try {
    await evaluatePositionDigest(nextPayload, env, {
      clientId: currentClientId,
      settings: nextSettings,
      writeSettings: async (value) => writeSettings(env, value),
      readState: (posStateKey) => readJson(env, posStateKey, {}),
      writeState: (posStateKey, value) => writeJson(env, posStateKey, value)
    });
  } catch (error) {
    console.error('[notify] evaluatePositionDigest failed', error);
  }

  return jsonResponse({
    ok: true,
    clientId: auth.deviceClientId || currentClientId,
    accountClientId: currentClientId,
    counts: compiled.summary,
    lastSyncedAt: syncedAt
  }, { origin });
}

async function handleSettings(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const currentClientLabel = normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '');
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    clientLabel: currentClientLabel,
    accountUsername: payload?.accountUsername || ''
  });
  settings = auth.settings;
  const currentClientId = auth.clientId;
  const nextBarkDeviceKey = String(payload?.barkDeviceKey ?? auth.clientRecord.barkDeviceKey ?? '').trim();
  const nextServerChan3 = normalizeServerChan3Config(payload?.serverChan3 ?? auth.clientRecord.serverChan3 ?? {});
  if (!nextServerChan3.sendKey && nextServerChan3.uid && auth.clientRecord.serverChan3?.sendKey) {
    nextServerChan3.sendKey = auth.clientRecord.serverChan3.sendKey;
  }
  settings = prepareUniqueChannelSettings(
    settings,
    currentClientId,
    auth,
    nextBarkDeviceKey,
    nextServerChan3,
    { rebindChannel: payload?.rebindChannel }
  );
  const nextSettings = upsertClientRecord(settings, currentClientId, {
    clientLabel: auth.clientRecord.clientLabel || `账号通知 · ${auth.accountUsername || ''}`,
    accountUsername: auth.accountUsername || auth.clientRecord.accountUsername,
    ownerUserId: auth.ownerUserId || auth.clientRecord.ownerUserId,
    accountClientId: currentClientId,
    isDeviceOnly: false,
    notifyGroupId: currentClientId,
    barkDeviceKey: nextBarkDeviceKey,
    serverChan3: nextServerChan3
  });
  const nextClientRecord = getClientRecord(nextSettings, currentClientId);

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    setup: {
      barkDeviceKey: nextClientRecord.barkDeviceKey,
      serverChan3: {
        uid: String(nextClientRecord.serverChan3?.uid || ''),
        sendKeyMasked: maskServerChan3SendKey(nextClientRecord.serverChan3?.sendKey || ''),
        configured: Boolean(nextClientRecord.serverChan3?.uid && nextClientRecord.serverChan3?.sendKey)
      },
      clientId: auth.deviceClientId || nextClientRecord.clientId,
      accountClientId: nextClientRecord.clientId,
      accountUsername: nextClientRecord.accountUsername,
      clientLabel: getClientRecord(nextSettings, auth.deviceClientId || currentClientId).clientLabel || nextClientRecord.clientLabel,
      ...buildPublicGcmSetup(nextSettings, env, {
        clientId: auth.deviceClientId || currentClientId
      })
    }
  }, { origin });
}

async function handleTest(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    clientLabel: payload?.clientLabel || payload?.notifyClientLabel || '',
    accountUsername: payload?.accountUsername || ''
  });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const currentClientId = auth.clientId;
  const currentClient = getClientRecord(settings, currentClientId);
  const scopedSettings = buildScopedNotifySettings(settings, currentClientId, currentClient.notifyGroupId);
  const action = String(payload?.action || '').trim().toLowerCase();

  if (action === 'sell-plan') {
    const result = await evaluateSellPlanSignals(currentClient.payload, env, {
      clientId: currentClientId,
      settings: scopedSettings,
      force: true,
      dryRun: false
    });
    return jsonResponse({ ok: true, result }, { origin });
  }

  if (action === 'vix') {
    const result = await evaluateVixSignal(currentClient.payload, env, {
      clientId: currentClientId,
      settings: scopedSettings,
      force: true,
      dryRun: false
    });
    return jsonResponse({ ok: true, result }, { origin });
  }

  return jsonResponse({ ok: false, message: 'unsupported test action' }, { status: 400, origin });
}

export {
  currentClientIdFromRequest,
  handleAck,
  handleEvents,
  handleSettings,
  handleStatus,
  handleSync,
  handleTest,
  prepareUniqueChannelSettings,
  splitMarketAlertsByVenue
};
