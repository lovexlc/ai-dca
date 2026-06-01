import { evaluatePositionDigest, evaluateSellPlanSignals, evaluateVixSignal, runNotificationCycle } from './evaluator.js';
import { buildPublicGcmRegistration, checkGcmConnection, isRegistrationPairedToScope, maskSecret, normalizeGcmPairedClients, normalizeGcmRegistrations, normalizeNotifyGroupId, readGcmServiceAccount, resolveGcmProjectId } from './gcm.js';
import { compileNotifyRules, normalizeNotifyPayload } from './rules.js';
import { handleBark, isBarkRoute } from './bark.js';
import { WsHub, tryPublishWs } from './wsHub.js';
import { recordDeliveryAck } from './ack.js';
import { emptyResponse, jsonResponse, readOrigin } from './notifyHttp.js';
import { ensureStateBinding, readJson, readSettings, writeJson, writeSettings } from './notifyStorage.js';
import {
  handleAck,
  handleEvents,
  handleSettings,
  handleStatus,
  handleSync,
  trackAnalyticsEvent
} from './notifyClientRoutes.js';
import {
  appendClientRunSummary,
  applySettingsRemovals,
  attachClientDeliveryAcks,
  buildEmptyRunSummary,
  getClientDeliveryFailures,
  getClientRecentEvents,
  normalizeEventForClient,
  shouldExposeEventForClientPoll
} from './clientEventState.js';
import {
  applyGcmCheckState,
  findGcmRegistration,
  findGcmRegistrationByPairingCode,
  removeGcmPairedClient,
  removeGcmPairedGroup,
  upsertGcmPairedClient,
  upsertGcmRegistration
} from './gcmRegistrationState.js';
import {
  buildPublicGcmSetup,
  requireAuthenticatedGcmRegistration
} from './gcmPresentation.js';
import {
  handleGcmCheck,
  handleGcmPair,
  handleGcmPairingKey,
  handleGcmRegister,
  handleGcmResetDeviceId,
  handleGcmUnpair,
  handleGcmUnpairFromDevice
} from './gcmRoutes.js';
import {
  buildPairingCode,
  buildScopedNotifySettings,
  ensureAuthenticatedClient,
  getClientRecord,
  hashText,
  normalizeClientId,
  normalizeClientName,
  normalizeDeviceInstallationId,
  normalizePairingCode,
  normalizeSettings,
  readCurrentClientId,
  resolveClientGroupId,
  upsertClientRecord
} from './clientSettings.js';

// 把 Durable Object 类型重新导出，让 Workers runtime 能在加载 wrangler 绑定时
// 通过 entry module 的导出表找到 class_name="WsHub"。
export { WsHub };
import {
  SWITCH_CONFIG_PREFIX,
  buildSwitchTriggerNotification,
  computeSwitchSnapshot,
  evaluateSwitchTriggers,
  isInTradingSession,
  isSwitchConfigRunnable,
  navCacheKey,
  normalizeSwitchConfig,
  refreshSnapshotWithLatestNav,
  switchConfigKey,
  switchSnapshotKey,
  switchStateKey,
  testGetNav513100
} from './switchStrategy.js';
import {
  fetchLatestNavMapWithCache,
  fetchSinaPrices
} from './getNav.js';
import {
  FUND_CODE_PATTERN,
  HOLDINGS_RULE_KEY_PREFIX,
  HOLDINGS_DEDUP_TTL_SECONDS,
  getExpectedLatestNavDate,
  getLatestNav,
  getShanghaiDateParts,
  getTodayShanghaiDate,
  hasConfirmedPushDelivery,
  holdingsDedupKey,
  holdingsRuleKey,
  normalizeHoldingsDigest,
  resolveHoldingKindAsync
} from './holdingsNavSupport.js';
import {
  buildHoldingsNotificationContent,
  buildHoldingsNotificationContentAll,
  computeWeightedReturn
} from './holdingsNotificationContent.js';
import {
  fetchHoldingsNavSnapshots,
  isExchangeLikeCode
} from './holdingsSnapshotFetch.js';

async function runClientDetection(env, settings, clientRecord, { reason = 'manual-run', testPayload = null } = {}) {
  const currentClientId = normalizeClientId(clientRecord?.clientId);

  if (!currentClientId) {
    return {
      settings,
      summary: buildEmptyRunSummary()
    };
  }

  env.__notifySettings = buildScopedNotifySettings(settings, currentClientId);
  env.__notifyCurrentClientId = currentClientId;
  const cycle = await runNotificationCycle(env, clientRecord.payload, clientRecord.state, {
    reason,
    testPayload
  });
  let nextSettings = settings;

  if (Array.isArray(cycle.settingsRemovals) && cycle.settingsRemovals.length) {
    nextSettings = applySettingsRemovals(nextSettings, currentClientId, cycle.settingsRemovals);
  }

  const refreshedClient = getClientRecord(nextSettings, currentClientId, clientRecord.clientLabel);
  const nowIso = new Date().toISOString();
  nextSettings = upsertClientRecord(nextSettings, currentClientId, {
    clientLabel: refreshedClient.clientLabel || clientRecord.clientLabel,
    state: cycle.state,
    meta: {
      ...refreshedClient.meta,
      counts: testPayload ? refreshedClient.meta.counts : compileNotifyRules(refreshedClient.payload).summary,
      lastCheckedAt: testPayload ? refreshedClient.meta.lastCheckedAt : nowIso,
      lastTestedAt: testPayload ? nowIso : refreshedClient.meta.lastTestedAt
    }
  });

  return {
    settings: nextSettings,
    summary: {
      ...cycle.summary,
      clientId: currentClientId,
      clientLabel: refreshedClient.clientLabel || clientRecord.clientLabel
    }
  };
}

async function handleTest(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  const currentClientId = auth.clientId;
  const clientRecord = auth.clientRecord;

  if (auth.didUpdate) {
    await writeSettings(env, settings);
  }

  const result = await runClientDetection(env, settings, clientRecord, {
    reason: 'manual-test',
    testPayload: {
      eventId: String(payload.eventId || '').trim(),
      eventType: String(payload.eventType || 'test').trim() || 'test',
      title: String(payload.title || '交易计划测试提醒'),
      body: String(payload.body || '这是一条测试通知，用来校验当前已接入的提醒通道是否可用。'),
      summary: String(payload.summary || '测试通知'),
      ruleId: String(payload.ruleId || 'test'),
      symbol: String(payload.symbol || '').trim(),
      strategyName: String(payload.strategyName || '').trim(),
      triggerCondition: String(payload.triggerCondition || '').trim(),
      purchaseAmount: String(payload.purchaseAmount || '').trim(),
      detailUrl: String(payload.detailUrl || payload.url || '').trim()
    }
  });
  settings = result.settings;
  await writeSettings(env, settings);

  return jsonResponse({
    ok: true,
    summary: result.summary
  }, { origin });
}

