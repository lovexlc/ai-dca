// 场内切换策略（worker 驱动）的前端同步封装。
// 与 notifySync.js 公用同一份 `aiDcaNotifyClientConfig` 身份：client secret 以
// `x-notify-client-secret` 头传递，clientId 在 query string。
//
// 所有 helper 都是线上 worker 请求；本地仅用 localStorage 做备份（仅用于设备离线
// 的预填填能力与加载体验）。

import { readNotifyAccountUsername, readNotifyClientConfig } from './notifySync.js';
import { apiUrl } from './apiBase.js';

const NOTIFY_ENDPOINT = '/api/notify';
const NOTIFY_CLIENT_SECRET_HEADER = 'x-notify-client-secret';
const NOTIFY_ACCOUNT_USERNAME_HEADER = 'x-notify-account-username';
const LOCAL_CACHE_KEY = 'aiDcaSwitchStrategyWorkerConfig';
const FUND_CODE_PATTERN = /^\d{6}$/;
const MAX_SWITCH_RULES = 12;

// 与页面 SwitchStrategyExperience 的 DEFAULT_PREFS 保持同名及同默认。
const DEFAULT_INTRA_SELL_LOWER_PCT = 1; // 规则 A
const DEFAULT_INTRA_BUY_OTHER_PCT = 3;  // 规则 B
const DEFAULT_OTC_PREMIUM_THRESHOLD_PCT = 8;
const DEFAULT_OTC_MIN_INTRA_PREMIUM_LOW = 1;
const DEFAULT_OTC_MIN_INTRA_PREMIUM_HIGH = 2;
const DEFAULT_ARB_TARGET_PCT = 2;
const DEFAULT_HOLDING_CONDITION = 'held-only';
const DEFAULT_TRIGGER_RULE = 'ab';
const HOLDING_CONDITIONS = new Set(['held-only', 'held-when-available', 'unheld-only', 'all']);
const TRIGGER_RULES = new Set(['ab', 'a', 'b', 'custom']);

function defaultSwitchRuleName(index = 0) {
  return index === 0 ? '默认规则' : `规则 ${index + 1}`;
}

function sanitizeRuleId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9:_-]{1,64}$/.test(id) ? id : '';
}

