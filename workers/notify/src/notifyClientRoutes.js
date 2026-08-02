import { evaluatePositionDigest, evaluateSellPlanSignals, evaluateVixSignal } from './evaluator.js';
import { compileNotifyRules, normalizeNotifyPayload } from './rules.js';
import { recordDeliveryAck } from './ack.js';
import { jsonResponse, readOrigin } from './notifyHttp.js';
import {
  readAccountSettings,
  readJson,
  readSettings,
  writeAccountSettings,
  writeJson,
  writeSettings
} from './notifyStorage.js';
import {
  attachClientDeliveryAcks,
  getClientDeliveryFailures,
  getClientRecentEvents,
  normalizeEventForClient,
  shouldExposeEventForClientPoll
} from './clientEventState.js';
import { buildPublicGcmSetup } from './gcmPresentation.js';
import { maskServerChan3SendKey, normalizeServerChan3Config } from './channels/serverChan3.js';
import {
  buildScopedNotifySettings,
  detachNotifyClientAccount,
  ensureAuthenticatedClient,
  getClientRecord,
  normalizeClientName,
  readCurrentClientId,
  resolveNotifyAccountUsername,
  upsertClientRecord
} from './clientSettings.js';

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

function resolveAccountUsername(auth) {
  return resolveNotifyAccountUsername(auth);
}

async function deleteClientScopedKeys(env, clientId) {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId || typeof env?.NOTIFY_STATE?.delete !== 'function') return;

  const exactKeys = [
    `vix-state:${normalizedClientId}`,
    `sell-plan-state:${normalizedClientId}`,
    `position-state:${normalizedClientId}`,
    `switch:snapshot:${normalizedClientId}`,
    `switch:state:${normalizedClientId}`,
    `switch:push-digest:${normalizedClientId}`,
    `switch:run-result:${normalizedClientId}`
  ];

  await Promise.all(exactKeys.map((key) => env.NOTIFY_STATE.delete(key)));

  if (typeof env.NOTIFY_STATE.list !== 'function') return;

  for (const prefix of [
    `switch:run:${normalizedClientId}:`,
    `switch:recommendation:${normalizedClientId}:`
  ]) {
    let cursor = '';
    do {
      const page = await env.NOTIFY_STATE.list({ prefix, ...(cursor ? { cursor } : {}) });
      await Promise.all((Array.isArray(page?.keys) ? page.keys : []).map((item) => (
        env.NOTIFY_STATE.delete(String(item?.name || ''))
      )));
      cursor = page?.list_complete ? '' : String(page?.cursor || '');
    } while (cursor);
  }
}

async function handleUnbind(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    updateAccountUsername: false
  });
  settings = auth.settings;

  const nextSettings = detachNotifyClientAccount(settings, auth.clientId);
  await writeSettings(env, nextSettings, { replaceClientIds: [auth.clientId] });
  await deleteClientScopedKeys(env, auth.clientId);

  return jsonResponse({
    ok: true,
    clientId: auth.clientId,
    accountUsername: '',
    anonymousAccountUsername: resolveNotifyAccountUsername({ clientId: auth.clientId })
  }, { origin });
}