async function runDetection(env, reason = 'manual-run', options = {}) {
  console.log('[notify] runDetection enter', JSON.stringify({
    reason,
    clientId: options?.clientId || null
  }));
  let settings = await readSettings(env);
  const requestedClientId = normalizeClientId(options?.clientId);
  const clientRecords = requestedClientId
    ? [getClientRecord(settings, requestedClientId)]
    : Object.values(settings.clients || {}).filter((client) => normalizeClientId(client?.clientId));
  let summary = buildEmptyRunSummary();

  for (const clientRecord of clientRecords) {
    const result = await runClientDetection(env, settings, clientRecord, {
      reason
    });
    settings = result.settings;
    summary = appendClientRunSummary(summary, result.summary);
  }

  await writeSettings(env, settings);
  return summary;
}

async function handleRun(request, env) {
  const origin = readOrigin(request);
  const requestedClientId = readCurrentClientId(request);

  if (requestedClientId) {
    const settings = await readSettings(env);
    const auth = await ensureAuthenticatedClient(request, settings);

    if (auth.didUpdate) {
      await writeSettings(env, auth.settings);
    }
  }

  const summary = await runDetection(env, 'manual-run', {
    clientId: requestedClientId
  });

  return jsonResponse({
    ok: true,
    summary
  }, { origin });
}

// ---------------------------------------------------------------------------
// 持仓当日收益提醒
// 前端在「通知」tab 开启后会 POST 代码+组合权重的快照到 KV，定时任务在
// 15:30 / 20:30 / 21:30 （Asia/Shanghai）拉取净值后计算全仓当日收益率并推送。
// KV 中不存份额/金额/成本等任何用户敏感数据。
// ---------------------------------------------------------------------------

async function handleHoldingsRuleGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;

  if (auth.didUpdate) {
    await writeSettings(env, settings);
  }

  const stored = await readJson(env, holdingsRuleKey(auth.clientId), null);
  if (!stored) {
    return jsonResponse({
      enabled: false,
      digest: null,
      updatedAt: ''
    }, { origin });
  }

  return jsonResponse({
    enabled: Boolean(stored.enabled),
    digest: stored.digest || null,
    updatedAt: stored.updatedAt || ''
  }, { origin });
}

async function handleHoldingsRulePost(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: payload?.clientLabel
  });
  settings = auth.settings;

  if (auth.didUpdate) {
    await writeSettings(env, settings);
  }

  const enabled = Boolean(payload?.enabled);
  const digest = normalizeHoldingsDigest(payload?.digest);
  const updatedAt = new Date().toISOString();

  await writeJson(env, holdingsRuleKey(auth.clientId), {
    enabled,
    digest,
    updatedAt,
    clientLabel: auth.clientRecord?.clientLabel || ''
  });

  return jsonResponse({
    enabled,
    digest,
    updatedAt
  }, { origin });
}

// 管理员：手动触发「全仓总览」推送（可选跳过当日 dedup + 可选临时覆盖 totals）。
// 需要 ADMIN_TEST_TOKEN 匹配。主要用于上线后手动验证推送能走通。


function resolveAdminNotifyClient(settings = {}, env = {}) {
  const explicitClientId = normalizeClientId(env?.ADMIN_NOTIFY_CLIENT_ID || env?.ADMIN_CLIENT_ID || '');
  if (explicitClientId) {
    const explicitClient = getClientRecord(settings, explicitClientId);
    if (explicitClient?.clientId) return explicitClient;
  }
  const adminName = String(env?.ADMIN_NOTIFY_USERNAME || env?.ADMIN_USERNAME || 'lovexl').trim().toLowerCase();
  const clients = Object.values(settings.clients || {}).filter((client) => normalizeClientId(client?.clientId));
  const hasUsableChannel = (client) => Boolean(
    String(client?.barkDeviceKey || '').trim()
    || normalizeGcmRegistrations(settings.gcmRegistrations).some((registration) =>
      normalizeGcmPairedClients(registration.pairedClients).some((paired) => paired.clientId === client.clientId)
    )
  );
  const byLabel = clients.find((client) => {
    const label = String(client?.clientLabel || '').trim().toLowerCase();
    return label === adminName || label.includes(adminName);
  });
  if (byLabel) return byLabel;
  const withChannel = clients.find(hasUsableChannel);
  return withChannel || clients[0] || null;
}

async function handleAdminAlert(request, env) {
  const origin = readOrigin(request);
  const headerToken = request.headers.get('x-admin-token') || '';
  const expected = String(env?.ADMIN_TEST_TOKEN || env?.ADMIN_NOTIFY_TOKEN || '').trim();
  if (!expected || String(headerToken || '').trim() !== expected) {
    return jsonResponse({ error: 'forbidden' }, { status: 403, origin });
  }
  let settings = await readSettings(env);
  const clientRecord = resolveAdminNotifyClient(settings, env);
  if (!clientRecord?.clientId) {
    return jsonResponse({ error: 'admin notify client not found in KV settings' }, { status: 404, origin });
  }
  const targetClientId = clientRecord.clientId;
  const payload = await request.json().catch(() => ({}));
  const nowIso = new Date().toISOString();
  const result = await runClientDetection(env, settings, clientRecord, {
    reason: 'admin-alert',
    testPayload: {
      eventId: String(payload.eventId || `admin-alert-${Date.now()}`),
      eventType: String(payload.eventType || payload.type || 'admin_alert'),
      title: String(payload.title || '管理员告警'),
      body: String(payload.body || payload.summary || '系统告警，请检查。'),
      summary: String(payload.summary || payload.body || '系统告警'),
      ruleId: String(payload.ruleId || payload.type || 'admin-alert'),
      symbol: String(payload.symbol || '').trim(),
      strategyName: String(payload.strategyName || '系统监控'),
      triggerCondition: String(payload.triggerCondition || payload.reason || ''),
      purchaseAmount: String(payload.purchaseAmount || '').trim(),
      detailUrl: String(payload.detailUrl || payload.url || '').trim(),
      createdAt: String(payload.createdAt || nowIso)
    }
  });
  settings = result.settings;
  await writeSettings(env, settings);
  return jsonResponse({ ok: true, clientId: targetClientId, summary: result.summary }, { origin });
}

