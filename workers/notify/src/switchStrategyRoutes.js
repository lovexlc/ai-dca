import { jsonResponse, readOrigin } from './notifyHttp.js';
import { ensureStateBinding, readJson, readSettings, writeJson, writeSettings } from './notifyStorage.js';
import { ensureAuthenticatedClient, getClientRecord, normalizeClientName } from './clientSettings.js';
import { trackAnalyticsEvent } from './notifyClientRoutes.js';
import { fetchLatestNavMapWithCache, fetchFundMetricPrices } from './getNav.js';
import {
  getExpectedLatestNavDate,
  hasConfirmedPushDelivery,
  getLatestNav,
  getTodayShanghaiDate
} from './holdingsNavSupport.js';
import {
  SWITCH_CONFIG_PREFIX,
  buildSwitchPushDigest,
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
  switchRecommendationCacheKey,
  switchRecommendationKey,
  switchRunKey,
  switchRunResultKey,
  switchPushDigestKey,
  switchSnapshotKey,
  switchStateKey,
  validateSwitchConfigThresholds,
  DEFAULT_SWITCH_HIGH_CODES,
  buildSwitchPremiumClass,
  normalizeSwitchHighCodes,
  testGetNav513100
} from './switchStrategy.js';
import {
  generateSwitchRecommendationData,
  hashRecommendationInput
} from './switchRecommendation.js';

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

async function markSwitchRunResultStaleAfterRuleDelete(env, clientId, removedRuleIds = [], ruleCount = 0) {
  if (!removedRuleIds.length) return;
  const key = switchRunResultKey(clientId);
  const previous = await readJson(env, key, null);
  if (!previous) return;
  await writeJson(
    env,
    key,
    {
      ...previous,
      stale: true,
      staleReason: 'rules-deleted',
      staleAt: new Date().toISOString(),
      removedRuleIds,
      ruleCount
    },
    { expirationTtl: 30 * 24 * 60 * 60 }
  );
}

export function switchRuntimeDeleteKeys(clientId) {
  return [switchSnapshotKey(clientId), switchStateKey(clientId), switchPushDigestKey(clientId)];
}

async function clearSwitchRuntimeStateAfterRuleDelete(env, clientId, removedRuleIds = [], ruleCount = 0) {
  if (!removedRuleIds.length) return;
  await Promise.all([
    ...switchRuntimeDeleteKeys(clientId).map((key) => env.NOTIFY_STATE.delete(key)),
    markSwitchRunResultStaleAfterRuleDelete(env, clientId, removedRuleIds, ruleCount)
  ]);
}

async function readSwitchSnapshotForClient(env, clientId) {
  return await readJson(env, switchSnapshotKey(clientId), null);
}

function stripTaggedPairKey(ruleId = '', pairKey = '') {
  const normalizedRuleId = String(ruleId || '').trim();
  const normalizedPairKey = String(pairKey || '').trim();
  const prefix = `${normalizedRuleId}:`;
  return normalizedRuleId && normalizedPairKey.startsWith(prefix)
    ? normalizedPairKey.slice(prefix.length)
    : normalizedPairKey;
}

export function restoreUndeliveredSwitchTriggerStates(
  prevStatesByRule = {},
  nextStatesByRule = {},
  pushedTriggerRecords = []
) {
  const deliveredPairs = new Set(
    (Array.isArray(pushedTriggerRecords) ? pushedTriggerRecords : [])
      .map((record) => {
        const ruleId = String(record?.ruleId || record?.trigger?.ruleId || '').trim();
        const pairKey = stripTaggedPairKey(ruleId, record?.pairKey || record?.trigger?.pairKey || '');
        return ruleId && pairKey ? `${ruleId}:${pairKey}` : '';
      })
      .filter(Boolean)
  );

  return Object.entries(nextStatesByRule || {}).reduce((map, [ruleId, nextStates]) => {
    const previousStates = prevStatesByRule?.[ruleId] || {};
    map[ruleId] = Object.entries(nextStates || {}).reduce((stateMap, [pairKey, state]) => {
      const nextState = { ...(state || {}) };
      const rule = String(nextState.rule || 'none');
      const deliveryKey = `${ruleId}:${pairKey}`;
      if (rule !== 'none' && !deliveredPairs.has(deliveryKey)) {
        const prevState = previousStates?.[pairKey] || {};
        nextState.lastTriggeredDate = String(prevState.lastTriggeredDate || '').trim();
        nextState.lastTriggeredRule = String(prevState.lastTriggeredRule || '').trim();
        nextState.dailyTriggerCount = Math.max(
          0,
          Number.parseInt(String(prevState.dailyTriggerCount || '0'), 10) || 0
        );
      }
      stateMap[pairKey] = nextState;
      return stateMap;
    }, {});
    return map;
  }, {});
}

function compactSwitchCode(value = '') {
  return String(value || '')
    .trim()
    .slice(0, 24);
}