async function handleStatus(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  const currentClientId = auth.clientId;
  const clientRecord = auth.clientRecord;
  const accountUsername = resolveAccountUsername(auth);
  const accountSettings = await readAccountSettings(env, accountUsername);

  if (auth.didUpdate) {
    await writeSettings(env, settings);
  }

  const recentEvents = getClientRecentEvents(clientRecord);
  const deliveryFailures = getClientDeliveryFailures(clientRecord);
  const webWsSetup = buildPublicGcmSetup(settings, env, {
    clientId: currentClientId
  });

  return jsonResponse({
    configured: {
      bark: Boolean(accountSettings?.barkDeviceKey),
      serverChan3: Boolean(accountSettings?.serverChan3?.uid && accountSettings?.serverChan3?.sendKey),
      gotify: false,
      webWs: Boolean(webWsSetup.webWsCurrentClientRegistrationCount)
    },
    counts: {
      planRuleCount: Number(accountSettings?.meta?.counts?.planRuleCount) || 0,
      dcaRuleCount: Number(accountSettings?.meta?.counts?.dcaRuleCount) || 0,
      totalRuleCount: Number(accountSettings?.meta?.counts?.totalRuleCount) || 0
    },
    lastSyncedAt: String(accountSettings?.meta?.lastSyncedAt || ''),
    lastCheckedAt: String(accountSettings?.meta?.lastCheckedAt || ''),
    lastTestedAt: String(accountSettings?.meta?.lastTestedAt || ''),
    eventCount: recentEvents.length,
    lastEvent: recentEvents[0] ? attachClientDeliveryAcks(recentEvents[0], clientRecord) : null,
    deliveryFailureCount: deliveryFailures.length,
    deliveryFailures,
    setup: {
      barkDeviceKey: accountSettings?.barkDeviceKey || '',
      serverChan3: {
        uid: String(accountSettings?.serverChan3?.uid || ''),
        sendKeyMasked: maskServerChan3SendKey(accountSettings?.serverChan3?.sendKey || ''),
        configured: Boolean(accountSettings?.serverChan3?.uid && accountSettings?.serverChan3?.sendKey)
      },
      clientId: clientRecord.clientId,
      clientLabel: clientRecord.clientLabel,
      ...webWsSetup
    }
  }, { origin });
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
  const accountUsername = resolveAccountUsername(auth);
  const currentAccount = await readAccountSettings(env, accountUsername) || { username: accountUsername };
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
    ...(currentAccount.meta || {}),
    counts: compiled.summary,
    lastSyncedAt: payload.syncedAt
  };
  const nextSettings = upsertClientRecord(settings, currentClientId, {
    clientLabel: currentClientLabel || existingClient.clientLabel,
    state: nextState,
    meta: {
      ...existingClient.meta,
      counts: compiled.summary,
      lastSyncedAt: payload.syncedAt
    }
  });

  await writeSettings(env, nextSettings);
  const nextAccount = {
    ...currentAccount,
    username: accountUsername,
    payload,
    meta: nextMeta
  };
  await writeAccountSettings(env, accountUsername, nextAccount);

  const marketAlertGroups = splitMarketAlertsByVenue(payload.marketAlerts);
  await Promise.all([
    writeJson(env, `notify:market-alerts:${accountUsername}:exchange`, marketAlertGroups.exchange),
    writeJson(env, `notify:market-alerts:${accountUsername}:otc`, marketAlertGroups.otc)
  ]);

  env.__notifySettings = buildScopedNotifySettings(nextSettings, currentClientId, nextAccount);
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
    clientId: currentClientId,
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
  const accountUsername = resolveAccountUsername(auth);
  const currentAccount = await readAccountSettings(env, accountUsername) || { username: accountUsername };
  const nextServerChan3 = normalizeServerChan3Config(payload?.serverChan3 ?? currentAccount.serverChan3 ?? {});
  if (!nextServerChan3.sendKey && currentAccount.serverChan3?.sendKey) {
    nextServerChan3.sendKey = currentAccount.serverChan3.sendKey;
  }
  const nextSettings = upsertClientRecord(settings, currentClientId, {
    clientLabel: currentClientLabel || auth.clientRecord.clientLabel
  });
  const nextAccount = await writeAccountSettings(env, accountUsername, {
    ...currentAccount,
    username: accountUsername,
    barkDeviceKey: String(payload?.barkDeviceKey ?? currentAccount.barkDeviceKey ?? '').trim(),
    serverChan3: nextServerChan3
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    setup: {
      barkDeviceKey: nextAccount.barkDeviceKey,
      serverChan3: {
        uid: String(nextAccount.serverChan3?.uid || ''),
        sendKeyMasked: maskServerChan3SendKey(nextAccount.serverChan3?.sendKey || ''),
        configured: Boolean(nextAccount.serverChan3?.uid && nextAccount.serverChan3?.sendKey)
      },
      clientId: auth.clientId,
      clientLabel: auth.clientRecord.clientLabel,
      ...buildPublicGcmSetup(nextSettings, env, {
        clientId: currentClientId
      })
    }
  }, { origin });
}

export {
  handleAck,
  handleEvents,
  handleUnbind,
  handleSettings,
  handleStatus,
  handleSync,
  trackAnalyticsEvent
};