async function handleAdminHoldingsAllTest(request, env) {
  const origin = readOrigin(request);
  const headerToken = request.headers.get('x-admin-token') || '';
  const expected = String(env?.ADMIN_TEST_TOKEN || '').trim();
  if (!expected || headerToken !== expected) {
    return jsonResponse({ error: 'forbidden' }, { status: 403, origin });
  }
  const payload = await request.json().catch(() => ({}));
  const onlyClientId = String(payload?.clientId || '').trim();
  if (!onlyClientId) {
    return jsonResponse({ error: 'clientId required' }, { status: 400, origin });
  }
  const bypassDedup = payload?.bypassDedup !== false; // 默认 true
  const totalsOverride = payload?.totalsOverride && typeof payload.totalsOverride === 'object'
    ? payload.totalsOverride
    : null;
  const eventIdOverride = String(payload?.eventIdOverride || '').trim() || null;
  const now = new Date();
  const todayShanghai = (payload?.todayShanghai && /^\d{4}-\d{2}-\d{2}$/.test(payload.todayShanghai))
    ? payload.todayShanghai
    : getShanghaiDateParts(now).date;
  console.log('[notify][admin-test-all] ENTER', JSON.stringify({
    onlyClientId,
    bypassDedup,
    eventIdOverride,
    todayShanghai,
    totalsKeys: totalsOverride ? Object.keys(totalsOverride) : null
  }));
  let runError = null;
  let debug = null;
  try {
    await runHoldingsNotificationsAll(env, todayShanghai, 'admin-test-all', {
      onlyClientId,
      bypassDedup,
      totalsOverride,
      eventIdOverride
    });

    // debug: 复算一次门闸，定位是否会 skip(not ready / empty contributors / clientRecord missing)
    try {
      const stored = await readJson(env, holdingsRuleKey(onlyClientId), null);
      const digest = normalizeHoldingsDigest(stored?.digest);
      const exchangeBucket = digest.exchange || [];
      const otcBucket = digest.otc || [];
      const codes = [...exchangeBucket, ...otcBucket].map((entry) => entry.code);
      const bucketKindByCode = {};
      for (const e of exchangeBucket) bucketKindByCode[e.code] = 'exchange';
      for (const e of otcBucket) bucketKindByCode[e.code] = 'otc';

      let snapshotsByCode = {};
      try {
        snapshotsByCode = await fetchHoldingsNavSnapshots(env, codes, { bucketKindByCode, todayShanghai });
      } catch (_e) {
        snapshotsByCode = {};
      }

      const exchangeRes = await computeWeightedReturn(exchangeBucket, snapshotsByCode, todayShanghai, 'exchange', env);
      const otcRes = await computeWeightedReturn(otcBucket, snapshotsByCode, todayShanghai, 'otc', env);
      const exchangeReady = !exchangeBucket.length || exchangeRes.ready;
      const otcReady = !otcBucket.length || otcRes.ready;

      const perCode = [];
      for (const code of codes) {
        const bucketKind = bucketKindByCode[code] || (isExchangeLikeCode(code) ? 'exchange' : 'otc');
        const effectiveKind = await resolveHoldingKindAsync(code, bucketKind, env);
        const expected = getExpectedLatestNavDate(effectiveKind, todayShanghai);
        const snap = snapshotsByCode?.[code] || null;
        perCode.push({
          code,
          bucketKind,
          effectiveKind,
          expectedLatestNavDate: expected,
          latestNavDate: snap?.latestNavDate || '',
          ok: snap?.ok !== false,
          hasPrev: Number.isFinite(Number(snap?.previousNav))
        });
      }

      const allEligible = [
        ...(exchangeRes.contributors || []),
        ...(otcRes.contributors || [])
      ];
      const totalWeightAll = allEligible.reduce((sum, item) => sum + item.weight, 0);
      const wouldDispatch = exchangeReady && otcReady && allEligible.length > 0 && totalWeightAll > 0;
      debug = {
        hasStored: !!stored,
        enabled: stored?.enabled === true,
        exchangeCount: exchangeBucket.length,
        otcCount: otcBucket.length,
        snapshotCount: Object.keys(snapshotsByCode || {}).length,
        exchangeReady,
        otcReady,
        exchangeContribCount: exchangeRes.contributors?.length || 0,
        otcContribCount: otcRes.contributors?.length || 0,
        wouldDispatch,
        perCode
      };
    } catch (_e) {
      debug = { error: 'debug_failed' };
    }
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    console.log('[notify][admin-test-all] THREW', JSON.stringify({ message: runError }));
  }
  console.log('[notify][admin-test-all] EXIT', JSON.stringify({ runError }));
  return jsonResponse({
    ok: !runError,
    runError,
    todayShanghai,
    onlyClientId,
    bypassDedup,
    eventIdOverride,
    totalsOverride: totalsOverride ? Object.keys(totalsOverride) : null,
    debug
  }, { origin });
}

