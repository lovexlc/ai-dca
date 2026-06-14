import { jsonResponse, readOrigin } from './notifyHttp.js';
import { ensureStateBinding, readJson, readSettings, writeJson, writeSettings } from './notifyStorage.js';
import {
  ensureAuthenticatedClient,
  getClientRecord,
  normalizeClientName
} from './clientSettings.js';
import { trackAnalyticsEvent } from './notifyClientRoutes.js';
import {
  fetchLatestNavMapWithCache,
  fetchFundMetricPrices
} from './getNav.js';
import {
  getExpectedLatestNavDate,
  getLatestNav,
  getTodayShanghaiDate
} from './holdingsNavSupport.js';
import {
  SWITCH_CONFIG_PREFIX,
  buildSwitchTriggerNotification,
  collectSwitchConfigCodes,
  computeSwitchSnapshot,
  evaluateSwitchTriggers,
  getRunnableSwitchRules,
  isInTradingSession,
  isSwitchConfigRunnable,
  normalizeSwitchConfig,
  refreshSnapshotWithLatestNav,
  switchConfigKey,
  switchSnapshotKey,
  switchStateKey,
  testGetNav513100
} from './switchStrategy.js';
import {
  createDefaultSwitchPaperState,
  executeSwitchPaperTrade,
  normalizeSwitchPaperState,
  switchPaperStateKey
} from './premiumPaperTrading.js';

export async function readSwitchConfigForClient(env, clientId) {
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

async function readSwitchPaperStateForClient(env, clientId) {
  return normalizeSwitchPaperState(await readJson(env, switchPaperStateKey(clientId), null));
}

async function writeSwitchPaperStateForClient(env, clientId, state) {
  const normalized = normalizeSwitchPaperState({
    ...state,
    updatedAt: state?.updatedAt || new Date().toISOString()
  });
  await writeJson(env, switchPaperStateKey(clientId), normalized);
  return normalized;
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

export async function handleSwitchConfigGet(request, env) {
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

export async function handleSwitchConfigPost(request, env) {
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
    activeRuleId: payload?.activeRuleId,
    rules: Array.isArray(payload?.rules) ? payload.rules : undefined,
    benchmarkCodes: Array.isArray(payload?.benchmarkCodes)
      ? payload.benchmarkCodes
      : (payload?.benchmarkCode ? [payload.benchmarkCode] : []),
    enabledCodes: payload?.enabledCodes ?? payload?.candidateCodes,
    premiumClass: payload?.premiumClass,
    intraSellLowerPct: payload?.intraSellLowerPct,
    intraBuyOtherPct: payload?.intraBuyOtherPct,
    otcPremiumThresholdPct: payload?.otcPremiumThresholdPct,
    otcMinIntraPremiumLow: payload?.otcMinIntraPremiumLow,
    otcMinIntraPremiumHigh: payload?.otcMinIntraPremiumHigh,
    clientLabel: auth.clientRecord?.clientLabel || ''
  });
  return jsonResponse({ ok: true, config: nextConfig }, { origin });
}

export async function handleSwitchSnapshotGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  let snapshot = await readSwitchSnapshotForClient(env, auth.clientId);
  const config = await readSwitchConfigForClient(env, auth.clientId);

  // 自动刷新净值：当 KV 里的 snapshot 是基于陈旧 NAV 算出时，直接补充最新净值，避免完整重算。
  try {
    if (snapshot && !Array.isArray(snapshot.rules) && config && isSwitchConfigRunnable({ ...config, enabled: true })) {
      const benchmarkCodes = Array.isArray(config.benchmarkCodes) ? config.benchmarkCodes : [];
      const probeCode = benchmarkCodes[0]
        || (Array.isArray(config.enabledCodes) ? config.enabledCodes[0] : null);
      if (probeCode) {
        const computedAtMs = snapshot?.computedAt ? Date.parse(snapshot.computedAt) : 0;
        const tooRecent = Number.isFinite(computedAtMs) && computedAtMs > 0
          && (Date.now() - computedAtMs) < 3 * 60 * 1000;
        if (!tooRecent) {
          let snapshotNavDate = '';
          const byBenchmark = Array.isArray(snapshot.byBenchmark) ? snapshot.byBenchmark : [];
          const benchEntry = byBenchmark.find((b) => b?.benchmarkCode === probeCode);
          if (benchEntry?.benchmarkNavDate) snapshotNavDate = String(benchEntry.benchmarkNavDate);
          if (!snapshotNavDate) {
            for (const b of byBenchmark) {
              const cand = (b?.candidates || []).find((c) => c?.code === probeCode);
              if (cand?.navDate) { snapshotNavDate = String(cand.navDate); break; }
            }
          }
          const latest = await getLatestNav(env, probeCode, 'exchange');
          const latestDate = String(latest?.latestNavDate || '');
          const stale = latestDate && (!snapshotNavDate || latestDate > snapshotNavDate);
          if (stale) {
            try {
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
    console.warn('[notify] switch snapshot auto-refresh exception:', _error);
  }

  return jsonResponse({
    ok: true,
    snapshot,
    config: config || normalizeSwitchConfig({ enabled: false })
  }, { origin });
}

export async function handleSwitchPaperGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const state = await readSwitchPaperStateForClient(env, auth.clientId);
  return jsonResponse({
    ok: true,
    clientId: auth.clientId,
    state
  }, { origin });
}

export async function handleSwitchPaperPost(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '')
  });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const current = await readSwitchPaperStateForClient(env, auth.clientId);
  const nextState = payload?.reset
    ? createDefaultSwitchPaperState(payload?.state || {})
    : normalizeSwitchPaperState({
        ...current,
        ...(payload?.state && typeof payload.state === 'object' ? payload.state : payload)
      });
  const state = await writeSwitchPaperStateForClient(env, auth.clientId, nextState);
  return jsonResponse({
    ok: true,
    clientId: auth.clientId,
    state
  }, { origin });
}

export async function handleSwitchRunPost(request, env, { runClientDetection }) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await readSwitchConfigForClient(env, auth.clientId);
  if (!config || !isSwitchConfigRunnable({ ...config, enabled: true })) {
    return jsonResponse({
      ok: false,
      error: '当前没有可计算的「切换」配置：请先选择基准 ETF 和候选 ETF；场内自动推送还需要 H/L 两表里各有至少一只已分类。'
    }, { status: 400, origin });
  }
  const summary = await runSwitchStrategyForOneClient(env, auth.clientId, config, {
    reason: 'switch-manual-run',
    runClientDetection
  });
  await trackAnalyticsEvent(env, 'switch_worker_run', { clientId: auth.clientId, reason: 'switch-manual-run', triggered: summary?.triggered || 0, skipped: summary?.skipped || '' });
  const snapshot = await readSwitchSnapshotForClient(env, auth.clientId);
  return jsonResponse({ ok: true, summary, snapshot }, { origin });
}