function compactSwitchAnalyticsMeta({
  clientId = '',
  reason = '',
  computedAt = '',
  trigger = {},
  payload = null
} = {}) {
  const eventId = String(payload?.eventId || '').trim();
  const detailUrl = String(payload?.detailUrl || payload?.url || '').trim();
  let source = '';
  try {
    source = detailUrl
      ? String(new URL(detailUrl, 'https://freebacktrack.tech').searchParams.get('source') || '')
      : '';
  } catch {
    source = '';
  }
  return {
    clientId,
    reason,
    computedAt,
    eventId,
    eventType: String(payload?.eventType || 'switch-strategy-trigger').slice(0, 80),
    ruleId: String(trigger?.ruleId || '').slice(0, 80),
    rule: String(trigger?.rule || '').slice(0, 32),
    kind: trigger?.kind === 'otc' || String(trigger?.rule || '').startsWith('OTC_') ? 'otc' : 'exchange',
    pairKey: String(trigger?.pairKey || '').slice(0, 120),
    fromCode: compactSwitchCode(trigger?.fromCode),
    toCode: compactSwitchCode(trigger?.toCode),
    gapPct: Number.isFinite(Number(trigger?.gapPct ?? trigger?.diffPct))
      ? Number(trigger?.gapPct ?? trigger?.diffPct)
      : null,
    threshold: Number.isFinite(Number(trigger?.threshold)) ? Number(trigger.threshold) : null,
    notificationSource: source || 'switch-strategy',
    hasDetailUrl: Boolean(detailUrl)
  };
}

function summarizeSwitchDeliveryResult(result = {}) {
  const event = Array.isArray(result?.summary?.events) ? result.summary.events[0] : null;
  const channels = Array.isArray(event?.channels) ? event.channels : [];
  const delivered = hasConfirmedPushDelivery(result);
  const deliveredChannels = [];
  const queuedChannels = [];
  const failedChannels = [];
  for (const channel of channels) {
    const name = String(channel?.channel || '').trim();
    if (!name) continue;
    const status = String(channel?.status || '').trim();
    if (
      (status === 'delivered' && ['bark', 'serverchan3', 'ws'].includes(name)) ||
      (name === 'pc' && status === 'queued')
    ) {
      deliveredChannels.push(name);
    } else if (status === 'queued') {
      queuedChannels.push(name);
    } else {
      failedChannels.push(name);
    }
  }
  return {
    delivered,
    deliveryStatus: String(event?.status || '').slice(0, 40),
    channelCount: channels.length,
    deliveredChannelCount: deliveredChannels.length,
    failedChannelCount: failedChannels.length,
    deliveredChannels: deliveredChannels.join(','),
    queuedChannels: queuedChannels.join(','),
    failedChannels: failedChannels.join(',')
  };
}