export function buildSwitchRuleId(prefix = 'rule') {
  const safePrefix = String(prefix || 'rule').replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 24) || 'rule';
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${safePrefix}-${timePart}-${randomPart}`;
}

function serializeRule(rule = {}) {
  return {
    id: rule.id,
    name: rule.name,
    enabled: Boolean(rule.enabled),
    benchmarkCodes: Array.isArray(rule.benchmarkCodes) ? rule.benchmarkCodes : [],
    enabledCodes: Array.isArray(rule.enabledCodes) ? rule.enabledCodes : [],
    premiumClass: rule.premiumClass || {},
    arbTargetPct: rule.arbTargetPct,
    intraSellLowerPct: rule.intraSellLowerPct,
    intraBuyOtherPct: rule.intraBuyOtherPct,
    otcPremiumThresholdPct: rule.otcPremiumThresholdPct,
    otcMinIntraPremiumLow: rule.otcMinIntraPremiumLow,
    otcMinIntraPremiumHigh: rule.otcMinIntraPremiumHigh,
    holdingCondition: rule.holdingCondition,
    triggerRule: rule.triggerRule
  };
}

export function normalizeSwitchRuleShape(input = {}, index = 0, { defaultEnabled = true, readEnabled = true } = {}) {
  const rawBenchmarks = Array.isArray(input?.benchmarkCodes)
    ? input.benchmarkCodes
    : (input?.benchmarkCode ? [input.benchmarkCode] : []);
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
    : Array.isArray(input?.candidateCodes) ? input.candidateCodes : [];
  const enabledCodes = [];
  for (const raw of enabledCodesRaw) {
    const code = sanitizeFundCode(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    enabledCodes.push(code);
    if (enabledCodes.length >= 20) break;
  }
  const premiumClass = {};
  const rawClass = (input && typeof input.premiumClass === 'object' && input.premiumClass) ? input.premiumClass : {};
  const validCodes = new Set([...benchmarkCodes, ...enabledCodes]);
  for (const [code, value] of Object.entries(rawClass)) {
    const c = sanitizeFundCode(code);
    if (!c || !validCodes.has(c)) continue;
    const v = String(value || '').trim().toUpperCase();
    if (v === 'H' || v === 'L') premiumClass[c] = v;
  }
  const rawName = String(input?.name || input?.ruleName || '').trim();
  const rawEnabled = readEnabled ? input?.enabled : undefined;
  return {
    id: sanitizeRuleId(input?.id || input?.ruleId) || `rule-${index + 1}`,
    name: (rawName || defaultSwitchRuleName(index)).slice(0, 40),
    enabled: rawEnabled === undefined ? Boolean(defaultEnabled) : Boolean(rawEnabled),
    benchmarkCodes,
    enabledCodes,
    premiumClass,
    arbTargetPct: pickPercent(input?.arbTargetPct, DEFAULT_ARB_TARGET_PCT),
    intraSellLowerPct: pickPercent(input?.intraSellLowerPct, DEFAULT_INTRA_SELL_LOWER_PCT),
    intraBuyOtherPct: pickPercent(input?.intraBuyOtherPct, DEFAULT_INTRA_BUY_OTHER_PCT),
    otcPremiumThresholdPct: pickPercent(input?.otcPremiumThresholdPct, DEFAULT_OTC_PREMIUM_THRESHOLD_PCT),
    otcMinIntraPremiumLow: pickPercent(input?.otcMinIntraPremiumLow, DEFAULT_OTC_MIN_INTRA_PREMIUM_LOW),
    otcMinIntraPremiumHigh: pickPercent(input?.otcMinIntraPremiumHigh, DEFAULT_OTC_MIN_INTRA_PREMIUM_HIGH),
    holdingCondition: pickEnum(input?.holdingCondition, HOLDING_CONDITIONS, DEFAULT_HOLDING_CONDITION),
    triggerRule: pickEnum(input?.triggerRule, TRIGGER_RULES, DEFAULT_TRIGGER_RULE)
  };
}

export function buildDefaultSwitchConfig() {
  const defaultRule = normalizeSwitchRuleShape({
    id: 'rule-1',
    name: '默认规则'
  }, 0);
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
    arbTargetPct: defaultRule.arbTargetPct,
    intraSellLowerPct: defaultRule.intraSellLowerPct,
    intraBuyOtherPct: defaultRule.intraBuyOtherPct,
    otcPremiumThresholdPct: defaultRule.otcPremiumThresholdPct,
    otcMinIntraPremiumLow: defaultRule.otcMinIntraPremiumLow,
    otcMinIntraPremiumHigh: defaultRule.otcMinIntraPremiumHigh,
    holdingCondition: defaultRule.holdingCondition,
    triggerRule: defaultRule.triggerRule,
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

function pickEnum(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

export function normalizeSwitchConfigShape(input = {}) {
  const rawRules = Array.isArray(input?.rules) ? input.rules : [];
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
  } else {
    const legacyRule = normalizeSwitchRuleShape({
      ...input,
      id: input?.ruleId || 'rule-1',
      name: input?.ruleName || input?.name || '默认规则'
    }, 0, { defaultEnabled: true, readEnabled: false });
    rules.push(legacyRule);
    usedIds.add(legacyRule.id);
  }
  if (!rules.length) rules.push(normalizeSwitchRuleShape({ id: 'rule-1', name: '默认规则' }, 0));
  const requestedActiveId = sanitizeRuleId(input?.activeRuleId);
  const activeRule = rules.find((rule) => rule.id === requestedActiveId) || rules[0];
  return {
    enabled: Boolean(input?.enabled),
    activeRuleId: activeRule.id,
    rules,
    ruleEnabled: activeRule.enabled,
    ruleName: activeRule.name,
    benchmarkCodes: activeRule.benchmarkCodes,
    enabledCodes: activeRule.enabledCodes,
    premiumClass: activeRule.premiumClass,
    arbTargetPct: activeRule.arbTargetPct,
    intraSellLowerPct: activeRule.intraSellLowerPct,
    intraBuyOtherPct: activeRule.intraBuyOtherPct,
    otcPremiumThresholdPct: activeRule.otcPremiumThresholdPct,
    otcMinIntraPremiumLow: activeRule.otcMinIntraPremiumLow,
    otcMinIntraPremiumHigh: activeRule.otcMinIntraPremiumHigh,
    holdingCondition: activeRule.holdingCondition,
    triggerRule: activeRule.triggerRule,
    clientLabel: String(input?.clientLabel || '').trim().slice(0, 120),
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
      benchmarkCodes: (rule.benchmarkCodes || []).slice().sort(),
      enabledCodes: (rule.enabledCodes || []).slice().sort(),
      premiumClass: Object.entries(rule.premiumClass || {}).sort(([a], [b]) => a.localeCompare(b)),
      arbTargetPct: rule.arbTargetPct,
      intraSellLowerPct: rule.intraSellLowerPct,
      intraBuyOtherPct: rule.intraBuyOtherPct,
      otcPremiumThresholdPct: rule.otcPremiumThresholdPct,
      otcMinIntraPremiumLow: rule.otcMinIntraPremiumLow,
      otcMinIntraPremiumHigh: rule.otcMinIntraPremiumHigh,
      holdingCondition: rule.holdingCondition,
      triggerRule: rule.triggerRule
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
  const baseRule = normalizeSwitchRuleShape({
    id: buildSwitchRuleId(),
    name: defaultSwitchRuleName(normalized.rules.length),
    enabled: true,
    arbTargetPct: normalized.arbTargetPct,
    intraSellLowerPct: normalized.intraSellLowerPct,
    intraBuyOtherPct: normalized.intraBuyOtherPct,
    otcPremiumThresholdPct: normalized.otcPremiumThresholdPct,
    otcMinIntraPremiumLow: normalized.otcMinIntraPremiumLow,
    otcMinIntraPremiumHigh: normalized.otcMinIntraPremiumHigh,
    holdingCondition: normalized.holdingCondition,
    triggerRule: normalized.triggerRule,
    ...seed
  }, normalized.rules.length);
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
  const copy = normalizeSwitchRuleShape({
    ...source,
    id: buildSwitchRuleId('rule-copy'),
    name: `${source.name || '规则'} 副本`,
    enabled: false
  }, normalized.rules.length);
  return normalizeSwitchConfigShape({
    ...normalized,
    activeRuleId: copy.id,
    rules: [...normalized.rules, copy]
  });
}

export function removeSwitchRule(input = {}, ruleId = '') {
  const normalized = normalizeSwitchConfigShape(input);
  if (normalized.rules.length <= 1) return normalized;
  const targetId = sanitizeRuleId(ruleId) || normalized.activeRuleId;
  const rules = normalized.rules.filter((rule) => rule.id !== targetId);
  const activeRuleId = normalized.activeRuleId === targetId ? (rules[0]?.id || '') : normalized.activeRuleId;
  return normalizeSwitchConfigShape({ ...normalized, activeRuleId, rules });
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
  const response = await fetch(
    buildSwitchUrl(path, { clientId: clientConfig?.notifyClientId || '' }),
    init
  );
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
      arbTargetPct: next.arbTargetPct,
      intraSellLowerPct: next.intraSellLowerPct,
      intraBuyOtherPct: next.intraBuyOtherPct,
      otcPremiumThresholdPct: next.otcPremiumThresholdPct,
      otcMinIntraPremiumLow: next.otcMinIntraPremiumLow,
      otcMinIntraPremiumHigh: next.otcMinIntraPremiumHigh,
      holdingCondition: next.holdingCondition,
      triggerRule: next.triggerRule,
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

export async function loadSwitchDataFromWorker() {
  const [configResult, snapshotResult] = await Promise.allSettled([loadSwitchConfigFromWorker(), loadSwitchSnapshotFromWorker()]);
  return {
    config: configResult.status === 'fulfilled' ? configResult.value : null,
    snapshotPayload: snapshotResult.status === 'fulfilled' ? snapshotResult.value : null,
    workerError: configResult.status === 'rejected' ? configResult.reason : snapshotResult.status === 'rejected' ? snapshotResult.reason : null
  };
}

export async function runSwitchOnce() {
  return await requestSwitch('/switch/run', { method: 'POST' });
}
