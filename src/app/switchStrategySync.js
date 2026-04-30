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

export function buildDefaultSwitchConfig() {
  return {
    enabled: false,
    benchmarkCodes: [],
    enabledCodes: [],
    // 每只 ETF 的溢价中枢标签：'H' 高溢价 / 'L' 低溢价。
    // 仅对出现在 benchmarkCodes / enabledCodes 中的代码生效。
    premiumClass: {},
    intraSellLowerPct: DEFAULT_INTRA_SELL_LOWER_PCT,
    intraBuyOtherPct: DEFAULT_INTRA_BUY_OTHER_PCT,
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
  const premiumClass = {};
  const rawClass = (input && typeof input.premiumClass === 'object' && input.premiumClass) ? input.premiumClass : {};
  const validCodes = new Set([...benchmarkCodes, ...enabledCodes]);
  for (const [code, value] of Object.entries(rawClass)) {
    const c = sanitizeFundCode(code);
    if (!c || !validCodes.has(c)) continue;
    const v = String(value || '').trim().toUpperCase();
    if (v === 'H' || v === 'L') premiumClass[c] = v;
  }
  return {
    enabled: Boolean(input?.enabled),
    benchmarkCodes,
    enabledCodes,
    premiumClass,
    intraSellLowerPct: pickPercent(input?.intraSellLowerPct, DEFAULT_INTRA_SELL_LOWER_PCT),
    intraBuyOtherPct: pickPercent(input?.intraBuyOtherPct, DEFAULT_INTRA_BUY_OTHER_PCT),
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

// 清理 worker 端该 clientId 的切换策略 KV（config / snapshot / state）。
export async function resetSwitchConfigOnWorker() {
  const payload = await requestSwitch('/switch/config', { method: 'DELETE' });
  // 同步清本地缓存，避免重新加载后又被旧 cache 覆盖。
  writeSwitchConfigCache(buildDefaultSwitchConfig());
  return {
    clientId: payload?.clientId || '',
    clearedKeys: Array.isArray(payload?.clearedKeys) ? payload.clearedKeys : [],
    examinedKeys: Array.isArray(payload?.examinedKeys) ? payload.examinedKeys : []
  };
}