export function buildSwitchDeliveryAnalyticsMeta({
  clientId = '',
  reason = '',
  computedAt = '',
  trigger = {},
  payload = null,
  result = null,
  error = null
} = {}) {
  const base = compactSwitchAnalyticsMeta({ clientId, reason, computedAt, trigger, payload });
  if (error) {
    return {
      ...base,
      status: 'error',
      ok: false,
      delivered: false,
      deliveryStatus: 'error',
      errorName: error?.name || '',
      errorMessage: String(error?.message || error || '').slice(0, 160)
    };
  }
  const delivery = summarizeSwitchDeliveryResult(result);
  return {
    ...base,
    status: delivery.delivered ? 'success' : 'not_delivered',
    ok: delivery.delivered,
    delivered: delivery.delivered,
    deliveryStatus: delivery.deliveryStatus,
    channelCount: delivery.channelCount,
    deliveredChannelCount: delivery.deliveredChannelCount,
    failedChannelCount: delivery.failedChannelCount,
    deliveredChannels: delivery.deliveredChannels,
    queuedChannels: delivery.queuedChannels,
    failedChannels: delivery.failedChannels
  };
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

function hasEnabledSwitchRule(config = {}) {
  return Boolean(normalizeSwitchConfig(config).rules?.some((rule) => rule.enabled));
}

function runtimeClassificationForRule(rule = {}) {
  const codes = Array.from(
    new Set([
      ...(Array.isArray(rule.benchmarkCodes) ? rule.benchmarkCodes : []),
      ...(Array.isArray(rule.enabledCodes) ? rule.enabledCodes : [])
    ])
  );
  const highPremiumCodes = normalizeSwitchHighCodes(
    Array.isArray(rule?.highPremiumCodes) ? rule.highPremiumCodes : DEFAULT_SWITCH_HIGH_CODES
  );
  const premiumClass = buildSwitchPremiumClass(codes, highPremiumCodes);
  const holdingCode = String(rule?.benchmarkCodes?.[0] || rule?.holdingFundCode || '').trim();
  const holdingSide = premiumClass[holdingCode] === 'L' ? 'low' : 'high';
  const status = 'fresh';
  const updatedAt = String(rule?.runtimeConfig?.premiumClassUpdatedAt || '').trim() || new Date().toISOString();
  const runtime = {
    ...(rule.runtimeConfig || {}),
    premiumClass,
    highPremiumCodes,
    premiumClassSource: rule?.premiumClassSource === 'user' ? 'user' : 'default',
    premiumClassUpdatedAt: updatedAt,
    classificationSource:
      String(rule?.runtimeConfig?.classificationSource || '').trim() ||
      (rule?.premiumClassSource === 'user' ? 'user' : 'default-high-list'),
    classificationStatus: status,
    classificationWarning: '',
    intraSellLowerPct: 1,
    holdingSideAtRecommendation: holdingSide,
    triggerOperatorAtRecommendation: holdingSide === 'low' ? 'lte' : 'gte'
  };
  return { ...rule, premiumClass, runtimeConfig: runtime };
}

function finiteRuntimeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function runtimeOperatorForRule(rule = {}) {
  return rule?.runtimeConfig?.triggerOperatorAtRecommendation === 'lte' || rule?.triggerOperator === 'lte'
    ? 'lte'
    : 'gte';
}

function runtimeThresholdForRule(rule = {}, operator = runtimeOperatorForRule(rule)) {
  const explicit = finiteRuntimeNumber(rule?.thresholdValue);
  if (explicit !== null) return explicit;
  const fallback = operator === 'lte' ? rule?.runtimeConfig?.intraSellLowerPct : rule?.runtimeConfig?.intraBuyOtherPct;
  return finiteRuntimeNumber(fallback);
}

function runtimeFeeForRule(rule = {}) {
  const fee = rule?.feeConfig || {};
  const notional = finiteRuntimeNumber(rule?.holdingNotional);
  if (fee.mode === 'estimated_total') {
    return finiteRuntimeNumber(fee.estimatedTotalFee);
  }
  if (notional === null || notional <= 0) return null;
  const sellRate = Math.max(0, Number(fee.sellCommissionRate) || 0);
  const buyRate = Math.max(0, Number(fee.buyCommissionRate) || 0);
  const minimum = Math.max(0, Number(fee.minimumCommission) || 0);
  const other = Math.max(0, Number(fee.otherFee) || 0);
  const sell = Math.max(minimum, (notional * sellRate) / 100);
  const buy = Math.max(minimum, (notional * buyRate) / 100);
  return Math.round((sell + buy + other) * 100) / 100;
}

function snapshotForRuntimeRule(snapshot, ruleId) {
  if (!snapshot) return null;
  if (!Array.isArray(snapshot.rules)) return snapshot;
  return snapshot.rules.find((item) => String(item?.ruleId || '') === String(ruleId || ''))?.snapshot || null;
}

function runtimeCandidateStatus(advantage, threshold, operator, isBestReached) {
  if (advantage === null || threshold === null) return 'no_data';
  const reached = operator === 'lte' ? advantage < threshold : advantage > threshold;
  if (reached) return isBestReached ? 'better' : 'reached';
  const distance = Math.abs(threshold - advantage);
  return distance <= 1 ? 'near' : 'not_reached';
}

function runtimeStatusForRule(classificationStatus, bestAdvantage, threshold, operator, hasError = false) {
  if (hasError) return 'failed';
  if (classificationStatus === 'pending_classification') return 'pending_classification';
  if (classificationStatus === 'classification_expired') return 'classification_expired';
  if (classificationStatus === 'stale') return 'stale';
  if (bestAdvantage === null || threshold === null) return 'ready';
  const reached = operator === 'lte' ? bestAdvantage < threshold : bestAdvantage > threshold;
  if (reached) return 'triggered';
  return Math.abs(threshold - bestAdvantage) <= 1 ? 'near_trigger' : 'ready';
}

export function buildSwitchRuleRuntimeView(rule = {}, snapshot = null, { error = '' } = {}) {
  const operator = runtimeOperatorForRule(rule);
  const threshold = runtimeThresholdForRule(rule, operator);
  const activeSnapshot = snapshotForRuntimeRule(snapshot, rule?.id);
  const group =
    activeSnapshot?.byBenchmark?.find((item) => String(item?.benchmarkCode || '') === String(rule?.holdingFundCode || '')) ||
    activeSnapshot?.byBenchmark?.[0] ||
    null;
  const liveNotional =
    finiteRuntimeNumber(activeSnapshot?.holdingNotional) ??
    (finiteRuntimeNumber(group?.benchmarkPrice) !== null && finiteRuntimeNumber(rule?.holdingQuantity) !== null
      ? finiteRuntimeNumber(group.benchmarkPrice) * finiteRuntimeNumber(rule.holdingQuantity)
      : finiteRuntimeNumber(rule?.holdingNotional));
  const feeRule = { ...rule, holdingNotional: liveNotional };
  const rawCandidates = Array.isArray(group?.candidates) ? group.candidates : [];
  const sorted = rawCandidates
    .map((candidate) => ({
      candidate,
      advantage: finiteRuntimeNumber(candidate?.advantagePct ?? candidate?.currentAdvantagePct ?? candidate?.gapPct)
    }))
    .sort((a, b) => {
      if (a.advantage === null && b.advantage === null) return 0;
      if (a.advantage === null) return 1;
      if (b.advantage === null) return -1;
      return operator === 'lte' ? a.advantage - b.advantage : b.advantage - a.advantage;
    });
  const bestAdvantagePct = sorted.find((item) => item.advantage !== null)?.advantage ?? null;
  const candidates = sorted.map(({ candidate, advantage }, index) => ({
    code: String(candidate?.code || '').trim(),
    name: String(candidate?.name || '').trim(),
    currentAdvantagePct: advantage,
    distancePct: advantage === null || threshold === null ? null : Math.abs(threshold - advantage),
    status: runtimeCandidateStatus(
      advantage,
      threshold,
      operator,
      index === 0 && bestAdvantagePct !== null &&
        (operator === 'lte' ? bestAdvantagePct < threshold : bestAdvantagePct > threshold)
    )
  }));
  const classificationStatus = String(
    rule?.runtimeConfig?.classificationStatus || activeSnapshot?.classificationStatus || ''
  ).trim();
  const distancePct = bestAdvantagePct === null || threshold === null ? null : Math.abs(threshold - bestAdvantagePct);
  return {
    ruleId: String(rule?.id || ''),
    status: runtimeStatusForRule(classificationStatus, bestAdvantagePct, threshold, operator, Boolean(error)),
    triggerOperator: operator,
    direction: operator === 'lte' ? 'low' : 'high',
    bestAdvantagePct,
    thresholdValue: threshold,
    distancePct,
    estimatedSwitchCost: runtimeFeeForRule(feeRule),
    holdingNotional: liveNotional,
    evaluatedAt: String(activeSnapshot?.computedAt || '').trim() || null,
    candidates
  };
}

const SHANGHAI_SCHEDULE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function getShanghaiScheduleParts(date) {
  const parts = Object.fromEntries(SHANGHAI_SCHEDULE_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

export function getNextSwitchScheduledAt(now = Date.now(), scheduleEnabled = true) {
  if (!scheduleEnabled) return null;
  const start = Math.ceil(Number(now) / 60000) * 60000 + 60000;
  for (let offset = 0; offset <= 8 * 24 * 60; offset += 1) {
    const candidate = new Date(start + offset * 60000);
    const { weekday, minutes } = getShanghaiScheduleParts(candidate);
    const businessDay = !['Sat', 'Sun'].includes(weekday);
    if (businessDay && minutes >= 9 * 60 && minutes <= 15 * 60 + 59) return candidate.toISOString();
  }
  return null;
}

export function getSwitchNotificationStatus(settings = {}, clientId = '') {
  const client = getClientRecord(settings, clientId);
  const bark = Boolean(String(client?.barkDeviceKey || '').trim());
  const serverChan = Boolean(String(client?.serverChan3?.uid || '').trim() && String(client?.serverChan3?.sendKey || '').trim());
  const gotify = Array.isArray(settings?.gotifyClients) && settings.gotifyClients.length > 0;
  const gcm = Array.isArray(settings?.gcmRegistrations) && settings.gcmRegistrations.length > 0;
  return bark || serverChan || gotify || gcm ? 'enabled' : 'unconfigured';
}

async function refreshSwitchRuntimeConfig(
  env,
  clientId,
  config,
  { priceMap = {}, navByCode = {}, isTest = false } = {}
) {
  const normalized = normalizeSwitchConfig(config);
  const rules = normalized.rules.map((rule) => (rule.enabled ? runtimeClassificationForRule(rule) : rule));
  const next = normalizeSwitchConfig({ ...normalized, rules });
  const changed =
    JSON.stringify(
      next.rules.map((rule) => ({
        id: rule.id,
        premiumClass: rule.premiumClass,
        runtimeConfig: rule.runtimeConfig
      }))
    ) !==
    JSON.stringify(
      normalized.rules.map((rule) => ({
        id: rule.id,
        premiumClass: rule.premiumClass,
        runtimeConfig: rule.runtimeConfig
      }))
    );
  if (changed && !isTest) await writeSwitchConfigForClient(env, clientId, next);
  return next;
}

export function testScopedKey(key, testId = '') {
  const safeId = String(testId || '')
    .replace(/[^A-Za-z0-9:_-]/g, '')
    .slice(0, 64);
  return safeId ? `${key}:test:${safeId}` : `${key}:test`;
}

function compactRuleRunResult(rule, snapshot, error = '') {
  const operator = rule?.runtimeConfig?.triggerOperatorAtRecommendation === 'lte' ? 'lte' : 'gte';
  const advantages = (snapshot?.byBenchmark || [])
    .flatMap((item) => item?.candidates || [])
    .map((item) => Number(item?.advantagePct ?? item?.gapPct ?? item?.diffPct))
    .filter(Number.isFinite);
  const maxAdvantage = advantages.length
    ? operator === 'lte'
      ? Math.min(...advantages)
      : Math.max(...advantages)
    : null;
  const threshold = Number(rule?.thresholdValue);
  const reached =
    Number.isFinite(maxAdvantage) &&
    Number.isFinite(threshold) &&
    (operator === 'lte' ? maxAdvantage < threshold : maxAdvantage > threshold);
  const runtimeView = buildSwitchRuleRuntimeView(rule, snapshot, { error });
  return {
    ruleId: String(rule?.id || ''),
    holdingFundCode: String(rule?.holdingFundCode || rule?.benchmarkCodes?.[0] || ''),
    status: error ? 'failed' : reached ? 'triggered' : 'not_triggered',
    runtimeStatus: runtimeView.status,
    currentMaxAdvantage: Number.isFinite(maxAdvantage) ? maxAdvantage : null,
    thresholdValue: Number.isFinite(threshold) ? threshold : null,
    distancePct:
      Number.isFinite(maxAdvantage) && Number.isFinite(threshold) ? Math.abs(threshold - maxAdvantage) : null,
    triggerCount: Array.isArray(snapshot?.triggers) ? snapshot.triggers.length : 0,
    error: String(error || ''),
    runtimeView
  };
}

export async function handleSwitchConfigGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await readSwitchConfigForClient(env, auth.clientId);
  return jsonResponse(
    {
      ok: true,
      clientId: auth.clientId,
      config: config || normalizeSwitchConfig({ enabled: false })
    },
    { origin }
  );
}

export async function handleSwitchConfigPost(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || ''),
    accountUsername: payload?.accountUsername || ''
  });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const previousConfig = await readSwitchConfigForClient(env, auth.clientId);
  const configInput = {
    enabled: payload?.enabled,
    activeRuleId: payload?.activeRuleId,
    rules: Array.isArray(payload?.rules) ? payload.rules : undefined,
    benchmarkCodes: Array.isArray(payload?.benchmarkCodes)
      ? payload.benchmarkCodes
      : payload?.benchmarkCode
        ? [payload.benchmarkCode]
        : [],
    enabledCodes: payload?.enabledCodes ?? payload?.candidateCodes,
    premiumClass: payload?.premiumClass,
    highPremiumCodes: payload?.highPremiumCodes,
    intraSellLowerPct: payload?.intraSellLowerPct,
    intraBuyOtherPct: payload?.intraBuyOtherPct,
    otcPremiumThresholdPct: payload?.otcPremiumThresholdPct,
    otcMinIntraPremiumLow: payload?.otcMinIntraPremiumLow,
    otcMinIntraPremiumHigh: payload?.otcMinIntraPremiumHigh,
    clientLabel: auth.clientRecord?.clientLabel || ''
  };
  const candidateConfig = normalizeSwitchConfig({ ...configInput, updatedAt: new Date().toISOString() });
  const validation = validateSwitchConfigThresholds(candidateConfig);
  if (!validation.valid) {
    return jsonResponse(
      {
        ok: false,
        error: validation.errors[0]?.error || '提醒值不符合要求。',
        validationErrors: validation.errors
      },
      { status: 400, origin }
    );
  }
  const nextConfig = await writeSwitchConfigForClient(env, auth.clientId, configInput);
  const nextIds = new Set((nextConfig.rules || []).map((rule) => rule.id));
  const removedRuleIds = (previousConfig?.rules || [])
    .map((rule) => rule.id)
    .filter((id) => !nextIds.has(id));
  await clearSwitchRuntimeStateAfterRuleDelete(env, auth.clientId, removedRuleIds, nextConfig.rules.length);
  return jsonResponse({ ok: true, config: nextConfig }, { origin });
}

