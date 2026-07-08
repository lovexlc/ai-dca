import { evaluatePositionDigest, evaluateSellPlanSignals, evaluateVixSignal, runNotificationCycle } from './evaluator.js';
import { readSettings, writeSettings } from './notifyStorage.js';
import { compileNotifyRules, normalizeNotifyPayload } from './rules.js';
import { handleBark, isBarkRoute } from './bark.js';
import { WsHub } from './wsHub.js';
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
  buildScopedNotifySettings,
  ensureAuthenticatedClient,
  getClientRecord,
  NotifyClientError,
  normalizeClientId,
  readCurrentClientId,
  upsertClientRecord
} from './clientSettings.js';
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
import { handleAdminMarketPremiumDigest } from './marketPremiumDigest.js';
import { getShanghaiDateParts, isTradingDayShanghai } from './holdingsNavSupport.js';
import { normalizeServerChan3Config } from './channels/serverChan3.js';
import {
  handleWebWsRegister,
  handleWebWsRequest,
  handleWebWsUnregister
} from './webWsRoutes.js';
import { handleWechatRoute } from './wechatRoutes.js';
import { requireAdminToken } from './security.js';

// 把 Durable Object 类型重新导出，让 Workers runtime 能在加载 wrangler 绑定时
// 通过 entry module 的导出表找到 class_name="WsHub"。
export { WsHub };

function normalizeTestTargetChannel(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ios' || normalized === 'bark') return 'bark';
  if (normalized === 'android' || normalized === 'andriod' || normalized === 'serverchan' || normalized === 'serverchan3') return 'serverchan3';
  if (normalized === 'pc' || normalized === 'ws') return normalized;
  return '';
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
    accountUsername: payload?.accountUsername || '',
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
      detailUrl: String(payload.detailUrl || payload.url || '').trim(),
      url: String(payload.url || payload.detailUrl || '').trim(),
      links: payload.links && typeof payload.links === 'object' ? payload.links : null,
      target: String(payload.target || '').trim(),
      params: payload.params && typeof payload.params === 'object' ? payload.params : null
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
  } else {
    const authError = requireAdminToken(request, env, { origin });
    if (authError) return authError;
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
      if (url.pathname.startsWith('/api/wechat/')) {
        return await handleWechatRoute(request, env, { origin });
      }

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

      if (request.method === 'POST' && url.pathname === '/api/notify/admin/market-premium-digest') {
        return await handleAdminMarketPremiumDigest(request, env, { runClientDetection });
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

      if (url.pathname.startsWith('/api/notify/quant/')) {
        return jsonResponse({ error: '量化研究功能已移除。' }, { status: 410, origin });
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/health') {
        return jsonResponse({ ok: true }, { origin });
      }

      // ── Web 客户端 WebSocket 注册 ──────────────────────────────
      // PC 浏览器通过此端点获取 deviceInstallationId + token，然后接入 WsHub。
      if (request.method === 'POST' && url.pathname === '/api/notify/ws/register') {
        return await handleWebWsRegister(request, env);
      }

      // ── Web 客户端 WebSocket 注销 ──────────────────────────────
      if (request.method === 'POST' && url.pathname === '/api/notify/ws/unregister') {
        return await handleWebWsUnregister(request, env);
      }

      // 实时通道 WebSocket 升级：客户端在 Sec-WebSocket-Protocol 头里用
      // "jijin-token-<fcmToken>" 携带 token。验证后转发给该设备的 WsHub Durable Object。
      if (url.pathname.startsWith('/api/notify/ws/')) {
        return await handleWebWsRequest(request, env, url);
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
    // 分钟级 cron：A 股交易时段内扫描基金切换策略，同时保留行情 WS 推送。
    if (cron === '* 1-7 * * MON-FRI') {
      console.log('[notify] scheduled dispatch -> runSwitchStrategyTick', JSON.stringify({ cron }));
      ctx.waitUntil(runSwitchStrategyTick(env, scheduledMs, {
        reason: 'switch-cron',
        runClientDetection
      }).catch((error) => {
        console.log('[notify] switchStrategyTick error', JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
        }));
      }));
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
      // cron 已限定 MON-FRI，但不排除工作日法定节假日（如国庆/春节）。非交易日不应推送「当日收益」，
      // 否则会把上一交易日净值的收益误报为今日收益（与前端 holdingsLedgerCore 的交易日门禁一致）。
      if (!isTradingDayShanghai(todayShanghai)) {
        console.log('[notify] scheduled holdings dispatch skipped: non-trading day', JSON.stringify({ hhmm, todayShanghai }));
      } else if (hhmm === '15:30') {
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