async function listHoldingsRuleEntries(env) {
  ensureStateBinding(env);
  const entries = [];
  let cursor;
  do {
    const result = await env.NOTIFY_STATE.list({ prefix: HOLDINGS_RULE_KEY_PREFIX, cursor });
    for (const item of result.keys || []) {
      const clientId = String(item.name || '').slice(HOLDINGS_RULE_KEY_PREFIX.length);
      if (!clientId) continue;
      entries.push({ clientId, key: item.name });
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  return entries;
}

async function runHoldingsNotifications(env, kind, todayShanghai, reason = 'holdings-scheduled') {
  console.log('[notify] runHoldingsNotifications enter', JSON.stringify({
    kind,
    todayShanghai,
    reason
  }));
  if (kind !== 'exchange' && kind !== 'otc') {
    console.log('[notify] runHoldingsNotifications skip: invalid kind', JSON.stringify({ kind }));
    return;
  }

  const entries = await listHoldingsRuleEntries(env);
  if (!entries.length) {
    console.log('[notify] runHoldingsNotifications skip: no entries', JSON.stringify({ kind, reason }));
    return;
  }
  console.log('[notify] runHoldingsNotifications loaded entries', JSON.stringify({
    kind,
    reason,
    count: entries.length
  }));

  let settings = await readSettings(env);
  let settingsDirty = false;

  for (const { clientId, key } of entries) {
    const stored = await readJson(env, key, null);
    if (!stored || !stored.enabled) continue;

    const dedupKey = holdingsDedupKey(clientId, kind, todayShanghai);
    const dedup = await readJson(env, dedupKey, null);
    if (dedup && dedup.status === 'sent') continue;

    const digest = normalizeHoldingsDigest(stored.digest);
    const bucket = digest[kind] || [];
    if (!bucket.length) continue;

    const codes = bucket.map((entry) => entry.code);
    const bucketKindByCode = Object.fromEntries(codes.map((c) => [c, kind]));
    let snapshotsByCode = {};
    try {
      snapshotsByCode = await fetchHoldingsNavSnapshots(env, codes, { bucketKindByCode, todayShanghai });
    } catch (_error) {
      // 拉取失败，不写 dedup，下一个 cron 会重试。
      continue;
    }

    const computed = await computeWeightedReturn(bucket, snapshotsByCode, todayShanghai, kind, env);
    if (!computed.ready) continue;

    const clientRecord = getClientRecord(settings, clientId, stored.clientLabel || '');
    if (!clientRecord) continue;

    const { title, body, summary, body_md } = buildHoldingsNotificationContent(kind, computed.returnRate, computed.contributors, todayShanghai);
    const eventId = `holdings-${kind}-${todayShanghai}`;
    try {
      const result = await runClientDetection(env, settings, clientRecord, {
        reason,
        testPayload: {
          eventId,
          eventType: 'holdings-daily-return',
          title,
          body,
          body_md,
          summary,
          ruleId: `holdings-daily-${kind}`,
          symbol: kind === 'exchange' ? '场内总仓' : '场外总仓',
          strategyName: '持仓当日收益',
          triggerCondition: `${todayShanghai} ${kind}`,
          purchaseAmount: '',
          detailUrl: ''
        }
      });
      settings = result.settings;
      settingsDirty = true;

      if (hasConfirmedPushDelivery(result)) {
        const dedupPayload = {
          sentAt: new Date().toISOString(),
          status: 'sent',
          kind,
          date: todayShanghai
        };
        await writeJson(env, dedupKey, dedupPayload);
        // KV TTL
        try {
          await env.NOTIFY_STATE.put(
            dedupKey,
            JSON.stringify(dedupPayload),
            { expirationTtl: HOLDINGS_DEDUP_TTL_SECONDS }
          );
        } catch (_error) {
          // TTL 写入失败不阻断主流程。
        }
      } else {
        console.log('[notify][holdings] skip dedup: no confirmed push delivery', JSON.stringify({
          clientId,
          kind,
          date: todayShanghai,
          channels: (result?.summary?.events?.[0]?.channels || []).map((c) => ({ channel: c.channel, status: c.status }))
        }));
      }
    } catch (_error) {
      // 推送失败不写 dedup，等下个点重试。
    }
  }

  if (settingsDirty) {
    await writeSettings(env, settings);
  }
}

// 全仓总览推送（场内 + 场外合并，20:30 / 21:30 使用）。
// ready 门闸：场内容量、场外容量都必须「每只都刷出了应达日期」，任意一只未刷 → 跳过（等 21:30 兜底）。
async function runHoldingsNotificationsAll(env, todayShanghai, reason = 'holdings-scheduled-all', options = {}) {
  const onlyClientId = String(options?.onlyClientId || '').trim() || null;
  const bypassDedup = options?.bypassDedup === true;
  const totalsOverride = options?.totalsOverride && typeof options.totalsOverride === 'object'
    ? options.totalsOverride
    : null;
  const eventIdOverride = String(options?.eventIdOverride || '').trim() || null;
  console.log('[notify] runHoldingsNotificationsAll enter', JSON.stringify({
    todayShanghai,
    reason,
    onlyClientId,
    bypassDedup,
    eventIdOverride,
    totalsOverride: totalsOverride ? Object.keys(totalsOverride) : null
  }));

  const entries = await listHoldingsRuleEntries(env);
  if (!entries.length) {
    console.log('[notify] runHoldingsNotificationsAll skip: no entries', JSON.stringify({ reason }));
    return;
  }
  console.log('[notify] runHoldingsNotificationsAll loaded entries', JSON.stringify({
    reason,
    count: entries.length
  }));

  let settings = await readSettings(env);
  let settingsDirty = false;

  for (const { clientId, key } of entries) {
    if (onlyClientId && clientId !== onlyClientId) continue;
    const stored = await readJson(env, key, null);
    if (!stored || !stored.enabled) {
      console.log('[notify][holdings-all] skip: rule disabled or missing', JSON.stringify({ clientId, hasStored: !!stored, enabled: stored?.enabled === true }));
      continue;
    }

    const dedupKey = holdingsDedupKey(clientId, 'all', todayShanghai);
    if (!bypassDedup) {
      const dedup = await readJson(env, dedupKey, null);
      if (dedup && dedup.status === 'sent') {
        console.log('[notify][holdings-all] skip: dedup hit', JSON.stringify({ clientId, dedupKey, sentAt: dedup.sentAt }));
        continue;
      }
    }

    const digest = normalizeHoldingsDigest(stored.digest);
    // 注：digest 不再包含 totals（金额字段），totalsOverride 选项保留签名但已被忽略，
    // 推送仅展示加权收益率百分比，金额请去网页查看。
    const exchangeBucket = digest.exchange || [];
    const otcBucket = digest.otc || [];
    console.log('[notify][holdings-all] digest', JSON.stringify({
      clientId,
      exchangeCount: exchangeBucket.length,
      otcCount: otcBucket.length,
      hasTotals: !!digest.totals
    }));
    if (!exchangeBucket.length && !otcBucket.length) {
      console.log('[notify][holdings-all] skip: empty digest', JSON.stringify({ clientId }));
      continue;
    }

    const codes = [...exchangeBucket, ...otcBucket].map((entry) => entry.code);
    const bucketKindByCode = {};
    for (const e of exchangeBucket) bucketKindByCode[e.code] = 'exchange';
    for (const e of otcBucket) bucketKindByCode[e.code] = 'otc';
    let snapshotsByCode = {};
    try {
      snapshotsByCode = await fetchHoldingsNavSnapshots(env, codes, { bucketKindByCode, todayShanghai });
    } catch (error) {
      // 拉取失败，不写 dedup，下个 cron 会重试。
      console.log('[notify][holdings-all] skip: nav fetch failed', JSON.stringify({
        clientId,
        message: error instanceof Error ? error.message : String(error)
      }));
      continue;
    }
    console.log('[notify][holdings-all] nav snapshots', JSON.stringify({
      clientId,
      codeCount: codes.length,
      snapshotCount: Object.keys(snapshotsByCode).length
    }));

    const exchangeRes = await computeWeightedReturn(
      exchangeBucket,
      snapshotsByCode,
      todayShanghai,
      'exchange',
      env
    );
    const otcRes = await computeWeightedReturn(
      otcBucket,
      snapshotsByCode,
      todayShanghai,
      'otc',
      env
    );
    const exchangeReady = !exchangeBucket.length || exchangeRes.ready;
    const otcReady = !otcBucket.length || otcRes.ready;
    if (!exchangeReady || !otcReady) {
      console.log('[notify] runHoldingsNotificationsAll skip: not ready', JSON.stringify({
        clientId,
        exchangeReady,
        otcReady,
        exchangeContribCount: exchangeRes.contributors?.length || 0,
        otcContribCount: otcRes.contributors?.length || 0
      }));
      continue;
    }

    // 上传时 weight 是「本只市值 / 全仓总市值」，两个 bucket 合起来 ≈ 1。
    // 这里用原始 weight 在全集上重新 normalize（实际上则 ≈ weight 本身）。
    const allEligible = [
      ...(exchangeRes.contributors || []),
      ...(otcRes.contributors || [])
    ];
    if (!allEligible.length) continue;
    const totalWeightAll = allEligible.reduce((sum, item) => sum + item.weight, 0);
    if (!(totalWeightAll > 0)) continue;
    const dailyReturnRate = allEligible.reduce(
      (sum, item) => sum + (item.weight / totalWeightAll) * item.ratio,
      0
    );
    const sortedContribs = allEligible
      .map((item) => ({
        ...item,
        contribution: (item.weight / totalWeightAll) * item.ratio
      }))
      .sort((a, b) => Math.abs(b.ratio) - Math.abs(a.ratio));

    const { title, body, summary, body_md } = buildHoldingsNotificationContentAll(
      dailyReturnRate,
      sortedContribs,
      todayShanghai
    );

    const clientRecord = getClientRecord(settings, clientId, stored.clientLabel || '');
    if (!clientRecord) {
      console.log('[notify][holdings-all] skip: clientRecord missing', JSON.stringify({ clientId }));
      continue;
    }

    const eventId = eventIdOverride || `holdings-all-${todayShanghai}`;
    console.log('[notify][holdings-all] dispatching', JSON.stringify({
      clientId,
      eventId,
      contribCount: allEligible.length,
      dailyReturnRate
    }));
    try {
      const result = await runClientDetection(env, settings, clientRecord, {
        reason,
        testPayload: {
          eventId,
          eventType: 'holdings-daily-return',
          title,
          body,
          body_md,
          summary,
          ruleId: 'holdings-daily-all',
          symbol: '持仓总览',
          strategyName: '持仓当日收益',
          triggerCondition: `${todayShanghai} all`,
          purchaseAmount: '',
          detailUrl: ''
        }
      });
      settings = result.settings;
      settingsDirty = true;
      console.log('[notify][holdings-all] dispatched OK', JSON.stringify({
        clientId,
        eventId,
        deliveredCount: result?.summary?.deliveredCount,
        channels: (result?.summary?.events?.[0]?.channels || []).map((c) => ({
          channel: c.channel,
          status: c.status,
          detail: c.detail,
          configLabel: c.configLabel
        }))
      }));

      if (hasConfirmedPushDelivery(result)) {
        const dedupPayload = {
          sentAt: new Date().toISOString(),
          status: 'sent',
          kind: 'all',
          date: todayShanghai
        };
        await writeJson(env, dedupKey, dedupPayload);
        try {
          await env.NOTIFY_STATE.put(
            dedupKey,
            JSON.stringify(dedupPayload),
            { expirationTtl: HOLDINGS_DEDUP_TTL_SECONDS }
          );
        } catch (error) {
          // TTL 写入失败不阻断主流程。
          console.log('[notify][holdings-all] dedup ttl write failed (non-fatal)', JSON.stringify({
            clientId,
            message: error instanceof Error ? error.message : String(error)
          }));
        }
      } else {
        console.log('[notify][holdings-all] skip dedup: no confirmed push delivery', JSON.stringify({
          clientId,
          date: todayShanghai,
          channels: (result?.summary?.events?.[0]?.channels || []).map((c) => ({ channel: c.channel, status: c.status }))
        }));
      }
    } catch (error) {
      // 推送失败不写 dedup，等下个点重试。
      console.log('[notify][holdings-all] dispatch THREW', JSON.stringify({
        clientId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null
      }));
    }
  }

  if (settingsDirty) {
    await writeSettings(env, settings);
  }
}

// ---------------------------------------------------------------------------
// 场内切换策略
// 前端在「交易计划中心 / 切换」tab 配置基准 + 候选 + 阈值后 POST 到 KV，
// Cron Trigger（A 股交易时段每分钟）扫描所有 client 的配置：
// 1. 拉取实时盘中价（统一走 markets/fund-metrics）
// 2. 拉取最新单位净值（统一走 markets/fund-metrics，保留 KV 缓存）
// 3. 计算 (price - nav) / nav 溢价 %
// 4. 「基准 - 候选」溢价差跨越任一阈值（1% / 8% 等）→ 推送到该 client 已配对的设备
// 去重：(基准, 候选) 对维护 (level, sign)，level 升档或方向翻转才推送一次。
// ---------------------------------------------------------------------------

async function readSwitchConfigForClient(env, clientId) {
  const stored = await readJson(env, switchConfigKey(clientId), null);
  return stored ? normalizeSwitchConfig(stored) : null;
}

async function writeSwitchConfigForClient(env, clientId, config) {
  const normalized = normalizeSwitchConfig({
    ...config,
    updatedAt: new Date().toISOString()
  });
  await writeJson(env, switchConfigKey(clientId), normalized);
  return normalized;
}

async function readSwitchSnapshotForClient(env, clientId) {
  return await readJson(env, switchSnapshotKey(clientId), null);
}

async function listSwitchClientIds(env) {
  ensureStateBinding(env);
  const ids = [];
  let cursor;
  do {
    const result = await env.NOTIFY_STATE.list({ prefix: SWITCH_CONFIG_PREFIX, cursor });
    for (const item of result.keys || []) {
      const clientId = String(item.name || '').slice(SWITCH_CONFIG_PREFIX.length);
      if (clientId) ids.push(clientId);
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  return ids;
}

async function handleSwitchConfigGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await readSwitchConfigForClient(env, auth.clientId);
  return jsonResponse({
    ok: true,
    clientId: auth.clientId,
    config: config || normalizeSwitchConfig({ enabled: false })
  }, { origin });
}

// 清理该 clientId 的切换策略 config/snapshot/state 三个 KV 键，避免旧 benchmark 污染。
async function handleSwitchConfigDelete(request, env) {
  const origin = readOrigin(request);
  return jsonResponse({
    error: '该接口已下线。'
  }, { status: 404, origin });
}

async function handleSwitchConfigPost(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '')
  });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const nextConfig = await writeSwitchConfigForClient(env, auth.clientId, {
    enabled: payload?.enabled,
    benchmarkCodes: Array.isArray(payload?.benchmarkCodes)
      ? payload.benchmarkCodes
      : (payload?.benchmarkCode ? [payload.benchmarkCode] : []),
    enabledCodes: payload?.enabledCodes ?? payload?.candidateCodes,
    premiumClass: payload?.premiumClass,
    intraSellLowerPct: payload?.intraSellLowerPct,
    intraBuyOtherPct: payload?.intraBuyOtherPct,
    clientLabel: auth.clientRecord?.clientLabel || ''
  });
  return jsonResponse({ ok: true, config: nextConfig }, { origin });
}

