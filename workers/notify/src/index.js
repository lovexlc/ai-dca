import { evaluatePositionDigest, evaluateSellPlanSignals, evaluateVixSignal, runNotificationCycle } from './evaluator.js';
import { readSettings, writeSettings } from './notifyStorage.js';
import { compileNotifyRules, normalizeNotifyPayload } from './rules.js';
import { handleBark, isBarkRoute } from './bark.js';
import { WsHub, tryPublishWs } from './wsHub.js';
import { runMarketDataPush } from './marketDataPush.js';
import { emptyResponse, jsonResponse, readOrigin } from './notifyHttp.js';
import {
  handleAck,
  handleEvents,
  handleSettings,
  handleStatus,
  handleSync
} from './notifyClientRoutes.js';
import {
  appendClientRunSummary,
  applySettingsRemovals,
  buildEmptyRunSummary
} from './clientEventState.js';
import {
  findGcmRegistration
} from './gcmRegistrationState.js';
import {
  buildScopedNotifySettings,
  ensureAuthenticatedClient,
  getClientRecord,
  hashText,
  NotifyClientError,
  normalizeClientId,
  normalizeClientName,
  normalizeClientSecret,
  normalizeDeviceInstallationId,
  randomString,
  readCurrentClientId,
  upsertClientRecord
} from './clientSettings.js';
import { isWebWsRegistration, normalizeGcmRegistrations } from './gcm.js';
import {
  handleSwitchConfigGet,
  handleSwitchConfigPost,
  handleSwitchRunPost,
  handleSwitchSnapshotGet,
  handleSwitchTestNav,
  runSwitchStrategyTick
} from './switchStrategyRoutes.js';
import {
  handleAdminAlert,
  handleAdminHoldingsAllTest,
  handleHoldingsRuleGet,
  handleHoldingsRulePost,
  runHoldingsNotifications,
  runHoldingsNotificationsAll
} from './holdingsNotificationRoutes.js';
import { normalizeServerChan3Config } from './channels/serverChan3.js';

// 把 Durable Object 类型重新导出，让 Workers runtime 能在加载 wrangler 绑定时
// 通过 entry module 的导出表找到 class_name="WsHub"。
export { WsHub };

function safeDecodePathSegment(value = '') {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (_) {
    return String(value || '');
  }
}

function normalizeTestTargetChannel(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ios' || normalized === 'bark') return 'bark';
  if (normalized === 'android' || normalized === 'andriod' || normalized === 'serverchan' || normalized === 'serverchan3') return 'serverchan3';
  if (normalized === 'pc' || normalized === 'ws') return normalized;
  return '';
}

const MAX_STORED_WEB_WS_REGISTRATIONS = 64;

function webWsRegistrationTime(registration = {}) {
  return Date.parse(String(registration?.updatedAt || registration?.createdAt || '')) || 0;
}

function pruneWebWsRegistrations(registrations = [], keepDeviceInstallationId = '') {
  const normalizedKeepId = normalizeDeviceInstallationId(keepDeviceInstallationId);
  const normalized = normalizeGcmRegistrations(registrations);
  const webWs = normalized.filter((registration) => isWebWsRegistration(registration));
  const nonWebWs = normalized.filter((registration) => !isWebWsRegistration(registration));
  const sortedWebWs = [...webWs].sort((a, b) => webWsRegistrationTime(b) - webWsRegistrationTime(a));
  const kept = new Map();

  for (const registration of sortedWebWs) {
    const id = normalizeDeviceInstallationId(registration.deviceInstallationId || registration.id);
    if (normalizedKeepId && id === normalizedKeepId) {
      kept.set(id, registration);
      break;
    }
  }

  for (const registration of sortedWebWs) {
    if (kept.size >= MAX_STORED_WEB_WS_REGISTRATIONS) break;
    const id = normalizeDeviceInstallationId(registration.deviceInstallationId || registration.id);
    if (!id || kept.has(id)) continue;
    kept.set(id, registration);
  }

  return [...nonWebWs, ...kept.values()];
}

