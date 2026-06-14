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
  getTodayShanghaiDate
} from './holdingsNavSupport.js';
import {
  buildSwitchTriggerNotification,
  computeSwitchSnapshot,
  evaluateSwitchTriggers,
  getRunnableSwitchRules,
  isInTradingSession,
  normalizeSwitchConfig
} from './switchStrategy.js';
import {
  adjustSwitchPaperCash,
  createDefaultSwitchPaperState,
  executeSwitchPaperTrade,
  normalizeSwitchPaperState,
  quantPremiumPaperStateKey
} from './premiumPaperTrading.js';

export const QUANT_PREMIUM_CONFIG_PREFIX = 'quant:premium:config:';
const QUANT_PREMIUM_SNAPSHOT_PREFIX = 'quant:premium:snapshot:';
const QUANT_PREMIUM_STATE_PREFIX = 'quant:premium:state:';
const FUND_CODE_PATTERN = /^\d{6}$/;
const MAX_CODES_PER_SIDE = 20;

const DEFAULT_QUANT_PREMIUM_CONFIG = {
  enabled: false,
  name: '纳指 ETF 溢价差',
  highCodes: ['159513'],
  lowCodes: ['513100', '159501'],
  activeSide: 'all',
  intraSellLowerPct: 1,
  intraBuyOtherPct: 3,
  notifyEnabled: true,
  updatedAt: ''
};

function quantPremiumConfigKey(clientId) {
  return `${QUANT_PREMIUM_CONFIG_PREFIX}${String(clientId || '').trim()}`;
}

function quantPremiumSnapshotKey(clientId) {
  return `${QUANT_PREMIUM_SNAPSHOT_PREFIX}${String(clientId || '').trim()}`;
}

function quantPremiumStateKey(clientId) {
  return `${QUANT_PREMIUM_STATE_PREFIX}${String(clientId || '').trim()}`;
}

function sanitizeCode(value = '') {
  const code = String(value || '').trim();
  return FUND_CODE_PATTERN.test(code) ? code : '';
}

function normalizeCodeList(value) {
  const rawList = Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,，、;；|]+/);
  const seen = new Set();
  const list = [];
  for (const raw of rawList) {
    const code = sanitizeCode(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    list.push(code);
    if (list.length >= MAX_CODES_PER_SIDE) break;
  }
  return list;
}

function pickPercent(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < -50) return -50;
  if (num > 50) return 50;
  return num;
}

function normalizeActiveSide(value = '') {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'H') return 'H';
  if (normalized === 'L') return 'L';
  return 'all';
}

export function normalizeQuantPremiumConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const highCodes = normalizeCodeList(source.highCodes ?? source.hCodes ?? source.H ?? DEFAULT_QUANT_PREMIUM_CONFIG.highCodes);
  const lowCodes = normalizeCodeList(source.lowCodes ?? source.lCodes ?? source.L ?? DEFAULT_QUANT_PREMIUM_CONFIG.lowCodes)
    .filter((code) => !highCodes.includes(code));
  return {
    enabled: Boolean(source.enabled),
    name: String(source.name || DEFAULT_QUANT_PREMIUM_CONFIG.name).trim().slice(0, 60),
    highCodes,
    lowCodes,
    activeSide: normalizeActiveSide(source.activeSide),
    intraSellLowerPct: pickPercent(source.intraSellLowerPct, DEFAULT_QUANT_PREMIUM_CONFIG.intraSellLowerPct),
    intraBuyOtherPct: pickPercent(source.intraBuyOtherPct, DEFAULT_QUANT_PREMIUM_CONFIG.intraBuyOtherPct),
    notifyEnabled: source.notifyEnabled === undefined ? true : Boolean(source.notifyEnabled),
    updatedAt: String(source.updatedAt || '').trim()
  };
}