async function handleSwitchSnapshotGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  let snapshot = await readSwitchSnapshotForClient(env, auth.clientId);
  const config = await readSwitchConfigForClient(env, auth.clientId);

  // 自动刷新净值：当 KV 里的 snapshot 是基于陈旧 NAV 算出时，直接补充最新净值，避免完整重算。
  // 背景：runSwitchStrategyTick 受 isInTradingSession 限制，仅在交易时段触发；
  //   而统一 markets/fund-metrics 的 T 日 NAV 可能晚于收盘才可用。
  //   收盘后用户进入「基金切换」，单靠 GET 不会触发重算。
  // 实现：
  //   - 防抖 1：snapshot.computedAt 距今 < 3 分钟 → 跳过（cron 或并发 GET 刚算过）。
  //   - 检测：用 benchmarkCodes[0] 作为探针，对比最新 latestNavDate 与 snapshot 里该 code 的 navDate；
  //     若线上更新，则直接用 refreshSnapshotWithLatestNav() 补充净值（无需重算价格等）。
  //   - 失败保护：补充异常不影响返回（继续返回旧 snapshot）。
  try {
    if (snapshot && config && isSwitchConfigRunnable({ ...config, enabled: true })) {
      const benchmarkCodes = Array.isArray(config.benchmarkCodes) ? config.benchmarkCodes : [];
      const probeCode = benchmarkCodes[0]
        || (Array.isArray(config.enabledCodes) ? config.enabledCodes[0] : null);
      if (probeCode) {
        const computedAtMs = snapshot?.computedAt ? Date.parse(snapshot.computedAt) : 0;
        const tooRecent = Number.isFinite(computedAtMs) && computedAtMs > 0
          && (Date.now() - computedAtMs) < 3 * 60 * 1000;
        if (!tooRecent) {
          // 从现有 snapshot 中提取基准净值日期
          let snapshotNavDate = '';
          if (snapshot) {
            const byBenchmark = Array.isArray(snapshot.byBenchmark) ? snapshot.byBenchmark : [];
            const benchEntry = byBenchmark.find((b) => b?.benchmarkCode === probeCode);
            if (benchEntry?.benchmarkNavDate) snapshotNavDate = String(benchEntry.benchmarkNavDate);
            if (!snapshotNavDate) {
              for (const b of byBenchmark) {
                const cand = (b?.candidates || []).find((c) => c?.code === probeCode);
                if (cand?.navDate) { snapshotNavDate = String(cand.navDate); break; }
              }
            }
          }
          // 检测是否有更新的净值（使用统一的 getLatestNav 方法，支持 KV 缓存）
          const latest = await getLatestNav(env, probeCode, 'exchange');
          const latestDate = String(latest?.latestNavDate || '');
          const stale = latestDate && (!snapshotNavDate || latestDate > snapshotNavDate);
          if (stale) {
            try {
              // 直接补充最新净值，而不是完整重算
              // 将 getLatestNav 函数传递给 refreshSnapshotWithLatestNav，使其支持 KV 缓存
              const refreshedSnapshot = await refreshSnapshotWithLatestNav(snapshot, env, getLatestNav);
              if (refreshedSnapshot) {
                snapshot = refreshedSnapshot;
                console.log('[notify] switch snapshot refreshed with latest nav', JSON.stringify({
                  clientId: auth.clientId.slice(0, 18),
                  probeCode,
                  latestDate,
                  prevSnapshotNavDate: snapshotNavDate
                }));
              }
            } catch (refreshErr) {
              console.warn('[notify] switch snapshot refresh failed, returning stale data:', String(refreshErr && refreshErr.message || refreshErr));
            }
          }
        }
      }
    }
  } catch (_error) {
    // 防御：自动刷新异常不影响正常返回。
    console.warn('[notify] switch snapshot auto-refresh exception:', _error);
  }

  return jsonResponse({
    ok: true,
    snapshot,
    config: config || normalizeSwitchConfig({ enabled: false })
  }, { origin });
}