export async function handleSwitchRecommendPost(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || ''),
    accountUsername: payload?.accountUsername || ''
  });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const input = {
    holdingFundCode: payload?.holdingFundCode,
    holdingFundName: payload?.holdingFundName,
    holdingQuantity: payload?.holdingQuantity,
    holdingNotional: payload?.holdingNotional,
    feeConfig: payload?.feeConfig || {},
    candidateCodes: payload?.candidateCodes || [],
    highCodes: Array.isArray(payload?.highCodes) ? payload.highCodes : [],
    backtestParams: payload?.backtestParams || {}
  };
  // 计算输入包含回测引擎版本，避免修复引擎后继续命中旧的失败推荐缓存。
  const cacheHash = await hashRecommendationInput({
    cacheVersion: 'codes-v3-fixed-high-list',
    clientId: auth.clientId,
    ...input
  });
  const cacheKey = switchRecommendationCacheKey(cacheHash);
  const cached = await readJson(env, cacheKey, null);
  if (cached?.recommendation) {
    return jsonResponse({ ok: true, cached: true, recommendation: cached.recommendation }, { origin });
  }
  const recommendation = await generateSwitchRecommendationData(env, input);
  await writeJson(
    env,
    switchRecommendationKey(auth.clientId, recommendation.recommendationId),
    recommendation,
    { expirationTtl: 24 * 60 * 60 }
  );
  await writeJson(
    env,
    cacheKey,
    { recommendation, cachedAt: new Date().toISOString() },
    { expirationTtl: 10 * 60 }
  );
  return jsonResponse({ ok: true, cached: false, recommendation }, { origin });
}

