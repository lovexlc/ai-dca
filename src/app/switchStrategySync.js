// 场内切换策略（worker 驱动）的前端同步封装。
// 与 notifySync.js 公用同一份 `aiDcaNotifyClientConfig` 身份：client secret 以
// `x-notify-client-secret` 头传递，clientId 在 query string。
//
// 所有 helper 都是线上 worker 请求；本地仅用 localStorage 做备份（仅用于设备离线
// 的预填填能力与加载体验）。

import { readNotifyClientConfig } from './notifySync.js';

const NOTIFY_ENDPOINT = '/api/notify';
const NOTIFY_CLIENT_SECRET_HEADER = 'x-notify-client-secret';
const LOCAL_CACHE_KEY = 'aiDcaSwitchStrategyWorkerConfig';
const FUND_CODE_PATTERN = /^\d{6}$/;

// 与页面 SwitchStrategyExperience 的 DEFAULT_PREFS 保持同名及同默认。
const DEFAULT_INTRA_SELL_LOWER_PCT = 1; // 规则 A
const DEFAULT_INTRA_BUY_OTHER_PCT = 3;  // 规则 B
const DEFAULT_SWITCH_RULE = {
  id: 'rule-default',
  name: '默认规则',
  enabled: true,
  benchmarkCodes: [],
  enabledCodes: [],
  premiumClass: {},
  intraSellLowerPct: DEFAULT_INTRA_SELL_LOWER_PCT,
  intraBuyOtherPct: DEFAULT_INTRA_BUY_OTHER_PCT
};

export function buildDefaultSwitchConfig() {
  return {
    enabled: false,
    benchmarkCodes: [],
    enabledCodes: [],
    // 每只 ETF 的溢价中枢标签：'H' 高溢价 / 'L' 低溢价。
    // 仅对出现在 benchmarkCodes / enabledCodes 中的代码生效。
    premiumClass: {},
    rules: [DEFAULT_SWITCH_RULE],
    intraSellLowerPct: DEFAULT_INTRA_SELL_LOWER_PCT,
    intraBuyOtherPct: DEFAULT_INTRA_BUY_OTHER_PCT,
    clientLabel: '',
    updatedAt: ''
  };
}

function normalizeSwitchRule(rule = {}, index = 0, fallbackSource = {}) {
  const fallback = index === 0
    ? {
        ...DEFAULT_SWITCH_RULE,
        intraSellLowerPct: fallbackSource?.intraSellLowerPct,
        intraBuyOtherPct: fallbackSource?.intraBuyOtherPct
      }
    : {
        ...DEFAULT_SWITCH_RULE,
        id: `rule-${index + 1}`,
        name: `规则 ${index + 1}`
      };
  return {
    id: String(rule?.id || fallback.id || `rule-${index + 1}`).trim().slice(0, 64),
    name: String(rule?.name || fallback.name || `规则 ${index + 1}`).trim().slice(0, 40),
    enabled: rule?.enabled !== false,
    benchmarkCodes: normalizeCodeList(rule?.benchmarkCodes, fallback.benchmarkCodes || fallbackSource?.benchmarkCodes),
    enabledCodes: normalizeCodeList(rule?.enabledCodes, fallback.enabledCodes || fallbackSource?.enabledCodes),
    premiumClass: normalizePremiumClass(rule?.premiumClass || fallback.premiumClass || fallbackSource?.premiumClass),
    intraSellLowerPct: pickPercent(rule?.intraSellLowerPct, fallback.intraSellLowerPct),
    intraBuyOtherPct: pickPercent(rule?.intraBuyOtherPct, fallback.intraBuyOtherPct)
  };
}