async function handleSwitchRunPost(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await readSwitchConfigForClient(env, auth.clientId);
  // 「可计算」」vs「可运行」：这里只要有有效的 bench/cand/H-L 就允许计一次快照。
  // 未启用监控时 runSwitchStrategyForOneClient 会跳过 push，只刷新 snapshot/signals，
  // 这样 UI 能统一渲染 worker 计算的信号，不需要浏览器再独立算一份。
  if (!config || !isSwitchConfigRunnable({ ...config, enabled: true })) {
    return jsonResponse({
      ok: false,
      error: '当前没有可计算的「切换」配置：请先选择基准 ETF、候选 ETF，并在 H/L 两表里各有至少一只已分类。'
    }, { status: 400, origin });
  }
  const summary = await runSwitchStrategyForOneClient(env, auth.clientId, config, { reason: 'switch-manual-run' });
  await trackAnalyticsEvent(env, 'switch_worker_run', { clientId: auth.clientId, reason: 'switch-manual-run', triggered: summary?.triggered || 0, skipped: summary?.skipped || '' });
  const snapshot = await readSwitchSnapshotForClient(env, auth.clientId);
  return jsonResponse({ ok: true, summary, snapshot }, { origin });
}

async function runSwitchStrategyForOneClient(env, clientId, config, { reason = 'switch-strategy', priceMap = null, navByCode = null, computedAt = '' } = {}) {
  let settings = await readSettings(env);
  const clientRecord = getClientRecord(settings, clientId);
  if (!clientRecord || !clientRecord.clientId) {
    return { triggered: 0, skipped: 'no-client' };
  }
  const codes = Array.from(new Set([
    ...(Array.isArray(config.benchmarkCodes) ? config.benchmarkCodes : []),
    ...(config.enabledCodes || [])
  ]));
  const effectivePriceMap = priceMap || await fetchSinaPrices(codes, env).catch(() => ({}));
  
  // 使用统一的净值获取方法（支持 KV 缓存）
  const effectiveNavMap = navByCode || await fetchLatestNavMapWithCache(env, codes, [], {
    forceRefresh: false,
    todayDate: getTodayShanghaiDate(),
    readCache: async (key, fallback) => readJson(env, key, fallback),
    writeCache: async (key, value) => writeJson(env, key, value),
    getExpectedLatestNavDate
  });
  
  const computedAtIso = computedAt || new Date().toISOString();
  const snapshot = computeSwitchSnapshot(config, effectivePriceMap, effectiveNavMap, computedAtIso);
  const prevState = (await readJson(env, switchStateKey(clientId), null)) || {};
  const { triggers, nextTriggerStates } = evaluateSwitchTriggers(snapshot, prevState.triggerStates || {});
  snapshot.triggers = triggers;
  await writeJson(env, switchSnapshotKey(clientId), snapshot);
  await writeJson(env, switchStateKey(clientId), {
    triggerStates: nextTriggerStates,
    updatedAt: snapshot.computedAt
  });
  let pushedCount = 0;
  // 未启用自动监控时：只计快照不推送，让 UI 依然能看到 signals。
  for (const trigger of triggers) {
    if (!config.enabled) break;
    const testPayload = buildSwitchTriggerNotification(snapshot, trigger, env);
    try {
      const result = await runClientDetection(env, settings, clientRecord, {
        reason,
        testPayload
      });
      settings = result.settings;
      pushedCount += 1;
    } catch (_error) {
      // 忽略单条失败：下一分钟若仍处触发态会再尝试推送
    }
  }
  if (pushedCount) {
    await writeSettings(env, settings);
  }
  return {
    triggered: triggers.length,
    pushed: pushedCount,
    candidateCount: (snapshot.byBenchmark || [])
      .reduce((acc, b) => acc + ((b.candidates || []).length), 0),
    ready: snapshot.ready
  };
}