export async function handleSwitchRunLatestGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const result = await readJson(env, switchRunResultKey(auth.clientId), null);
  const scheduleEnabled = String(env.SWITCH_SCHEDULE_STATUS || 'enabled').trim() !== 'disabled';
  const scheduleStatus = scheduleEnabled ? 'enabled' : 'disabled';
  const notificationStatus = getSwitchNotificationStatus(settings, auth.clientId);
  const run = result
    ? {
        ...result,
        scheduleStatus: result.scheduleStatus || scheduleStatus,
        notificationStatus: result.notificationStatus || notificationStatus,
        nextScheduledAt: result.nextScheduledAt || getNextSwitchScheduledAt(Date.now(), scheduleEnabled)
      }
    : null;
  return jsonResponse(
    {
      ok: true,
      run,
      nextScheduledAt: getNextSwitchScheduledAt(Date.now(), scheduleEnabled),
      scheduleStatus,
      notificationStatus
    },
    { origin }
  );
}

export async function handleSwitchRunGet(request, env, runId) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const safeRunId = String(runId || '')
    .trim()
    .replace(/[^A-Za-z0-9:_-]/g, '')
    .slice(0, 100);
  const result = safeRunId ? await readJson(env, switchRunKey(auth.clientId, safeRunId), null) : null;
  if (!result) return jsonResponse({ ok: false, error: '运行记录不存在。' }, { status: 404, origin });
  return jsonResponse({ ok: true, run: result }, { origin });
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
    if (
      snapshot &&
      !Array.isArray(snapshot.rules) &&
      config &&
      isSwitchConfigRunnable({ ...config, enabled: true })
    ) {
      const benchmarkCodes = Array.isArray(config.benchmarkCodes) ? config.benchmarkCodes : [];
      const probeCode =
        benchmarkCodes[0] || (Array.isArray(config.enabledCodes) ? config.enabledCodes[0] : null);
      if (probeCode) {
        const computedAtMs = snapshot?.computedAt ? Date.parse(snapshot.computedAt) : 0;
        const tooRecent =
          Number.isFinite(computedAtMs) && computedAtMs > 0 && Date.now() - computedAtMs < 3 * 60 * 1000;
        if (!tooRecent) {
          let snapshotNavDate = '';
          const byBenchmark = Array.isArray(snapshot.byBenchmark) ? snapshot.byBenchmark : [];
          const benchEntry = byBenchmark.find((b) => b?.benchmarkCode === probeCode);
          if (benchEntry?.benchmarkNavDate) snapshotNavDate = String(benchEntry.benchmarkNavDate);
          if (!snapshotNavDate) {
            for (const b of byBenchmark) {
              const cand = (b?.candidates || []).find((c) => c?.code === probeCode);
              if (cand?.navDate) {
                snapshotNavDate = String(cand.navDate);
                break;
              }
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
                console.log(
                  '[notify] switch snapshot refreshed with latest nav',
                  JSON.stringify({
                    clientId: auth.clientId.slice(0, 18),
                    probeCode,
                    latestDate,
                    prevSnapshotNavDate: snapshotNavDate
                  })
                );
              }
            } catch (refreshErr) {
              console.warn(
                '[notify] switch snapshot refresh failed, returning stale data:',
                String((refreshErr && refreshErr.message) || refreshErr)
              );
            }
          }
        }
      }
    }
  } catch (_error) {
    console.warn('[notify] switch snapshot auto-refresh exception:', _error);
  }

  return jsonResponse(
    {
      ok: true,
      snapshot,
      config: config || normalizeSwitchConfig({ enabled: false }),
      runtimeViews: config
        ? config.rules.reduce((map, rule) => {
            map[rule.id] = buildSwitchRuleRuntimeView(rule, snapshot);
            return map;
          }, {})
        : {}
    },
    { origin }
  );
}

