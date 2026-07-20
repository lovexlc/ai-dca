// 场内切换策略（worker 驱动）的前端同步封装。
// 与 notifySync.js 公用同一份 `aiDcaNotifyClientConfig` 身份：client secret 以
// `x-notify-client-secret` 头传递，clientId 在 query string。
//
// 所有 helper 都是线上 worker 请求；本地仅用 localStorage 做备份（仅用于设备离线
// 的预填填能力与加载体验）。

import { readNotifyAccountUsername, readNotifyClientConfig } from './notifySync.js';
import { apiUrl } from './apiBase.js';
import {
  DEFAULT_SWITCH_FEE_CONFIG,
  DEFAULT_SWITCH_HIGH_CODES,
  normalizeFeeConfig,
  normalizeCodeList,
  normalizeRuntimeConfig,
  normalizeSwitchRuleModel
} from './switchRuleModel.js';

const NOTIFY_ENDPOINT = '/api/notify';
const NOTIFY_CLIENT_SECRET_HEADER = 'x-notify-client-secret';
const NOTIFY_ACCOUNT_USERNAME_HEADER = 'x-notify-account-username';
const LOCAL_CACHE_KEY = 'aiDcaSwitchStrategyWorkerConfig';
const FUND_CODE_PATTERN = /^\d{6}$/;
const MAX_SWITCH_RULES = 12;

// 与页面 SwitchStrategyExperience 的 DEFAULT_PREFS 保持同名及同默认。
const DEFAULT_INTRA_SELL_LOWER_PCT = 1; // 规则 A
const DEFAULT_INTRA_BUY_OTHER_PCT = 3; // 规则 B
const DEFAULT_OTC_PREMIUM_THRESHOLD_PCT = 8;
const DEFAULT_OTC_MIN_INTRA_PREMIUM_LOW = 1;
const DEFAULT_OTC_MIN_INTRA_PREMIUM_HIGH = 2;
const DEFAULT_ARB_TARGET_PCT = 2;

function defaultSwitchRuleName(index = 0) {
  return index === 0 ? '默认规则' : `规则 ${index + 1}`;
}

function sanitizeRuleId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9:_-]{1,64}$/.test(id) ? id : '';
}