async function runClientDetection(env, settings, clientRecord, { reason = 'manual-run', testPayload = null, targetChannels = null } = {}) {
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
    testPayload,
    targetChannels
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
  const auth = await ensureAuthenticatedClient(request, settings, {
    clientLabel: payload?.clientLabel || payload?.notifyClientLabel || '',
    payload
  });
  settings = auth.settings;
  const currentClientId = auth.clientId;
  let clientRecord = auth.clientRecord;
  let testServerChan3 = normalizeServerChan3Config(payload?.serverChan3 || {});
  const testBarkDeviceKey = String(payload?.barkDeviceKey || '').trim();
  const targetChannel = normalizeTestTargetChannel(payload?.targetChannel || payload?.channel || payload?.platform);

  if (testServerChan3.uid && !testServerChan3.sendKey && clientRecord.serverChan3?.sendKey) {
    testServerChan3 = {
      ...testServerChan3,
      sendKey: clientRecord.serverChan3.sendKey
    };
  }

  if (testBarkDeviceKey || (testServerChan3.uid && testServerChan3.sendKey)) {
    settings = upsertClientRecord(settings, currentClientId, {
      clientLabel: String(payload?.clientLabel || clientRecord.clientLabel || '').trim(),
      ...(testBarkDeviceKey ? { barkDeviceKey: testBarkDeviceKey } : {}),
      ...(testServerChan3.uid && testServerChan3.sendKey ? { serverChan3: testServerChan3 } : {})
    });
    clientRecord = getClientRecord(settings, currentClientId, payload?.clientLabel || clientRecord.clientLabel);
  }

  if (auth.didUpdate || testBarkDeviceKey || (testServerChan3.uid && testServerChan3.sendKey)) {
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
    },
    targetChannels: targetChannel ? [targetChannel] : null
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

      if (request.method === 'POST' && url.pathname.startsWith('/api/notify/gcm/')) {
        return jsonResponse({ error: '旧版 Android GCM/FCM 推送已下线。' }, { status: 410, origin });
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
        return await handleAdminAlert(request, env, { runClientDetection });
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/admin/holdings-all-test') {
        return await handleAdminHoldingsAllTest(request, env, { runClientDetection });
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
        return await handleSwitchRunPost(request, env, { runClientDetection });
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/switch/test-nav') {
        return await handleSwitchTestNav(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/health') {
        return jsonResponse({ ok: true }, { origin });
      }

      // ── Web 客户端 WebSocket 注册 ──────────────────────────────
      // PC 浏览器通过此端点获取 deviceInstallationId + token，然后接入 WsHub。
      if (request.method === 'POST' && url.pathname === '/api/notify/ws/register') {
        const payload = await request.json().catch(() => ({}));
        const clientId = normalizeClientId(payload?.clientId);
        const clientSecret = normalizeClientSecret(payload?.clientSecret);

        if (!clientId || !clientSecret) {
          return jsonResponse({ ok: false, message: '缺少 clientId 或 clientSecret。' }, { status: 400, origin });
        }

        let settings = await readSettings(env);
        let existingClient = settings.clients?.[clientId] || null;
        const clientSecretHash = await hashText(clientSecret);
        if (String(existingClient?.clientSecretHash || '').trim() && existingClient.clientSecretHash !== clientSecretHash) {
          return jsonResponse({ ok: false, message: 'clientSecret 验证失败。' }, { status: 401, origin });
        }

        const requestedClientLabel = normalizeClientName(payload?.clientLabel || payload?.label || payload?.clientName || '');
        const shouldBootstrapClient = !existingClient || !String(existingClient.clientSecretHash || '').trim();
        const shouldUpdateClientLabel = requestedClientLabel && requestedClientLabel !== String(existingClient?.clientLabel || '').trim();
        if (shouldBootstrapClient || shouldUpdateClientLabel) {
          settings = upsertClientRecord(settings, clientId, {
            ...(requestedClientLabel ? { clientLabel: requestedClientLabel } : {}),
            clientSecretHash
          });
          existingClient = settings.clients?.[clientId] || getClientRecord(settings, clientId);
        }

        // 生成虚拟设备 ID 和 token
        const deviceInstallationId = `web-ws:${clientId}`;
        const wsToken = randomString(64);

        // 历史存储字段仍叫 gcmRegistrations；现在只保留 PC WebSocket 虚拟设备。
        const registrations = normalizeGcmRegistrations(settings.gcmRegistrations);
        const existingIdx = registrations.findIndex((r) => r.deviceInstallationId === deviceInstallationId);

        const webDevice = {
          id: deviceInstallationId,
          deviceInstallationId,
          deviceName: `Web · ${existingClient.clientLabel || clientId}`,
          packageName: '',
          token: wsToken,
          isWebClient: true,
          pairedClients: [{
            clientId,
            groupId: existingClient.notifyGroupId || clientId,
            clientName: existingClient.clientLabel || '',
            pairedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString()
          }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        if (existingIdx >= 0) {
          registrations[existingIdx] = { ...registrations[existingIdx], ...webDevice };
        } else {
          registrations.push(webDevice);
        }

        settings.gcmRegistrations = pruneWebWsRegistrations(registrations, deviceInstallationId);
        await writeSettings(env, settings);

        return jsonResponse({ ok: true, deviceInstallationId, token: wsToken }, { origin });
      }

      // ── Web 客户端 WebSocket 注销 ──────────────────────────────
      if (request.method === 'POST' && url.pathname === '/api/notify/ws/unregister') {
        const payload = await request.json().catch(() => ({}));
        const clientId = normalizeClientId(payload?.clientId);
        const clientSecret = normalizeClientSecret(payload?.clientSecret);

        if (!clientId || !clientSecret) {
          return jsonResponse({ ok: false, message: '缺少 clientId 或 clientSecret。' }, { status: 400, origin });
        }

        let settings = await readSettings(env);
        const existingClient = settings.clients?.[clientId];

        if (!existingClient) {
          return jsonResponse({ ok: false, message: '客户端未注册。' }, { status: 404, origin });
        }

        const clientSecretHash = await hashText(clientSecret);
        if (existingClient.clientSecretHash && existingClient.clientSecretHash !== clientSecretHash) {
          return jsonResponse({ ok: false, message: 'clientSecret 验证失败。' }, { status: 401, origin });
        }

        const deviceInstallationId = `web-ws:${clientId}`;
        const registrations = normalizeGcmRegistrations(settings.gcmRegistrations);
        settings.gcmRegistrations = registrations.filter((r) => r.deviceInstallationId !== deviceInstallationId);
        await writeSettings(env, settings);

        return jsonResponse({ ok: true }, { origin });
      }

      // 实时通道 WebSocket 升级：客户端在 Sec-WebSocket-Protocol 头里用
      // "jijin-token-<fcmToken>" 携带 token。验证后转发给该设备的 WsHub Durable Object。
      if (url.pathname.startsWith('/api/notify/ws/')) {
        const tail = url.pathname.slice('/api/notify/ws/'.length);
        const slashIdx = tail.indexOf('/');
        const deviceInstallationIdRaw = slashIdx === -1 ? tail : tail.slice(0, slashIdx);
        const subpath = slashIdx === -1 ? '' : tail.slice(slashIdx + 1);
        const deviceInstallationId = normalizeDeviceInstallationId(safeDecodePathSegment(deviceInstallationIdRaw || ''));

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
          if (!reg.isWebClient && !String(reg.deviceInstallationId || reg.id || '').startsWith('web-ws:')) {
            return jsonResponse({ ok: false, message: '旧版 Android GCM/FCM 设备已下线。' }, { status: 410, origin });
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

      const status = Number(error?.status) || 0;
      if (error instanceof NotifyClientError || (status >= 400 && status < 500)) {
        return jsonResponse({
          error: error instanceof Error ? error.message : '通知请求无效'
        }, {
          status,
          origin
        });
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
      ctx.waitUntil(runSwitchStrategyTick(env, scheduledMs, { reason: 'switch-cron', runClientDetection }));
      // 场内切换 cron 每分钟运行一次，也顺便推送行情
      ctx.waitUntil(runMarketDataPush(env).catch((error) => {
        console.log('[notify] marketPush error', JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
        }));
      }));
      return;
    }

    console.log('[notify] scheduled dispatch -> runDetection', JSON.stringify({ cron }));
    ctx.waitUntil(runDetection(env, 'scheduled'));

    // 行情数据 WS 推送：每次 cron 都尝试推送，由 runMarketDataPush 内部判断
    // 是否有活跃订阅、是否在交易时段、数据是否有变化。
    ctx.waitUntil(runMarketDataPush(env).catch((error) => {
      console.log('[notify] marketPush error', JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
      }));
    }));

    try {
      const todayShanghai = shanghaiDate || getShanghaiDateParts(new Date(scheduledMs)).date;
      const hhmm = shanghaiHHMM || getShanghaiDateParts(new Date(scheduledMs)).hhmm;
      if (hhmm === '15:30') {
        console.log('[notify] scheduled dispatch -> runHoldingsNotifications', JSON.stringify({ kind: 'exchange', hhmm, todayShanghai }));
        ctx.waitUntil(runHoldingsNotifications(env, 'exchange', todayShanghai, 'holdings-scheduled-1530', { runClientDetection }));
      } else if (hhmm === '20:30') {
        console.log('[notify] scheduled dispatch -> runHoldingsNotifications', JSON.stringify({ kind: 'otc', hhmm, todayShanghai }));
        ctx.waitUntil(runHoldingsNotificationsAll(env, todayShanghai, 'holdings-scheduled-2030', { runClientDetection }));
      } else if (hhmm === '21:30') {
        console.log('[notify] scheduled dispatch -> runHoldingsNotifications', JSON.stringify({ kind: 'otc', hhmm, todayShanghai }));
        ctx.waitUntil(runHoldingsNotificationsAll(env, todayShanghai, 'holdings-scheduled-2130', { runClientDetection }));
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