export async function handleSwitchRunPost(request, env, { runClientDetection }) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await readSwitchConfigForClient(env, auth.clientId);
  if (!config || !hasEnabledSwitchRule(config)) {
    return jsonResponse(
      {
        ok: false,
        error: '当前没有启用中的切换规则，请先添加规则。'
      },
      { status: 400, origin }
    );
  }
  const summary = await runSwitchStrategyForOneClient(env, auth.clientId, config, {
    reason: 'switch-manual-run',
    runClientDetection
  });
  if (summary?.skipped === 'pending-classification' || summary?.skipped === 'no-runnable-rule') {
    return jsonResponse(
      {
        ok: false,
        error:
          summary?.classificationWarning || '当前数据不足，暂时无法完成分类，请稍后重试或重新分析候选基金。',
        summary
      },
      { status: 409, origin }
    );
  }
  await trackAnalyticsEvent(env, 'switch_worker_run', {
    clientId: auth.clientId,
    reason: 'switch-manual-run',
    triggered: summary?.triggered || 0,
    pushed: summary?.pushed || 0,
    deliveryAttempts: summary?.deliveryAttempts || 0,
    ruleCount: summary?.ruleCount || 0,
    candidateCount: summary?.candidateCount || 0,
    ready: Boolean(summary?.ready),
    skipped: summary?.skipped || ''
  });
  const snapshot = await readSwitchSnapshotForClient(env, auth.clientId);
  return jsonResponse({ ok: true, summary, snapshot }, { origin });
}

export async function handleSwitchQuickTestPost(request, env, { runClientDetection }) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, { payload });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await readSwitchConfigForClient(env, auth.clientId);
  const ruleId = String(payload?.ruleId || '').trim();
  const rule = config?.rules?.find((item) => item.id === ruleId) || config?.rules?.[0];
  if (!rule || !rule.enabled) {
    return jsonResponse({ ok: false, error: '找不到启用中的规则。' }, { status: 400, origin });
  }
  const testId = String(payload?.testId || crypto.randomUUID())
    .replace(/[^A-Za-z0-9:_-]/g, '')
    .slice(0, 80);
  const steps = [
    { key: 'server', label: '远端服务器连接正常', status: 'passed' },
    { key: 'market', label: '行情数据获取成功', status: 'running' },
    { key: 'rule', label: '规则计算正常', status: 'pending' },
    { key: 'notification', label: '通知通道正常', status: 'pending' }
  ];
  try {
    const scopedConfig = {
      ...config,
      activeRuleId: rule.id,
      rules: [rule]
    };
    const codes = collectSwitchConfigCodes(scopedConfig);
    const priceMap = await fetchFundMetricPrices(codes, env);
    if (!Object.keys(priceMap || {}).length) throw new Error('行情服务未返回有效数据');
    steps[1].status = 'passed';
    steps[2].status = 'running';
    let navByCode;
    try {
      navByCode = await fetchLatestNavMapWithCache(env, codes, [], {
        forceRefresh: false,
        todayDate: getTodayShanghaiDate(),
        readCache: async (key, fallback) => readJson(env, key, fallback),
        writeCache: async (key, value) => writeJson(env, key, value),
        getExpectedLatestNavDate
      });
    } catch (error) {
      steps[1].status = 'failed';
      throw error;
    }
    const summary = await runSwitchStrategyForOneClient(env, auth.clientId, scopedConfig, {
      reason: 'switch-quick-test',
      runClientDetection,
      priceMap,
      navByCode,
      isTest: true,
      testId,
      persistRun: false
    });
    if (summary?.skipped) {
      steps[2].status = 'failed';
      throw new Error(summary.classificationWarning || '规则当前无法运行');
    }
    steps[2].status = 'passed';
    steps[3].status = 'passed';
    const result = summary.ruleResults?.[0] || {};
    return jsonResponse(
      {
        ok: true,
        testId,
        steps,
        summary,
        result: {
          currentMaxAdvantage: result.currentMaxAdvantage,
          thresholdValue: rule.thresholdValue,
          status: result.status,
          runtimeStatus: result.runtimeStatus || result.runtimeView?.status || 'ready',
          distancePct: result.distancePct ?? result.runtimeView?.distancePct ?? null,
          estimatedSwitchCost: result.runtimeView?.estimatedSwitchCost ?? null,
          runtimeView: result.runtimeView || null,
          responseTimeMs: Math.max(0, Date.now() - Date.parse(summary.startedAt || new Date().toISOString()))
        }
      },
      { origin }
    );
  } catch (error) {
    const message = String(error?.message || error);
    if (steps[1].status === 'running') steps[1].status = 'failed';
    if (steps[2].status === 'running') steps[2].status = 'skipped';
    steps[3].status = 'skipped';
    return jsonResponse(
      {
        ok: false,
        testId,
        steps,
        error: message,
        failureStage: steps.find((step) => step.status === 'failed')?.key || 'rule'
      },
      { status: 502, origin }
    );
  }
}