async function runSwitchStrategyForOneClient(env, clientId, config, { reason = 'switch-strategy', priceMap = null, navByCode = null, computedAt = '', runClientDetection } = {}) {
  let settings = await readSettings(env);
  const clientRecord = getClientRecord(settings, clientId);
  if (!clientRecord || !clientRecord.clientId) {
    return { triggered: 0, skipped: 'no-client' };
  }
  const normalizedConfig = normalizeSwitchConfig(config);
  const runnableRules = getRunnableSwitchRules({ ...normalizedConfig, enabled: true });
  if (!runnableRules.length) {
    return { triggered: 0, pushed: 0, skipped: 'no-runnable-rule' };
  }
  const codes = collectSwitchConfigCodes(normalizedConfig);
  const effectivePriceMap = priceMap || await fetchFundMetricPrices(codes, env).catch(() => ({}));

  const effectiveNavMap = navByCode || await fetchLatestNavMapWithCache(env, codes, [], {
    forceRefresh: false,
    todayDate: getTodayShanghaiDate(),
    readCache: async (key, fallback) => readJson(env, key, fallback),
    writeCache: async (key, value) => writeJson(env, key, value),
    getExpectedLatestNavDate
  });

  const computedAtIso = computedAt || new Date().toISOString();
  const prevState = (await readJson(env, switchStateKey(clientId), null)) || {};
  const prevStatesByRule = (prevState && typeof prevState.triggerStatesByRule === 'object' && prevState.triggerStatesByRule)
    ? prevState.triggerStatesByRule
    : {};
  const nextTriggerStatesByRule = {};
  const snapshots = [];
  const triggerJobs = [];
  for (const rule of runnableRules) {
    const ruleConfig = {
      ...rule,
      ruleId: rule.id,
      ruleName: rule.name,
      enabled: rule.enabled
    };
    const snapshot = computeSwitchSnapshot(ruleConfig, effectivePriceMap, effectiveNavMap, computedAtIso);
    const prevRuleStates = prevStatesByRule[rule.id] || prevState.triggerStates || {};
    const { triggers, nextTriggerStates } = evaluateSwitchTriggers(snapshot, prevRuleStates);
    const taggedTriggers = triggers.map((trigger) => ({
      ...trigger,
      ruleId: rule.id,
      ruleName: rule.name,
      pairKey: `${rule.id}:${trigger.pairKey}`
    }));
    snapshot.triggers = taggedTriggers;
    snapshots.push(snapshot);
    nextTriggerStatesByRule[rule.id] = nextTriggerStates;
    for (const trigger of taggedTriggers) {
      triggerJobs.push({ snapshot, trigger });
    }
  }
  const activeSnapshot = snapshots.find((snapshot) => snapshot.ruleId === normalizedConfig.activeRuleId)
    || snapshots[0]
    || null;
  const allTriggers = triggerJobs.map((job) => job.trigger);
  const shouldCombineSnapshot = (normalizedConfig.rules || []).length > 1;
  const snapshotToStore = shouldCombineSnapshot
    ? {
        ...(activeSnapshot || {}),
        computedAt: computedAtIso,
        activeRuleId: normalizedConfig.activeRuleId,
        rules: snapshots.map((snapshot) => ({
          ruleId: snapshot.ruleId,
          ruleName: snapshot.ruleName,
          ready: Boolean(snapshot.ready),
          signalCount: Array.isArray(snapshot.signals) ? snapshot.signals.length : 0,
          triggerCount: Array.isArray(snapshot.triggers) ? snapshot.triggers.length : 0,
          snapshot
        })),
        signals: snapshots.flatMap((snapshot) => Array.isArray(snapshot.signals) ? snapshot.signals : []),
        triggers: allTriggers,
        ready: snapshots.some((snapshot) => snapshot.ready)
      }
    : (activeSnapshot || { computedAt: computedAtIso, ready: false, triggers: [] });
  await writeJson(env, switchSnapshotKey(clientId), snapshotToStore);
  await writeJson(env, switchStateKey(clientId), {
    triggerStates: snapshots.length === 1 ? nextTriggerStatesByRule[snapshots[0].ruleId] : {},
    triggerStatesByRule: nextTriggerStatesByRule,
    updatedAt: computedAtIso
  });
  let pushedCount = 0;
  let paperExecutedCount = 0;
  let paperOrderCount = 0;
  let paperSkippedCount = 0;
  const paperResults = [];
  for (const { snapshot, trigger } of triggerJobs) {
    try {
      const paperState = await readSwitchPaperStateForClient(env, clientId);
      const paperResult = executeSwitchPaperTrade(paperState, snapshot, trigger, computedAtIso);
      const shouldPersistPaper = paperResult.executed || paperResult.skipped;
      if (shouldPersistPaper) {
        await writeSwitchPaperStateForClient(env, clientId, paperResult.state);
      }
      if (paperResult.executed) {
        paperExecutedCount += 1;
        paperOrderCount += paperResult.fills.length;
      } else if (paperResult.skipped) {
        paperSkippedCount += 1;
      }
      paperResults.push({
        trigger: trigger.pairKey,
        executed: paperResult.executed,
        orders: paperResult.fills.length,
        skipped: paperResult.skipped || ''
      });
    } catch {
      paperSkippedCount += 1;
      paperResults.push({
        trigger: trigger.pairKey,
        executed: false,
        orders: 0,
        skipped: 'paper-error'
      });
    }

    if (!normalizedConfig.enabled) break;
    const testPayload = buildSwitchTriggerNotification(snapshot, trigger, env);
    try {
      const result = await runClientDetection(env, settings, clientRecord, {
        reason,
        testPayload
      });
      settings = result.settings;
      pushedCount += 1;
    } catch {
      // 忽略单条失败：下一分钟若仍处触发态会再尝试推送。
    }
  }
  if (pushedCount) {
    await writeSettings(env, settings);
  }
  return {
    triggered: allTriggers.length,
    pushed: pushedCount,
    paperExecuted: paperExecutedCount,
    paperOrders: paperOrderCount,
    paperSkipped: paperSkippedCount,
    paperResults,
    ruleCount: runnableRules.length,
    candidateCount: snapshots.reduce((sum, snapshot) => (
      sum + (snapshot.byBenchmark || []).reduce((acc, b) => acc + ((b.candidates || []).length), 0)
    ), 0),
    ready: snapshots.some((snapshot) => snapshot.ready)
  };
}

export async function handleSwitchTestNav(request, env) {
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

export async function runSwitchStrategyTick(env, scheduledMs, { reason = 'switch-cron', runClientDetection } = {}) {
  const scheduledIso = new Date(scheduledMs).toISOString();
  console.log('[notify] runSwitchStrategyTick enter', JSON.stringify({
    reason,
    scheduledMs,
    scheduledIso
  }));
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
    for (const code of collectSwitchConfigCodes(config)) allCodes.add(code);
  }
  const codeList = Array.from(allCodes);
  const [priceMap, navByCode] = await Promise.all([
    fetchFundMetricPrices(codeList, env).catch(() => ({})),
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
        computedAt,
        runClientDetection
      });
      await trackAnalyticsEvent(env, 'switch_worker_run', { clientId, reason, triggered: summary?.triggered || 0, skipped: summary?.skipped || '' });
    } catch (_error) {
      // 单个 client 失败不阻断整轮。
    }
  }
}