async function handleSwitchTestNav(request, env) {
  const origin = readOrigin(request);
  try {
    const result = await testGetNav513100(env);
    return jsonResponse(result, { status: result.success ? 200 : 400, origin });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: String(error),
      timestamp: new Date().toISOString()
    }, { status: 500, origin });
  }
}

async function runSwitchStrategyTick(env, scheduledMs, reason = 'switch-cron') {
  const scheduledIso = new Date(scheduledMs).toISOString();
  console.log('[notify] runSwitchStrategyTick enter', JSON.stringify({
    reason,
    scheduledMs,
    scheduledIso
  }));
  // 双保险：crontab 用 UTC，时间窗口可能宽于实际交易时段；这里再卡一次北京时间。
  if (!isInTradingSession(new Date(scheduledMs))) {
    console.log('[notify] runSwitchStrategyTick skip: outside trading session', JSON.stringify({
      reason,
      scheduledIso
    }));
    return;
  }
  const clientIds = await listSwitchClientIds(env);
  if (!clientIds.length) {
    console.log('[notify] runSwitchStrategyTick skip: no switch clients', JSON.stringify({ reason }));
    return;
  }
  const enabledList = [];
  for (const clientId of clientIds) {
    const config = await readSwitchConfigForClient(env, clientId);
    if (config && isSwitchConfigRunnable(config)) {
      enabledList.push({ clientId, config });
    }
  }
  if (!enabledList.length) return;
  const allCodes = new Set();
  for (const { config } of enabledList) {
    for (const code of (config.benchmarkCodes || [])) allCodes.add(code);
    for (const code of (config.enabledCodes || [])) allCodes.add(code);
  }
  const codeList = Array.from(allCodes);
  const [priceMap, navByCode] = await Promise.all([
    fetchSinaPrices(codeList, env).catch(() => ({})),
    fetchLatestNavMapWithCache(env, codeList, [], {
      forceRefresh: false,
      todayDate: getTodayShanghaiDate(),
      readCache: async (key, fallback) => readJson(env, key, fallback),
      writeCache: async (key, value) => writeJson(env, key, value),
      getExpectedLatestNavDate
    })
  ]);
  const computedAt = new Date(scheduledMs).toISOString();
  for (const { clientId, config } of enabledList) {
    try {
      const summary = await runSwitchStrategyForOneClient(env, clientId, config, {
        reason,
        priceMap,
        navByCode,
        computedAt
      });
      await trackAnalyticsEvent(env, 'switch_worker_run', { clientId, reason, triggered: summary?.triggered || 0, skipped: summary?.skipped || '' });
    } catch (_error) {
      // 单个 client 失败不阻断整轮
    }
  }
}