export async function runSwitchStrategyForOneClient(
  env,
  clientId,
  config,
  {
    reason = 'switch-strategy',
    priceMap = null,
    navByCode = null,
    computedAt = '',
    runClientDetection,
    isTest = false,
    testId = '',
    persistRun = !isTest
  } = {}
) {
  const startedAt = new Date().toISOString();
  let settings = await readSettings(env);
  const clientRecord = getClientRecord(settings, clientId);
  if (!clientRecord || !clientRecord.clientId) {
    return { triggered: 0, skipped: 'no-client' };
  }
  let normalizedConfig = normalizeSwitchConfig(config);
  const codes = collectSwitchConfigCodes(normalizedConfig);
  const effectivePriceMap = priceMap || (await fetchFundMetricPrices(codes, env).catch(() => ({})));

  const effectiveNavMap =
    navByCode ||
    (await fetchLatestNavMapWithCache(env, codes, [], {
      forceRefresh: false,
      todayDate: getTodayShanghaiDate(),
      readCache: async (key, fallback) => readJson(env, key, fallback),
      writeCache: async (key, value) => writeJson(env, key, value),
      getExpectedLatestNavDate
    }));

  normalizedConfig = await refreshSwitchRuntimeConfig(env, clientId, normalizedConfig, {
    priceMap: effectivePriceMap,
    navByCode: effectiveNavMap,
    isTest
  });
  const runnableRules = getRunnableSwitchRules({ ...normalizedConfig, enabled: true });
  if (!runnableRules.length) {
    const classificationStatus = normalizedConfig.rules?.find((rule) => rule.enabled)?.runtimeConfig
      ?.classificationStatus;
    return {
      triggered: 0,
      pushed: 0,
      skipped:
        classificationStatus === 'pending_classification' ? 'pending-classification' : 'no-runnable-rule',
      classificationStatus,
      classificationWarning:
        normalizedConfig.rules?.find((rule) => rule.enabled)?.runtimeConfig?.classificationWarning || ''
    };
  }
  const computedAtIso = computedAt || new Date().toISOString();
  const stateKey = isTest ? testScopedKey(switchStateKey(clientId), testId) : switchStateKey(clientId);
  const snapshotKey = isTest
    ? testScopedKey(switchSnapshotKey(clientId), testId)
    : switchSnapshotKey(clientId);
  const prevState = (await readJson(env, stateKey, null)) || {};
  const prevStatesByRule =
    prevState && typeof prevState.triggerStatesByRule === 'object' && prevState.triggerStatesByRule
      ? prevState.triggerStatesByRule
      : {};
  const nextTriggerStatesByRule = {};
  const prevTriggerStatesByRuleForRollback = {};
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
    snapshot.classificationStatus = rule.runtimeConfig?.classificationStatus || 'fresh';
    snapshot.classificationUpdatedAt = rule.runtimeConfig?.premiumClassUpdatedAt || '';
    const prevRuleStates = prevStatesByRule[rule.id] || prevState.triggerStates || {};
    prevTriggerStatesByRuleForRollback[rule.id] = prevRuleStates;
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
  const activeSnapshot =
    snapshots.find((snapshot) => snapshot.ruleId === normalizedConfig.activeRuleId) || snapshots[0] || null;
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
        signals: snapshots.flatMap((snapshot) => (Array.isArray(snapshot.signals) ? snapshot.signals : [])),
        triggers: allTriggers,
        ready: snapshots.some((snapshot) => snapshot.ready)
      }
    : activeSnapshot || { computedAt: computedAtIso, ready: false, triggers: [] };
  await writeJson(env, snapshotKey, { ...snapshotToStore, isTest, testId: isTest ? testId : undefined });
  let pushedCount = 0;
  let deliveryAttemptCount = 0;
  const pushedTriggerRecords = [];
  for (const { snapshot, trigger } of triggerJobs) {
    if (!normalizedConfig.enabled) break;
    if (isTest) continue;
    const testPayload = buildSwitchTriggerNotification(snapshot, trigger, env);
    const triggerMeta = compactSwitchAnalyticsMeta({
      clientId,
      reason,
      computedAt: computedAtIso,
      trigger,
      payload: testPayload
    });
    await trackAnalyticsEvent(env, 'switch_notification_triggered', {
      ...triggerMeta,
      status: 'triggered',
      ok: true
    });
    deliveryAttemptCount += 1;
    try {
      const result = await runClientDetection(env, settings, clientRecord, {
        reason,
        testPayload
      });
      settings = result.settings;
      await trackAnalyticsEvent(
        env,
        'switch_notification_delivery',
        buildSwitchDeliveryAnalyticsMeta({
          clientId,
          reason,
          computedAt: computedAtIso,
          trigger,
          payload: testPayload,
          result
        })
      );
      if (hasConfirmedPushDelivery(result)) {
        pushedCount += 1;
        pushedTriggerRecords.push({
          ruleId: trigger.ruleId || '',
          pairKey: trigger.pairKey || '',
          trigger,
          event: Array.isArray(result?.summary?.events) ? result.summary.events[0] : null
        });
      }
    } catch (error) {
      console.log(
        '[notify] switch trigger delivery failed',
        JSON.stringify({
          clientId,
          reason,
          eventId: testPayload?.eventId || '',
          ruleId: trigger?.ruleId || '',
          pairKey: trigger?.pairKey || '',
          message: error instanceof Error ? error.message : String(error)
        })
      );
      await trackAnalyticsEvent(
        env,
        'switch_notification_delivery',
        buildSwitchDeliveryAnalyticsMeta({
          clientId,
          reason,
          computedAt: computedAtIso,
          trigger,
          payload: testPayload,
          error
        })
      );
    }
  }
  const committedTriggerStatesByRule = restoreUndeliveredSwitchTriggerStates(
    prevTriggerStatesByRuleForRollback,
    nextTriggerStatesByRule,
    pushedTriggerRecords
  );
  await writeJson(env, stateKey, {
    triggerStates: snapshots.length === 1 ? committedTriggerStatesByRule[snapshots[0].ruleId] : {},
    triggerStatesByRule: committedTriggerStatesByRule,
    updatedAt: computedAtIso
  });
  if (deliveryAttemptCount) {
    await writeSettings(env, settings);
  }
  if (pushedTriggerRecords.length && !isTest) {
    const digest = buildSwitchPushDigest({
      clientId,
      computedAt: computedAtIso,
      triggerRecords: pushedTriggerRecords
    });
    if (digest) await writeJson(env, switchPushDigestKey(clientId), digest);
  }
  const finishedAt = new Date().toISOString();
  const summary = {
    runId: isTest ? String(testId || '') : crypto.randomUUID(),
    startedAt,
    finishedAt,
    triggered: allTriggers.length,
    pushed: pushedCount,
    deliveryAttempts: deliveryAttemptCount,
    ruleCount: runnableRules.length,
    candidateCount: snapshots.reduce(
      (sum, snapshot) =>
        sum + (snapshot.byBenchmark || []).reduce((acc, b) => acc + (b.candidates || []).length, 0),
      0
    ),
    ready: snapshots.some((snapshot) => snapshot.ready),
    isTest,
    classificationStatus: normalizedConfig.rules.some(
      (rule) => rule.runtimeConfig?.classificationStatus === 'classification_expired'
    )
      ? 'classification_expired'
      : normalizedConfig.rules.some((rule) => rule.runtimeConfig?.classificationStatus === 'stale')
        ? 'stale'
        : normalizedConfig.rules.some((rule) => rule.runtimeConfig?.classificationStatus === 'pending_classification')
          ? 'pending_classification'
          : 'fresh',
    ruleResults: runnableRules.map((rule) =>
      compactRuleRunResult(
        rule,
        snapshots.find((snapshot) => snapshot.ruleId === rule.id)
      )
    )
  };
  const ruleResults = summary.ruleResults;
  const enabledRuleCount = normalizedConfig.rules.filter((rule) => rule.enabled).length;
  const failedRuleCount = ruleResults.filter((result) => result.runtimeStatus === 'failed' || result.status === 'failed').length;
  const successRuleCount = Math.max(0, ruleResults.length - failedRuleCount);
  const notTriggeredRuleCount = ruleResults.filter((result) => result.status === 'not_triggered').length;
  const scheduleEnabled = String(env.SWITCH_SCHEDULE_STATUS || 'enabled').trim() !== 'disabled';
  Object.assign(summary, {
    status: failedRuleCount === 0 ? 'success' : successRuleCount > 0 ? 'partial' : 'failed',
    enabledRuleCount,
    successRuleCount,
    failedRuleCount,
    triggeredSignalCount: allTriggers.length,
    notTriggeredRuleCount,
    nextScheduledAt: getNextSwitchScheduledAt(Date.now(), scheduleEnabled),
    scheduleStatus: scheduleEnabled ? 'enabled' : 'disabled',
    notificationStatus: getSwitchNotificationStatus(settings, clientId),
    stale: false
  });
  if (persistRun && !isTest) {
    const runRecord = { ...summary, clientId, reason, snapshot: snapshotToStore };
    await writeJson(env, switchRunKey(clientId, summary.runId), runRecord, {
      expirationTtl: 30 * 24 * 60 * 60
    });
    await writeJson(env, switchRunResultKey(clientId), runRecord, { expirationTtl: 30 * 24 * 60 * 60 });
  }
  return summary;
}