export function buildQuantPremiumSwitchConfig(input = {}) {
  const config = normalizeQuantPremiumConfig(input);
  const allCodes = Array.from(new Set([...config.highCodes, ...config.lowCodes]));
  const premiumClass = {};
  for (const code of config.highCodes) premiumClass[code] = 'H';
  for (const code of config.lowCodes) premiumClass[code] = 'L';
  const benchmarkCodes = config.activeSide === 'H'
    ? config.highCodes
    : config.activeSide === 'L'
      ? config.lowCodes
      : allCodes;
  const enabledCodes = config.activeSide === 'H'
    ? config.lowCodes
    : config.activeSide === 'L'
      ? config.highCodes
      : [];
  return normalizeSwitchConfig({
    enabled: config.enabled,
    activeRuleId: 'quant-premium',
    rules: [{
      id: 'quant-premium',
      name: config.name,
      enabled: true,
      benchmarkCodes,
      enabledCodes,
      premiumClass,
      intraSellLowerPct: config.intraSellLowerPct,
      intraBuyOtherPct: config.intraBuyOtherPct
    }]
  });
}

function collectQuantPremiumCodes(config = {}) {
  const normalized = normalizeQuantPremiumConfig(config);
  return Array.from(new Set([...normalized.highCodes, ...normalized.lowCodes]));
}

async function readQuantPremiumConfigForClient(env, clientId) {
  const stored = await readJson(env, quantPremiumConfigKey(clientId), null);
  return stored ? normalizeQuantPremiumConfig(stored) : normalizeQuantPremiumConfig(DEFAULT_QUANT_PREMIUM_CONFIG);
}

async function writeQuantPremiumConfigForClient(env, clientId, config) {
  const normalized = normalizeQuantPremiumConfig({
    ...config,
    updatedAt: new Date().toISOString()
  });
  await writeJson(env, quantPremiumConfigKey(clientId), normalized);
  return normalized;
}

async function readQuantPremiumPaperStateForClient(env, clientId) {
  return normalizeSwitchPaperState(await readJson(env, quantPremiumPaperStateKey(clientId), null));
}

async function writeQuantPremiumPaperStateForClient(env, clientId, state) {
  const normalized = normalizeSwitchPaperState({
    ...state,
    updatedAt: state?.updatedAt || new Date().toISOString()
  });
  await writeJson(env, quantPremiumPaperStateKey(clientId), normalized);
  return normalized;
}