export default {
  async fetch(request, env) {
    const origin = readOrigin(request);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return emptyResponse({ origin });
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/notify/status') {
        return await handleStatus(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/events') {
        return await handleEvents(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/ack') {
        return await handleAck(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/sync') {
        return await handleSync(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/test') {
        return await handleTest(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/settings') {
        return await handleSettings(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gotify-account') {
        return jsonResponse({ error: 'Gotify 通知能力已移除。' }, { status: 410, origin });
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/register') {
        return await handleGcmRegister(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/check') {
        return await handleGcmCheck(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/pairing-key') {
        return await handleGcmPairingKey(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/pair') {
        return await handleGcmPair(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/unpair') {
        return await handleGcmUnpair(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/unpair-from-device') {
        return await handleGcmUnpairFromDevice(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/reset-device-id') {
        return await handleGcmResetDeviceId(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/run') {
        return await handleRun(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/holdings-rule') {
        return await handleHoldingsRuleGet(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/holdings-rule') {
        return await handleHoldingsRulePost(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/admin/alert') {
        return await handleAdminAlert(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/admin/holdings-all-test') {
        return await handleAdminHoldingsAllTest(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/switch/config') {
        return await handleSwitchConfigGet(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/switch/config') {
        return await handleSwitchConfigPost(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/switch/snapshot') {
        return await handleSwitchSnapshotGet(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/switch/run') {
        return await handleSwitchRunPost(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/switch/test-nav') {
        return await handleSwitchTestNav(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/health') {
        return jsonResponse({ ok: true }, { origin });
      }

      // 实时通道 WebSocket 升级：客户端在 Sec-WebSocket-Protocol 头里用
      // "jijin-token-<fcmToken>" 携带 token。验证后转发给该设备的 WsHub Durable Object。
      if (url.pathname.startsWith('/api/notify/ws/')) {
        const tail = url.pathname.slice('/api/notify/ws/'.length);
        const slashIdx = tail.indexOf('/');
        const deviceInstallationIdRaw = slashIdx === -1 ? tail : tail.slice(0, slashIdx);
        const subpath = slashIdx === -1 ? '' : tail.slice(slashIdx + 1);
        const deviceInstallationId = normalizeDeviceInstallationId(deviceInstallationIdRaw || '');

        if (!deviceInstallationId) {
          return jsonResponse({ ok: false, message: '缺少 deviceInstallationId。' }, { status: 400, origin });
        }

        // (a) Internal admin publish。仅服务仅有3 个调试点使用，需要 ADMIN_TEST_TOKEN。
        if (request.method === 'POST' && subpath === 'publish') {
          const expected = String((env && env.ADMIN_TEST_TOKEN) || '').trim();
          const auth = String(request.headers.get('authorization') || '').trim();
          const provided = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
          if (!expected || provided !== expected) {
            return jsonResponse({ ok: false, message: 'admin token mismatch' }, { status: 401, origin });
          }
          let body = {};
          try { body = await request.json(); } catch (_) { body = {}; }
          const result = await tryPublishWs(env, deviceInstallationId, body || {});
          return jsonResponse({ ok: !!(result && result.ok), result }, { origin });
        }

        // (b) WebSocket 升级。
        if (request.method === 'GET' && subpath === '') {
          if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') {
            return jsonResponse({ ok: false, message: 'expected websocket upgrade' }, { status: 426, origin });
          }
          const protoHeader = request.headers.get('sec-websocket-protocol') || '';
          const protocols = protoHeader.split(',').map((s) => s.trim()).filter(Boolean);
          const TOKEN_PREFIX = 'jijin-token-';
          const tokenProto = protocols.find((p) => p.startsWith(TOKEN_PREFIX)) || '';
          const token = tokenProto ? tokenProto.slice(TOKEN_PREFIX.length).trim() : '';
          if (!token) {
            return jsonResponse({ ok: false, message: '缺少 token 子协议。' }, { status: 401, origin });
          }
          const settings = await readSettings(env);
          const reg = findGcmRegistration(settings, { deviceInstallationId });
          if (!reg) {
            return jsonResponse({ ok: false, message: '未找到设备注册记录。' }, { status: 404, origin });
          }
          if (String(reg.token || '').trim() !== token) {
            return jsonResponse({ ok: false, message: 'token 与注册记录不一致。' }, { status: 401, origin });
          }
          // 验证通过，转发给 WsHub Durable Object，并把设备 ID 通过内部 header
          // 带给 DO，用于上线后自动 drain 该设备的离线队列。
          const id = env.WS_HUB.idFromName(deviceInstallationId);
          const stub = env.WS_HUB.get(id);
          const forwardedHeaders = new Headers(request.headers);
          forwardedHeaders.set('x-device-installation-id', deviceInstallationId);
          return await stub.fetch('https://ws-hub/connect', new Request(request, { headers: forwardedHeaders }));
        }

        return jsonResponse({ ok: false, message: 'invalid ws route' }, { status: 404, origin });
      }

      if ((request.method === 'GET' || request.method === 'POST') && isBarkRoute(url)) {
        return await handleBark(request, env, { jsonResponse, readSettings, readOrigin });
      }

      return jsonResponse({ error: '未找到通知接口。' }, { status: 404, origin });
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }

      return jsonResponse({
        error: error instanceof Error ? error.message : '通知服务异常'
      }, {
        status: 500,
        origin
      });
    }
  },

  async scheduled(controller, env, ctx) {
    const scheduledMs = Number(controller?.scheduledTime) || Date.now();
    const cron = String(controller?.cron || '').trim();
    let shanghaiHHMM = '';
    let shanghaiDate = '';
    try {
      const parts = getShanghaiDateParts(new Date(scheduledMs));
      shanghaiDate = parts.date;
      shanghaiHHMM = parts.hhmm;
    } catch (_error) {
      // 安全兜底，不能影响入口日志本身。
    }
    console.log('[notify] scheduled tick', JSON.stringify({
      cron,
      scheduledMs,
      scheduledIso: new Date(scheduledMs).toISOString(),
      shanghaiDate,
      shanghaiHHMM
    }));
    // 「场内切换」专用分钟级 cron（仅 A 股交易时段）。接下来在函数内部还会再卡一道
    // isInTradingSession，双保险；指定这个 cron 的调度下不运行 runDetection / holdings。
    if (cron === '* 1-7 * * MON-FRI') {
      console.log('[notify] scheduled dispatch -> runSwitchStrategyTick', JSON.stringify({ cron }));
      ctx.waitUntil(runSwitchStrategyTick(env, scheduledMs, 'switch-cron'));
      return;
    }

    console.log('[notify] scheduled dispatch -> runDetection', JSON.stringify({ cron }));
    ctx.waitUntil(runDetection(env, 'scheduled'));

    try {
      const todayShanghai = shanghaiDate || getShanghaiDateParts(new Date(scheduledMs)).date;
      const hhmm = shanghaiHHMM || getShanghaiDateParts(new Date(scheduledMs)).hhmm;
      if (hhmm === '15:30') {
        console.log('[notify] scheduled dispatch -> runHoldingsNotifications', JSON.stringify({ kind: 'exchange', hhmm, todayShanghai }));
        ctx.waitUntil(runHoldingsNotifications(env, 'exchange', todayShanghai, 'holdings-scheduled-1530'));
      } else if (hhmm === '20:30') {
        console.log('[notify] scheduled dispatch -> runHoldingsNotifications', JSON.stringify({ kind: 'otc', hhmm, todayShanghai }));
        ctx.waitUntil(runHoldingsNotificationsAll(env, todayShanghai, 'holdings-scheduled-2030'));
      } else if (hhmm === '21:30') {
        console.log('[notify] scheduled dispatch -> runHoldingsNotifications', JSON.stringify({ kind: 'otc', hhmm, todayShanghai }));
        ctx.waitUntil(runHoldingsNotificationsAll(env, todayShanghai, 'holdings-scheduled-2130'));
      } else if (hhmm === '23:35') {
        // 临时测试分支：晚 23:35 手动验证全仓总览推送，bypass dedup 以允许同一天重复发送。
        // 验证完成后移除本分支 与 wrangler.toml 中的 "35 15 * * *" cron。
        // eventIdOverride 带上分钟时间戳，避免与同一天其他推送（如 admin 测试）的 eventId 撞车
        // 导致 FCM/iOS 在设备端被去重咽住。
        console.log('[notify] scheduled dispatch -> runHoldingsNotificationsAll (test 23:35)', JSON.stringify({ hhmm, todayShanghai }));
        ctx.waitUntil(runHoldingsNotificationsAll(env, todayShanghai, 'holdings-test-2335', {
          bypassDedup: true,
          eventIdOverride: `holdings-all-test-${todayShanghai}-${Date.now()}`
        }));
      } else {
        console.log('[notify] scheduled holdings dispatch skipped', JSON.stringify({ hhmm, todayShanghai }));
      }
    } catch (error) {
      console.log('[notify] scheduled dispatch error', JSON.stringify({
        cron,
        message: error instanceof Error ? error.message : String(error)
      }));
      // 调度分发异常不能拖垮原有 runDetection。
    }
  }
};