export async function handleSwitchTestNav(request, env) {
  const origin = readOrigin(request);
  try {
    const result = await testGetNav513100(env);
    return jsonResponse(result, { status: result.success ? 200 : 400, origin });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500, origin }
    );
  }
}

export async function runSwitchStrategyTick(
  env,
  scheduledMs,
  { reason = 'switch-cron', runClientDetection } = {}
) {
  const scheduledIso = new Date(scheduledMs).toISOString();
  console.log(
    '[notify] runSwitchStrategyTick enter',
    JSON.stringify({
      reason,
      scheduledMs,
      scheduledIso
    })
  );
  if (!isInTradingSession(new Date(scheduledMs))) {
    console.log(
      '[notify] runSwitchStrategyTick skip: outside trading session',
      JSON.stringify({
        reason,
        scheduledIso
      })
    );
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
    if (config && hasEnabledSwitchRule(config)) {
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
      await trackAnalyticsEvent(env, 'switch_worker_run', {
        clientId,
        reason,
        triggered: summary?.triggered || 0,
        pushed: summary?.pushed || 0,
        deliveryAttempts: summary?.deliveryAttempts || 0,
        ruleCount: summary?.ruleCount || 0,
        candidateCount: summary?.candidateCount || 0,
        ready: Boolean(summary?.ready),
        skipped: summary?.skipped || ''
      });
    } catch (error) {
      console.log(
        '[notify] switch client run failed',
        JSON.stringify({
          clientId,
          reason,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }
}