export function buildSwitchRuleId(prefix = 'rule') {
  const safePrefix =
    String(prefix || 'rule')
      .replace(/[^A-Za-z0-9:_-]/g, '')
      .slice(0, 24) || 'rule';
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${safePrefix}-${timePart}-${randomPart}`;
}

function serializeRule(rule = {}) {
  const model = normalizeSwitchRuleModel(rule);
  const codes = [model.holdingFundCode, ...model.candidateFundCodes];
  const runtimeConfig = normalizeRuntimeConfig(model.runtimeConfig, codes);
  return {
    id: model.id,
    name: model.name,
    enabled: Boolean(model.enabled),
    holdingFundCode: model.holdingFundCode,
    holdingFundName: model.holdingFundName,
    holdingQuantity: model.holdingQuantity,
    thresholdMode: model.thresholdMode,
    thresholdValue: model.thresholdValue,
    backtestRecommendedValue: model.backtestRecommendedValue,
    recommendationStatus: model.recommendationStatus,
    feeConfig: model.feeConfig,
    candidateFundCodes: model.candidateFundCodes,
    runtimeConfig,
    benchmarkCodes: [model.holdingFundCode].filter(Boolean),
    enabledCodes: model.candidateFundCodes,
    premiumClass: runtimeConfig.premiumClass,
    highPremiumCodes: runtimeConfig.highPremiumCodes,
    premiumClassSource: runtimeConfig.premiumClassSource,
    arbTargetPct: rule.arbTargetPct,
    intraSellLowerPct: runtimeConfig.intraSellLowerPct,
    intraBuyOtherPct: runtimeConfig.intraBuyOtherPct,
    otcPremiumThresholdPct: rule.otcPremiumThresholdPct,
    otcMinIntraPremiumLow: rule.otcMinIntraPremiumLow,
    otcMinIntraPremiumHigh: rule.otcMinIntraPremiumHigh,
    lastResult: model.lastResult,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt
  };
}

export function normalizeSwitchRuleShape(
  input = {},
  index = 0,
  { defaultEnabled = true, readEnabled = true } = {}
) {
  const rawBenchmarks = Array.isArray(input?.benchmarkCodes)
    ? input.benchmarkCodes
    : input?.holdingFundCode
      ? [input.holdingFundCode]
      : input?.benchmarkCode
        ? [input.benchmarkCode]
        : [];
  const benchmarkCodes = [];
  const seen = new Set();
  for (const raw of rawBenchmarks) {
    const code = sanitizeFundCode(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    benchmarkCodes.push(code);
    if (benchmarkCodes.length >= 20) break;
  }
  const enabledCodesRaw = Array.isArray(input?.enabledCodes)
    ? input.enabledCodes
    : Array.isArray(input?.candidateFundCodes)
      ? input.candidateFundCodes
      : Array.isArray(input?.candidateCodes)
        ? input.candidateCodes
        : [];
  const enabledCodes = [];
  for (const raw of enabledCodesRaw) {
    const code = sanitizeFundCode(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    enabledCodes.push(code);
    if (enabledCodes.length >= 20) break;
  }
  const premiumClass = {};
  const rawClass =
    input?.runtimeConfig && typeof input.runtimeConfig.premiumClass === 'object'
      ? input.runtimeConfig.premiumClass
      : input && typeof input.premiumClass === 'object' && input.premiumClass
        ? input.premiumClass
        : {};
  const validCodes = new Set([...benchmarkCodes, ...enabledCodes]);
  for (const [code, value] of Object.entries(rawClass)) {
    const c = sanitizeFundCode(code);
    if (!c || !validCodes.has(c)) continue;
    const v = String(value || '')
      .trim()
      .toUpperCase();
    if (v === 'H' || v === 'L') premiumClass[c] = v;
  }
  const rawName = String(input?.name || input?.ruleName || '').trim();
  const rawEnabled = readEnabled ? input?.enabled : undefined;
  const runtimeConfig = normalizeRuntimeConfig(
    {
      ...(input?.runtimeConfig || {}),
      premiumClass,
      highPremiumCodes:
        input?.runtimeConfig?.highPremiumCodes ?? input?.highPremiumCodes,
      holdingFundCode: benchmarkCodes[0] || input?.holdingFundCode,
      intraSellLowerPct: input?.runtimeConfig?.intraSellLowerPct ?? input?.intraSellLowerPct,
      intraBuyOtherPct: input?.runtimeConfig?.intraBuyOtherPct ?? input?.intraBuyOtherPct,
      holdingSideAtRecommendation:
        input?.runtimeConfig?.holdingSideAtRecommendation ||
        (premiumClass[benchmarkCodes[0]] === 'L' ? 'low' : 'high'),
      triggerOperatorAtRecommendation:
        input?.runtimeConfig?.triggerOperatorAtRecommendation ||
        (premiumClass[benchmarkCodes[0]] === 'L' ? 'lte' : 'gte')
    },
    [...benchmarkCodes, ...enabledCodes]
  );
  const model = normalizeSwitchRuleModel(
    {
      ...input,
      holdingFundCode: benchmarkCodes[0] || input?.holdingFundCode,
      candidateFundCodes: enabledCodes,
      runtimeConfig,
      thresholdValue: input?.thresholdValue,
      thresholdMode: input?.thresholdMode
    },
    index
  );
  return {
    id: sanitizeRuleId(input?.id || input?.ruleId) || `rule-${index + 1}`,
    name: (rawName || defaultSwitchRuleName(index)).slice(0, 40),
    enabled: rawEnabled === undefined ? Boolean(defaultEnabled) : Boolean(rawEnabled),
    benchmarkCodes,
    enabledCodes,
    premiumClass: runtimeConfig.premiumClass,
    highPremiumCodes: runtimeConfig.highPremiumCodes,
    premiumClassSource: runtimeConfig.premiumClassSource,
    arbTargetPct: pickPercent(input?.arbTargetPct, DEFAULT_ARB_TARGET_PCT),
    intraSellLowerPct:
      runtimeConfig.intraSellLowerPct || pickPercent(input?.intraSellLowerPct, DEFAULT_INTRA_SELL_LOWER_PCT),
    intraBuyOtherPct:
      runtimeConfig.intraBuyOtherPct || pickPercent(input?.intraBuyOtherPct, DEFAULT_INTRA_BUY_OTHER_PCT),
    otcPremiumThresholdPct: pickPercent(input?.otcPremiumThresholdPct, DEFAULT_OTC_PREMIUM_THRESHOLD_PCT),
    otcMinIntraPremiumLow: pickPercent(input?.otcMinIntraPremiumLow, DEFAULT_OTC_MIN_INTRA_PREMIUM_LOW),
    otcMinIntraPremiumHigh: pickPercent(input?.otcMinIntraPremiumHigh, DEFAULT_OTC_MIN_INTRA_PREMIUM_HIGH),
    holdingFundCode: model.holdingFundCode,
    holdingFundName: String(input?.holdingFundName || '').trim(),
    holdingQuantity: Number.isFinite(Number(input?.holdingQuantity))
      ? Number(input.holdingQuantity)
      : undefined,
    thresholdMode: model.thresholdMode,
    thresholdValue: model.thresholdValue,
    backtestRecommendedValue: model.backtestRecommendedValue,
    recommendationStatus: ['valid', 'fee_changed', 'expired'].includes(input?.recommendationStatus)
      ? input.recommendationStatus
      : 'valid',
    feeConfig: normalizeFeeConfig(input?.feeConfig || DEFAULT_SWITCH_FEE_CONFIG),
    candidateFundCodes: enabledCodes,
    runtimeConfig,
    internalHoldingSide: model.internalHoldingSide,
    triggerOperator: model.triggerOperator,
    lastResult: input?.lastResult && typeof input.lastResult === 'object' ? input.lastResult : null,
    createdAt: String(input?.createdAt || '').trim(),
    updatedAt: String(input?.updatedAt || '').trim()
  };
}

export function buildDefaultSwitchConfig() {
  const defaultRule = normalizeSwitchRuleShape(
    {
      id: 'rule-1',
      name: '默认规则'
    },
    0
  );
  return {
    enabled: false,
    activeRuleId: defaultRule.id,
    rules: [defaultRule],
    ruleEnabled: defaultRule.enabled,
    benchmarkCodes: defaultRule.benchmarkCodes,
    enabledCodes: defaultRule.enabledCodes,
    // 每只 ETF 的溢价中枢标签：'H' 高溢价 / 'L' 低溢价。
    // 仅对出现在当前规则 benchmarkCodes / enabledCodes 中的代码生效。
    premiumClass: defaultRule.premiumClass,
    highPremiumCodes: defaultRule.highPremiumCodes,
    premiumClassSource: defaultRule.premiumClassSource,
    arbTargetPct: defaultRule.arbTargetPct,
    intraSellLowerPct: defaultRule.intraSellLowerPct,
    intraBuyOtherPct: defaultRule.intraBuyOtherPct,
    otcPremiumThresholdPct: defaultRule.otcPremiumThresholdPct,
    otcMinIntraPremiumLow: defaultRule.otcMinIntraPremiumLow,
    otcMinIntraPremiumHigh: defaultRule.otcMinIntraPremiumHigh,
    clientLabel: '',
    updatedAt: ''
  };
}

export function readSwitchConfigCache() {
  if (typeof window === 'undefined') return buildDefaultSwitchConfig();
  try {
    const raw = window.localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return buildDefaultSwitchConfig();
    const parsed = JSON.parse(raw);
    return normalizeSwitchConfigShape(parsed);
  } catch (_error) {
    return buildDefaultSwitchConfig();
  }
}

export function writeSwitchConfigCache(config) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(normalizeSwitchConfigShape(config)));
  } catch (_error) {
    // ignore quota errors
  }
}

function pickPercent(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < -50) return -50;
  if (num > 50) return 50;
  return num;
}

export function normalizeSwitchConfigShape(input = {}) {
  const hasRulesArray = Array.isArray(input?.rules);
  const rawRules = hasRulesArray ? input.rules : [];
  const rules = [];
  const usedIds = new Set();
  if (rawRules.length) {
    for (const rawRule of rawRules.slice(0, MAX_SWITCH_RULES)) {
      const normalizedRule = normalizeSwitchRuleShape(rawRule, rules.length);
      let id = normalizedRule.id;
      if (usedIds.has(id)) id = `${id}-${rules.length + 1}`;
      usedIds.add(id);
      rules.push({ ...normalizedRule, id });
    }
  } else if (!hasRulesArray) {
    const legacyRule = normalizeSwitchRuleShape(
      {
        ...input,
        id: input?.ruleId || 'rule-1',
        name: input?.ruleName || input?.name || '默认规则'
      },
      0,
      { defaultEnabled: true, readEnabled: false }
    );
    rules.push(legacyRule);
    usedIds.add(legacyRule.id);
  }
  const requestedActiveId = sanitizeRuleId(input?.activeRuleId);
  const activeRule = rules.find((rule) => rule.id === requestedActiveId) || rules[0] || null;
  return {
    schemaVersion: 2,
    enabled: Boolean(input?.enabled) && rules.length > 0,
    activeRuleId: activeRule?.id || '',
    rules,
    ruleEnabled: Boolean(activeRule?.enabled),
    ruleName: activeRule?.name || '',
    benchmarkCodes: activeRule?.benchmarkCodes || [],
    enabledCodes: activeRule?.enabledCodes || [],
    premiumClass: activeRule?.premiumClass || {},
    highPremiumCodes: activeRule?.highPremiumCodes || DEFAULT_SWITCH_HIGH_CODES,
    premiumClassSource: activeRule?.premiumClassSource || 'default',
    holdingFundCode: activeRule?.holdingFundCode || '',
    holdingFundName: activeRule?.holdingFundName || '',
    holdingQuantity: activeRule?.holdingQuantity,
    thresholdMode: activeRule?.thresholdMode || 'backtest',
    thresholdValue: activeRule?.thresholdValue,
    backtestRecommendedValue: activeRule?.backtestRecommendedValue,
    recommendationStatus: activeRule?.recommendationStatus || 'valid',
    feeConfig: activeRule?.feeConfig || null,
    candidateFundCodes: activeRule?.candidateFundCodes || [],
    runtimeConfig: activeRule?.runtimeConfig || null,
    arbTargetPct: activeRule?.arbTargetPct,
    intraSellLowerPct: activeRule?.intraSellLowerPct,
    intraBuyOtherPct: activeRule?.intraBuyOtherPct,
    otcPremiumThresholdPct: activeRule?.otcPremiumThresholdPct,
    otcMinIntraPremiumLow: activeRule?.otcMinIntraPremiumLow,
    otcMinIntraPremiumHigh: activeRule?.otcMinIntraPremiumHigh,
    clientLabel: String(input?.clientLabel || '')
      .trim()
      .slice(0, 120),
    updatedAt: String(input?.updatedAt || '').trim()
  };
}

export function buildSwitchConfigSyncKey(input = {}) {
  const normalized = normalizeSwitchConfigShape(input);
  return JSON.stringify({
    enabled: Boolean(normalized.enabled),
    activeRuleId: normalized.activeRuleId,
    rules: normalized.rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: Boolean(rule.enabled),
      holdingFundCode: rule.holdingFundCode,
      thresholdMode: rule.thresholdMode,
      thresholdValue: rule.thresholdValue,
      backtestRecommendedValue: rule.backtestRecommendedValue,
      recommendationStatus: rule.recommendationStatus,
      feeConfig: rule.feeConfig,
      candidateFundCodes: (rule.candidateFundCodes || []).slice().sort(),
      runtimeConfig: rule.runtimeConfig,
      benchmarkCodes: (rule.benchmarkCodes || []).slice().sort(),
      enabledCodes: (rule.enabledCodes || []).slice().sort(),
      premiumClass: Object.entries(rule.premiumClass || {}).sort(([a], [b]) => a.localeCompare(b)),
      highPremiumCodes: (rule.highPremiumCodes || []).slice().sort(),
      premiumClassSource: rule.premiumClassSource,
      arbTargetPct: rule.arbTargetPct,
      intraSellLowerPct: rule.intraSellLowerPct,
      intraBuyOtherPct: rule.intraBuyOtherPct,
      otcPremiumThresholdPct: rule.otcPremiumThresholdPct,
      otcMinIntraPremiumLow: rule.otcMinIntraPremiumLow,
      otcMinIntraPremiumHigh: rule.otcMinIntraPremiumHigh
    }))
  });
}

export function getActiveSwitchRule(input = {}) {
  const normalized = normalizeSwitchConfigShape(input);
  return normalized.rules.find((rule) => rule.id === normalized.activeRuleId) || normalized.rules[0];
}

export function updateActiveSwitchRule(input = {}, patchOrUpdater) {
  const normalized = normalizeSwitchConfigShape(input);
  const rules = normalized.rules.map((rule, index) => {
    if (rule.id !== normalized.activeRuleId) return rule;
    const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(rule) : patchOrUpdater;
    return normalizeSwitchRuleShape({ ...rule, ...(patch || {}) }, index);
  });
  return normalizeSwitchConfigShape({ ...normalized, rules });
}

export function selectSwitchRule(input = {}, ruleId) {
  const normalized = normalizeSwitchConfigShape(input);
  const nextId = sanitizeRuleId(ruleId);
  if (!normalized.rules.some((rule) => rule.id === nextId)) return normalized;
  return normalizeSwitchConfigShape({ ...normalized, activeRuleId: nextId });
}

export function addSwitchRule(input = {}, seed = {}) {
  const normalized = normalizeSwitchConfigShape(input);
  if (normalized.rules.length >= MAX_SWITCH_RULES) return normalized;
  const baseRule = normalizeSwitchRuleShape(
    {
      id: buildSwitchRuleId(),
      name: defaultSwitchRuleName(normalized.rules.length),
      enabled: true,
      arbTargetPct: normalized.arbTargetPct,
      intraSellLowerPct: normalized.intraSellLowerPct,
      intraBuyOtherPct: normalized.intraBuyOtherPct,
      otcPremiumThresholdPct: normalized.otcPremiumThresholdPct,
      otcMinIntraPremiumLow: normalized.otcMinIntraPremiumLow,
      otcMinIntraPremiumHigh: normalized.otcMinIntraPremiumHigh,
      ...seed
    },
    normalized.rules.length
  );
  return normalizeSwitchConfigShape({
    ...normalized,
    activeRuleId: baseRule.id,
    rules: [...normalized.rules, baseRule]
  });
}

export function duplicateSwitchRule(input = {}, sourceRuleId = '') {
  const normalized = normalizeSwitchConfigShape(input);
  if (normalized.rules.length >= MAX_SWITCH_RULES) return normalized;
  const source = normalized.rules.find((rule) => rule.id === sourceRuleId) || getActiveSwitchRule(normalized);
  const copy = normalizeSwitchRuleShape(
    {
      ...source,
      id: buildSwitchRuleId('rule-copy'),
      name: `${source.name || '规则'} 副本`,
      enabled: false
    },
    normalized.rules.length
  );
  return normalizeSwitchConfigShape({
    ...normalized,
    activeRuleId: copy.id,
    rules: [...normalized.rules, copy]
  });
}

export function removeSwitchRule(input = {}, ruleId = '') {
  const normalized = normalizeSwitchConfigShape(input);
  const targetId = sanitizeRuleId(ruleId) || normalized.activeRuleId;
  if (!targetId || !normalized.rules.some((rule) => rule.id === targetId)) return normalized;
  const rules = normalized.rules.filter((rule) => rule.id !== targetId);
  const activeRuleId = rules.some((rule) => rule.id === normalized.activeRuleId)
    ? normalized.activeRuleId
    : rules[0]?.id || '';
  return normalizeSwitchConfigShape({
    ...normalized,
    enabled: rules.length > 0 && normalized.enabled,
    activeRuleId,
    rules
  });
}

function sanitizeFundCode(value) {
  const code = String(value || '').trim();
  return FUND_CODE_PATTERN.test(code) ? code : '';
}

function buildSwitchUrl(path, query = {}) {
  return apiUrl(`${NOTIFY_ENDPOINT}${path}`, query);
}

async function readJsonResponse(response) {
  const rawText = await response.text();
  if (!rawText) return {};
  try {
    return JSON.parse(rawText);
  } catch (_error) {
    return { error: rawText };
  }
}

async function requestSwitch(path, { method = 'GET', body = null } = {}) {
  const clientConfig = readNotifyClientConfig();
  const headers = new Headers({ 'content-type': 'application/json' });
  const secret = String(clientConfig?.notifyClientSecret || '').trim();
  if (secret) headers.set(NOTIFY_CLIENT_SECRET_HEADER, secret);
  const accountUsername = readNotifyAccountUsername();
  if (accountUsername) headers.set(NOTIFY_ACCOUNT_USERNAME_HEADER, accountUsername);
  const init = {
    method,
    headers
  };
  if (body !== null && body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await fetch(buildSwitchUrl(path, { clientId: clientConfig?.notifyClientId || '' }), init);
  const payload = await readJsonResponse(response);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `切换策略请求失败：状态 ${response.status}`);
  }
  return payload;
}

export async function loadSwitchConfigFromWorker() {
  const payload = await requestSwitch('/switch/config', { method: 'GET' });
  const config = normalizeSwitchConfigShape(payload?.config || {});
  writeSwitchConfigCache(config);
  return config;
}

export async function saveSwitchConfigToWorker(config) {
  const clientConfig = readNotifyClientConfig();
  const next = normalizeSwitchConfigShape(config);
  const payload = await requestSwitch('/switch/config', {
    method: 'POST',
    body: {
      enabled: next.enabled,
      activeRuleId: next.activeRuleId,
      rules: next.rules.map(serializeRule),
      benchmarkCodes: next.benchmarkCodes,
      enabledCodes: next.enabledCodes,
      premiumClass: next.premiumClass,
      highPremiumCodes: next.highPremiumCodes,
      arbTargetPct: next.arbTargetPct,
      intraSellLowerPct: next.intraSellLowerPct,
      intraBuyOtherPct: next.intraBuyOtherPct,
      otcPremiumThresholdPct: next.otcPremiumThresholdPct,
      otcMinIntraPremiumLow: next.otcMinIntraPremiumLow,
      otcMinIntraPremiumHigh: next.otcMinIntraPremiumHigh,
      clientLabel: clientConfig?.notifyClientLabel || '',
      accountUsername: readNotifyAccountUsername()
    }
  });
  const stored = normalizeSwitchConfigShape(payload?.config || next);
  writeSwitchConfigCache(stored);
  // 返回充足元数据供 UI notice 使用（clientId / benchmarks / 候选数量）。
  const candidateCount = (stored.rules || []).reduce((acc, rule) => {
    const benchSet = new Set(rule.benchmarkCodes || []);
    return acc + (rule.enabledCodes || []).filter((c) => c && !benchSet.has(c)).length;
  }, 0);
  return {
    config: stored,
    clientId: payload?.clientId || '',
    benchmarkCodes: stored.benchmarkCodes,
    candidateCount,
    ruleCount: stored.rules.length
  };
}

export async function loadSwitchSnapshotFromWorker() {
  const payload = await requestSwitch('/switch/snapshot', { method: 'GET' });
  return {
    snapshot: payload?.snapshot || null,
    config: normalizeSwitchConfigShape(payload?.config || buildDefaultSwitchConfig())
  };
}

export async function runSwitchOnce() {
  return await requestSwitch('/switch/run', { method: 'POST' });
}

export async function generateSwitchRecommendation({
  holdingFundCode,
  holdingFundName = '',
  holdingQuantity,
  feeConfig,
  candidateCodes = [],
  highCodes = DEFAULT_SWITCH_HIGH_CODES,
  backtestParams = {}
} = {}) {
  return requestSwitch('/switch/recommend', {
    method: 'POST',
    body: {
      holdingFundCode: sanitizeFundCode(holdingFundCode),
      holdingFundName: String(holdingFundName || '').trim(),
      holdingQuantity: Number.isFinite(Number(holdingQuantity)) ? Number(holdingQuantity) : undefined,
      feeConfig: normalizeFeeConfig(feeConfig),
      candidateCodes: normalizeCodeList(candidateCodes),
      highCodes: normalizeCodeList(highCodes, { max: 100 }),
      backtestParams
    }
  });
}

export async function runSwitchQuickTest(ruleId, { signal } = {}) {
  const clientConfig = readNotifyClientConfig();
  const headers = new Headers({ 'content-type': 'application/json' });
  const secret = String(clientConfig?.notifyClientSecret || '').trim();
  if (secret) headers.set(NOTIFY_CLIENT_SECRET_HEADER, secret);
  const accountUsername = readNotifyAccountUsername();
  if (accountUsername) headers.set(NOTIFY_ACCOUNT_USERNAME_HEADER, accountUsername);
  const response = await fetch(
    buildSwitchUrl('/switch/test', { clientId: clientConfig?.notifyClientId || '' }),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ruleId: String(ruleId || '').trim(),
        isTest: true,
        testId: buildSwitchRuleId('test')
      }),
      signal
    }
  );
  const payload = await readJsonResponse(response);
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error || `快速测试失败：状态 ${response.status}`);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function loadLatestSwitchRun() {
  return requestSwitch('/switch/runs/latest', { method: 'GET' });
}

export async function loadSwitchRun(runId) {
  return requestSwitch(`/switch/runs/${encodeURIComponent(String(runId || '').trim())}`, { method: 'GET' });
}