async function listQuantPremiumClientIds(env) {
  ensureStateBinding(env);
  const ids = [];
  let cursor;
  do {
    const result = await env.NOTIFY_STATE.list({ prefix: QUANT_PREMIUM_CONFIG_PREFIX, cursor });
    for (const item of result.keys || []) {
      const clientId = String(item.name || '').slice(QUANT_PREMIUM_CONFIG_PREFIX.length);
      if (clientId) ids.push(clientId);
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  return ids;
}

function stripTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

function buildQuantPremiumTriggerNotification(snapshot, trigger, paperResult, env) {
  const payload = buildSwitchTriggerNotification(snapshot, trigger, env);
  const baseUrl = stripTrailingSlash(env?.PUBLIC_DATA_BASE_URL || 'https://tools.freebacktrack.tech');
  const paperText = paperResult?.executed
    ? `模拟盘已成交 ${paperResult.fills.length} 笔`
    : `模拟盘未成交：${paperResult?.skipped || '未满足撮合条件'}`;
  return {
    ...payload,
    ruleId: `quant-premium:${trigger.ruleId || 'default'}:${trigger.fromCode || ''}`,
    strategyName: trigger.ruleName ? `量化溢价差 · ${trigger.ruleName}` : '量化溢价差',
    detailUrl: `${baseUrl}/index.html?tab=quant`,
    title: `量化 ${payload.title || '溢价差信号'}`,
    body: `${payload.body || ''}\n${paperText}`,
    summary: `${payload.summary || '量化溢价差信号'} · ${paperText}`,
    body_md: `${payload.body_md || payload.body || ''}\n\n${paperText}`
  };
}

async function runQuantPremiumForOneClient(env, clientId, config, { reason = 'quant-premium', priceMap = null, navByCode = null, computedAt = '', runClientDetection } = {}) {
  const normalizedConfig = normalizeQuantPremiumConfig(config);
  const switchConfig = buildQuantPremiumSwitchConfig(normalizedConfig);
  const runnableRules = getRunnableSwitchRules(switchConfig);
  if (!runnableRules.length) {
    return { triggered: 0, pushed: 0, paperExecuted: 0, paperOrders: 0, skipped: 'no-runnable-rule' };
  }

  const codes = collectQuantPremiumCodes(normalizedConfig);
  const effectivePriceMap = priceMap || await fetchFundMetricPrices(codes, env).catch(() => ({}));
  const effectiveNavMap = navByCode || await fetchLatestNavMapWithCache(env, codes, [], {
    forceRefresh: false,
    todayDate: getTodayShanghaiDate(),
    readCache: async (key, fallback) => readJson(env, key, fallback),
    writeCache: async (key, value) => writeJson(env, key, value),
    getExpectedLatestNavDate
  });

  const computedAtIso = computedAt || new Date().toISOString();
  const prevState = (await readJson(env, quantPremiumStateKey(clientId), null)) || {};
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
    const prevRuleStates = prevStatesByRule[rule.id] || {};
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

  const snapshotToStore = snapshots[0] || { computedAt: computedAtIso, ready: false, triggers: [] };
  await writeJson(env, quantPremiumSnapshotKey(clientId), snapshotToStore);
  await writeJson(env, quantPremiumStateKey(clientId), {
    triggerStates: snapshots[0] ? nextTriggerStatesByRule[snapshots[0].ruleId] : {},
    triggerStatesByRule: nextTriggerStatesByRule,
    updatedAt: computedAtIso
  });

  let settings = await readSettings(env);
  const clientRecord = getClientRecord(settings, clientId);
  let pushedCount = 0;
  let paperExecutedCount = 0;
  let paperOrderCount = 0;
  let paperSkippedCount = 0;
  const paperResults = [];

  for (const { snapshot, trigger } of triggerJobs) {
    const paperState = await readQuantPremiumPaperStateForClient(env, clientId);
    const paperResult = executeSwitchPaperTrade(paperState, snapshot, trigger, computedAtIso);
    if (paperResult.executed || paperResult.skipped) {
      await writeQuantPremiumPaperStateForClient(env, clientId, paperResult.state);
    }
    if (paperResult.executed) {
      paperExecutedCount += 1;
      paperOrderCount += paperResult.fills.length;
    } else {
      paperSkippedCount += 1;
    }
    paperResults.push({
      trigger: trigger.pairKey,
      executed: paperResult.executed,
      orders: paperResult.fills.length,
      skipped: paperResult.skipped || ''
    });

    if (normalizedConfig.notifyEnabled && clientRecord?.clientId && typeof runClientDetection === 'function') {
      const testPayload = buildQuantPremiumTriggerNotification(snapshot, trigger, paperResult, env);
      try {
        const result = await runClientDetection(env, settings, clientRecord, {
          reason,
          testPayload
        });
        settings = result.settings;
        pushedCount += 1;
      } catch {
        // 单条通知失败不影响模拟盘状态。
      }
    }
  }

  if (pushedCount) {
    await writeSettings(env, settings);
  }

  return {
    triggered: triggerJobs.length,
    pushed: pushedCount,
    paperExecuted: paperExecutedCount,
    paperOrders: paperOrderCount,
    paperSkipped: paperSkippedCount,
    paperResults,
    ready: snapshots.some((snapshot) => snapshot.ready)
  };
}

export async function handleQuantPremiumConfigGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await readQuantPremiumConfigForClient(env, auth.clientId);
  return jsonResponse({ ok: true, clientId: auth.clientId, config }, { origin });
}

export async function handleQuantPremiumConfigPost(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '')
  });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await writeQuantPremiumConfigForClient(env, auth.clientId, payload?.config || payload);
  return jsonResponse({ ok: true, clientId: auth.clientId, config }, { origin });
}

export async function handleQuantPremiumSnapshotGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const [config, snapshot] = await Promise.all([
    readQuantPremiumConfigForClient(env, auth.clientId),
    readJson(env, quantPremiumSnapshotKey(auth.clientId), null)
  ]);
  return jsonResponse({ ok: true, clientId: auth.clientId, config, snapshot }, { origin });
}

export async function handleQuantPremiumPaperGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const state = await readQuantPremiumPaperStateForClient(env, auth.clientId);
  return jsonResponse({ ok: true, clientId: auth.clientId, state }, { origin });
}

export async function handleQuantPremiumPaperPost(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '')
  });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const current = await readQuantPremiumPaperStateForClient(env, auth.clientId);
  let nextState;
  let cashEvent = null;
  if (payload?.reset) {
    nextState = createDefaultSwitchPaperState(payload?.state || {});
  } else if (payload?.adjustment || payload?.cashDelta !== undefined) {
    const adjustment = payload.adjustment && typeof payload.adjustment === 'object' ? payload.adjustment : {};
    const amount = Number(adjustment.amount ?? payload.cashDelta) || 0;
    const result = adjustSwitchPaperCash(current, {
      amount,
      note: adjustment.note || payload.note || '',
      timestamp: new Date().toISOString()
    });
    nextState = result.state;
    cashEvent = result.event;
  } else {
    nextState = normalizeSwitchPaperState({
      ...current,
      ...(payload?.state && typeof payload.state === 'object' ? payload.state : payload)
    });
  }
  const state = await writeQuantPremiumPaperStateForClient(env, auth.clientId, nextState);
  return jsonResponse({ ok: true, clientId: auth.clientId, state, cashEvent }, { origin });
}

export async function handleQuantPremiumRunPost(request, env, { runClientDetection }) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await readQuantPremiumConfigForClient(env, auth.clientId);
  const switchConfig = buildQuantPremiumSwitchConfig(config);
  if (!getRunnableSwitchRules(switchConfig).length) {
    return jsonResponse({
      ok: false,
      error: '当前没有可计算的量化 H/L 配置：请至少设置一只 H 和一只 L，并启用策略。'
    }, { status: 400, origin });
  }
  const summary = await runQuantPremiumForOneClient(env, auth.clientId, config, {
    reason: 'quant-premium-manual-run',
    runClientDetection
  });
  await trackAnalyticsEvent(env, 'quant_premium_worker_run', { clientId: auth.clientId, reason: 'manual', triggered: summary?.triggered || 0, skipped: summary?.skipped || '' });
  const snapshot = await readJson(env, quantPremiumSnapshotKey(auth.clientId), null);
  return jsonResponse({ ok: true, summary, snapshot }, { origin });
}

export async function runQuantPremiumTick(env, scheduledMs, { reason = 'quant-premium-cron', runClientDetection } = {}) {
  const scheduledIso = new Date(scheduledMs).toISOString();
  console.log('[notify] runQuantPremiumTick enter', JSON.stringify({ reason, scheduledMs, scheduledIso }));
  if (!isInTradingSession(new Date(scheduledMs))) {
    console.log('[notify] runQuantPremiumTick skip: outside trading session', JSON.stringify({ reason, scheduledIso }));
    return;
  }
  const clientIds = await listQuantPremiumClientIds(env);
  if (!clientIds.length) {
    console.log('[notify] runQuantPremiumTick skip: no quant premium clients', JSON.stringify({ reason }));
    return;
  }

  const enabledList = [];
  for (const clientId of clientIds) {
    const config = await readQuantPremiumConfigForClient(env, clientId);
    const switchConfig = buildQuantPremiumSwitchConfig(config);
    if (getRunnableSwitchRules(switchConfig).length) {
      enabledList.push({ clientId, config });
    }
  }
  if (!enabledList.length) return;

  const allCodes = new Set();
  for (const { config } of enabledList) {
    for (const code of collectQuantPremiumCodes(config)) allCodes.add(code);
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
      const summary = await runQuantPremiumForOneClient(env, clientId, config, {
        reason,
        priceMap,
        navByCode,
        computedAt,
        runClientDetection
      });
      await trackAnalyticsEvent(env, 'quant_premium_worker_run', { clientId, reason, triggered: summary?.triggered || 0, skipped: summary?.skipped || '' });
    } catch {
      // 单个 client 失败不阻断整轮。
    }
  }
}