function normalizeSwitchRules(input, fallbackSource = {}) {
  const raw = Array.isArray(input) ? input : [];
  const source = raw.length ? raw.map((rule, index) => (
    index === 0 ? {
      ...rule,
      benchmarkCodes: rule?.benchmarkCodes ?? fallbackSource?.benchmarkCodes,
      enabledCodes: rule?.enabledCodes ?? fallbackSource?.enabledCodes,
      premiumClass: rule?.premiumClass ?? fallbackSource?.premiumClass
    } : rule
  )) : [{
    ...DEFAULT_SWITCH_RULE,
    benchmarkCodes: fallbackSource?.benchmarkCodes,
    enabledCodes: fallbackSource?.enabledCodes,
    premiumClass: fallbackSource?.premiumClass,
    intraSellLowerPct: fallbackSource?.intraSellLowerPct,
    intraBuyOtherPct: fallbackSource?.intraBuyOtherPct
  }];
  const seen = new Set();
  const rules = [];
  for (const item of source) {
    const rule = normalizeSwitchRule(item, rules.length, fallbackSource);
    if (!rule.id || seen.has(rule.id)) rule.id = `rule-${rules.length + 1}`;
    seen.add(rule.id);
    rules.push(rule);
    if (rules.length >= 10) break;
  }
  return rules.length ? rules : [normalizeSwitchRule(DEFAULT_SWITCH_RULE, 0, fallbackSource)];
}

function normalizeCodeList(input, fallback = []) {
  const raw = Array.isArray(input) ? input : fallback;
  const seen = new Set();
  const codes = [];
  for (const item of raw || []) {
    const code = sanitizeFundCode(item);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (codes.length >= 20) break;
  }
  return codes;
}

function normalizePremiumClass(input = {}) {
  const rawClass = input && typeof input === 'object' ? input : {};
  const premiumClass = {};
  for (const [code, value] of Object.entries(rawClass)) {
    const c = sanitizeFundCode(code);
    const v = String(value || '').trim().toUpperCase();
    if (c && (v === 'H' || v === 'L')) premiumClass[c] = v;
  }
  return premiumClass;
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
  // 兼容旧格式：input.benchmarkCode (string) → [benchmarkCode]。
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
  // premiumClass：仅保留出现在 benchmarkCodes 或 enabledCodes 中的代码，且值为 'H' | 'L'。
  const premiumClass = normalizePremiumClass(input?.premiumClass);
  const rules = normalizeSwitchRules(input?.rules, input);
  const primaryRule = rules[0] || DEFAULT_SWITCH_RULE;
  return {
    enabled: Boolean(input?.enabled),
    benchmarkCodes,
    enabledCodes,
    premiumClass,
    rules,
    intraSellLowerPct: pickPercent(input?.intraSellLowerPct, primaryRule.intraSellLowerPct),
    intraBuyOtherPct: pickPercent(input?.intraBuyOtherPct, primaryRule.intraBuyOtherPct),
    clientLabel: String(input?.clientLabel || '').trim().slice(0, 120),
    updatedAt: String(input?.updatedAt || '').trim()
  };
}

function sanitizeFundCode(value) {
  const code = String(value || '').trim();
  return FUND_CODE_PATTERN.test(code) ? code : '';
}

function buildSwitchUrl(path, query = {}) {
  const origin = typeof window === 'undefined' ? 'https://localhost' : window.location.origin;
  const url = new URL(`${NOTIFY_ENDPOINT}${path}`, origin);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return `${url.pathname}${url.search}`;
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
      benchmarkCodes: next.benchmarkCodes,
      enabledCodes: next.enabledCodes,
      premiumClass: next.premiumClass,
      rules: next.rules,
      intraSellLowerPct: next.intraSellLowerPct,
      intraBuyOtherPct: next.intraBuyOtherPct,
      clientLabel: clientConfig?.notifyClientLabel || ''
    }
  });
  const stored = normalizeSwitchConfigShape(payload?.config || next);
  writeSwitchConfigCache(stored);
  // 返回充足元数据供 UI notice 使用（clientId / benchmarks / 候选数量）。
  const benchSet = new Set(stored.benchmarkCodes || []);
  return {
    config: stored,
    clientId: payload?.clientId || '',
    benchmarkCodes: stored.benchmarkCodes,
    candidateCount: (stored.enabledCodes || []).filter((c) => c && !benchSet.has(c)).length
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
