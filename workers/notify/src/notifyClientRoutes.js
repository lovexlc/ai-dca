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
        sessionId: 'notify-worker',
        userId: '',
        username: '',
        path: '/api/notify/switch/run',
        meta
      })
    });
  } catch (_error) {
    // 统计失败不影响通知 Worker 主流程。
  }
}

function requireCurrentClientId(request) {
  const currentClientId = readCurrentClientId(request);

  if (!currentClientId) {
    throw new Error('缺少浏览器 clientId。');
  }

  return currentClientId;
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
  if (record?.ownerUserId) return record.ownerUserId === auth.ownerUserId;
  return Boolean(auth.accountUsername && record?.accountUsername === auth.accountUsername);
}

function prepareUniqueChannelSettings(settings, currentClientId, auth, barkDeviceKey, serverChan3) {
  if (!auth?.ownerUserId) return settings;
  const nextSettings = {
    ...settings,
    clients: { ...(settings.clients || {}) }
  };
  const normalizedBark = String(barkDeviceKey || '').trim();
  const normalizedServerUid = String(serverChan3?.uid || '').trim().toLowerCase();

  for (const [clientId, client] of Object.entries(settings.clients || {})) {
    if (clientId === currentClientId) continue;
    const sameBark = Boolean(normalizedBark && String(client?.barkDeviceKey || '').trim() === normalizedBark);
    const sameServerChan3 = Boolean(
      normalizedServerUid
      && String(client?.serverChan3?.uid || '').trim().toLowerCase() === normalizedServerUid
    );
    if (!sameBark && !sameServerChan3) continue;

    if (!sameVerifiedOwner(client, auth)) {
      throw new NotifyClientError(
        '该通知通道已绑定其他账号，请登录原账号解绑后再试。',
        409,
        'CHANNEL_ALREADY_BOUND'
      );
    }

    // 同账号历史 clientId 的重复绑定直接清理，账号记录成为唯一配置源。
    nextSettings.clients[clientId] = {
      ...client,
      ...(sameBark ? { barkDeviceKey: '' } : {}),
      ...(sameServerChan3 ? { serverChan3: normalizeServerChan3Config({}) } : {})
    };
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

  if (auth.didUpdate) {
    await writeSettings(env, settings);
  }

  // 默认过滤后台已确认送达的事件；但 PC 浏览器通知依赖 /events 轮询，
  // 包含 pc/queued channel 的事件即使 overall status 视为 delivered，也要继续返回给浏览器本地弹窗。
  const pendingEvents = getClientRecentEvents(auth.clientRecord)
    .map((event) => attachClientDeliveryAcks(event, auth.clientRecord))
    .map(normalizeEventForClient)
    .filter(shouldExposeEventForClientPoll);

  return jsonResponse({
    events: pendingEvents
  }, { origin });
}

async function handleSync(request, env) {
  const origin = readOrigin(request);
  const rawPayload = await request.json().catch(() => ({}));
  const payload = normalizeNotifyPayload(rawPayload);
  const compiled = compileNotifyRules(payload);
  const currentClientLabel = normalizeClientName(rawPayload?.clientLabel || rawPayload?.notifyClientLabel || '');
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    clientLabel: currentClientLabel,
    accountUsername: rawPayload?.accountUsername || ''
  });
  settings = auth.settings;
  const currentClientId = auth.clientId;
  const existingClient = auth.clientRecord;
  const allowedRuleIds = new Set(compiled.allRules.map((rule) => rule.ruleId));
  allowedRuleIds.add(`${currentClientId}:market-alerts:exchange`);
  allowedRuleIds.add(`${currentClientId}:market-alerts:otc`);
  allowedRuleIds.add(`${currentClientId}:holding-alerts`);
  const nextRuleStates = Object.entries(existingClient?.state?.ruleStates || {}).reduce((map, [ruleId, state]) => {
    if (allowedRuleIds.has(ruleId)) {
      map[ruleId] = state;
    }
    return map;
  }, {});
  const nextState = {
    ...existingClient.state,
    ruleStates: nextRuleStates,
    recentEvents: getClientRecentEvents(existingClient)
  };
  const nextMeta = {
    ...existingClient.meta,
    counts: compiled.summary,
    lastSyncedAt: payload.syncedAt
  };
  const nextSettings = upsertClientRecord(settings, currentClientId, {
    clientLabel: existingClient.clientLabel || `账号通知 · ${auth.accountUsername || ''}`,
    accountUsername: auth.accountUsername || existingClient.accountUsername,
    ownerUserId: auth.ownerUserId || existingClient.ownerUserId,
    payload,
    state: nextState,
    meta: nextMeta
  });

  await writeSettings(env, nextSettings);

  const marketAlertGroups = splitMarketAlertsByVenue(payload.marketAlerts);
  await Promise.all([
    writeJson(env, `notify:market-alerts:${currentClientId}:exchange`, marketAlertGroups.exchange),
    writeJson(env, `notify:market-alerts:${currentClientId}:otc`, marketAlertGroups.otc)
  ]);

  env.__notifySettings = buildScopedNotifySettings(nextSettings, currentClientId);
  env.__notifyCurrentClientId = currentClientId;

  // PR 2b尾巴：worker 侧 VIX 跨阈值推送。
  // rawPayload.vix 是客户端在 buildNotifySyncPayload() 中上传的 digest，
  // normalizeNotifyPayload 会把其过滤掉，所以这里从 raw 里拿。
  // 仅在区间变动时推送；same-level 且 24h 内不重推。
  try {
    const vixStateKey = `vix-state:${currentClientId}`;
    await evaluateVixSignal(env, rawPayload?.vix, {
      clientId: currentClientId,
      settings: env.__notifySettings,
      readState: () => readJson(env, vixStateKey, null),
      writeState: (value) => writeJson(env, vixStateKey, value),
    });
  } catch (error) {
    // VIX 推送失败不应影响 sync 本身。
    console.error('[notify] evaluateVixSignal failed', error);
  }

  // PR 1.5尾巴：sell_layer 推送。rawPayload.sellPlans 是 client 传的快照（含 currentPrice）。
  try {
    const sellStateKey = `sell-plan-state:${currentClientId}`;
    await evaluateSellPlanSignals(env, rawPayload?.sellPlans, {
      clientId: currentClientId,
      settings: env.__notifySettings,
      readState: () => readJson(env, sellStateKey, null),
      writeState: (value) => writeJson(env, sellStateKey, value),
    });
  } catch (error) {
    console.error('[notify] evaluateSellPlanSignals failed', error);
  }

  // PR 4.5尾巴：position 推送。rawPayload.positionDigest 拼装在 client 侧。
  try {
    const posStateKey = `position-state:${currentClientId}`;
    await evaluatePositionDigest(env, rawPayload?.positionDigest, {
      clientId: currentClientId,
      settings: env.__notifySettings,
      readState: () => readJson(env, posStateKey, null),
      writeState: (value) => writeJson(env, posStateKey, value),
    });
  } catch (error) {
    console.error('[notify] evaluatePositionDigest failed', error);
  }

  return jsonResponse({
    ok: true,
    clientId: auth.deviceClientId || currentClientId,
    accountClientId: currentClientId,
    counts: compiled.summary,
    lastSyncedAt: payload.syncedAt
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
    nextServerChan3
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

export {
  handleAck,
  handleEvents,
  handleSettings,
  handleStatus,
  handleSync,
  prepareUniqueChannelSettings,
  trackAnalyticsEvent
};
