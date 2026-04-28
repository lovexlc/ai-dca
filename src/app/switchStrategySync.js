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

export function buildDefaultSwitchConfig() {
  return {
    enabled: false,
    benchmarkCode: '',
    candidateCodes: [],
    thresholds: [1, 8],
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

export function normalizeSwitchConfigShape(input = {}) {
  const benchmarkCode = sanitizeFundCode(input?.benchmarkCode);
  const seen = new Set();
  if (benchmarkCode) seen.add(benchmarkCode);
  const candidateCodes = [];
  for (const raw of Array.isArray(input?.candidateCodes) ? input.candidateCodes : []) {
    const code = sanitizeFundCode(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    candidateCodes.push(code);
    if (candidateCodes.length >= 20) break;
  }
  const thresholdsRaw = Array.isArray(input?.thresholds) ? input.thresholds : [1, 8];
  const thresholds = Array.from(new Set(
    thresholdsRaw
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
  ))
    .sort((left, right) => left - right)
    .slice(0, 4);
  return {
    enabled: Boolean(input?.enabled),
    benchmarkCode,
    candidateCodes,
    thresholds: thresholds.length ? thresholds : [1, 8],
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
      benchmarkCode: next.benchmarkCode,
      candidateCodes: next.candidateCodes,
      thresholds: next.thresholds,
      clientLabel: clientConfig?.notifyClientLabel || ''
    }
  });
  const stored = normalizeSwitchConfigShape(payload?.config || next);
  writeSwitchConfigCache(stored);
  return stored;
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
