import { normalizeGcmPairedClients, normalizeGcmRegistrations } from './gcm.js';
import { jsonResponse, readOrigin } from './notifyHttp.js';
import { ensureStateBinding, readJson, readSettings, writeJson, writeSettings } from './notifyStorage.js';
import {
  ensureAuthenticatedClient,
  getClientRecord,
  normalizeClientId
} from './clientSettings.js';
import {
  HOLDINGS_RULE_KEY_PREFIX,
  HOLDINGS_DEDUP_TTL_SECONDS,
  getExpectedLatestNavDate,
  getShanghaiDateParts,
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

function resolveRunClientDetection(options = {}) {
  if (typeof options.runClientDetection !== 'function') {
    throw new Error('runClientDetection is required');
  }
  return options.runClientDetection;
}

export async function handleHoldingsRuleGet(request, env) {
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

export async function handleHoldingsRulePost(request, env) {
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

export function resolveAdminNotifyClient(settings = {}, env = {}) {
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

export async function handleAdminAlert(request, env, options = {}) {
  const runClientDetection = resolveRunClientDetection(options);
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

export async function handleAdminHoldingsAllTest(request, env, options = {}) {
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
  const bypassDedup = payload?.bypassDedup !== false;
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
      eventIdOverride,
      runClientDetection: options.runClientDetection
    });

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

export async function listHoldingsRuleEntries(env) {
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

export async function runHoldingsNotifications(env, kind, todayShanghai, reason = 'holdings-scheduled', options = {}) {
  const runClientDetection = resolveRunClientDetection(options);
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
    const bucketKindByCode = Object.fromEntries(bucket.map((entry) => [entry.code, kind]));
    let snapshotsByCode = {};
    try {
      snapshotsByCode = await fetchHoldingsNavSnapshots(env, codes, { bucketKindByCode, todayShanghai });
    } catch (_error) {
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

export async function runHoldingsNotificationsAll(env, todayShanghai, reason = 'holdings-scheduled-all', options = {}) {
  const runClientDetection = resolveRunClientDetection(options);
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
