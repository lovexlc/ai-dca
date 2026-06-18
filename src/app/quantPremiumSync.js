import { apiUrl } from './apiBase.js';
import { readNotifyClientConfig } from './notifySync.js';

const NOTIFY_ENDPOINT = '/api/notify';
const NOTIFY_CLIENT_SECRET_HEADER = 'x-notify-client-secret';
const FUND_CODE_PATTERN = /^\d{6}$/;

export const DEFAULT_QUANT_PREMIUM_CONFIG = {
  id: 'default',
  enabled: false,
  name: '纳指 ETF 溢价差',
  highCodes: ['159513'],
  lowCodes: ['513100', '159501'],
  activeSide: 'all',
  intraSellLowerPct: 1,
  intraBuyOtherPct: 3,
  notifyEnabled: true,
  paperEnabled: true,
  liveSignalEnabled: false,
  backtestGate: {
    status: 'none',
    latestRunId: '',
    approvedAt: '',
    approvedFingerprint: '',
    summary: null
  },
  updatedAt: ''
};

function sanitizeFundCode(value = '') {
  const code = String(value || '').trim();
  return FUND_CODE_PATTERN.test(code) ? code : '';
}

export function parseQuantPremiumCodes(value) {
  const rawList = Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,，、;；|]+/);
  const seen = new Set();
  const list = [];
  for (const raw of rawList) {
    const code = sanitizeFundCode(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    list.push(code);
    if (list.length >= 20) break;
  }
  return list;
}

export function quantPremiumCodesToText(codes = []) {
  return parseQuantPremiumCodes(codes).join(' ');
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

export function normalizeQuantPremiumConfigShape(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const highCodes = parseQuantPremiumCodes(source.highCodes ?? DEFAULT_QUANT_PREMIUM_CONFIG.highCodes);
  const lowCodes = parseQuantPremiumCodes(source.lowCodes ?? DEFAULT_QUANT_PREMIUM_CONFIG.lowCodes)
    .filter((code) => !highCodes.includes(code));
  const backtestGate = source.backtestGate && typeof source.backtestGate === 'object'
    ? {
      status: ['none', 'passed', 'failed', 'stale'].includes(source.backtestGate.status) ? source.backtestGate.status : 'none',
      latestRunId: String(source.backtestGate.latestRunId || ''),
      approvedAt: String(source.backtestGate.approvedAt || ''),
      approvedFingerprint: String(source.backtestGate.approvedFingerprint || ''),
      summary: source.backtestGate.summary && typeof source.backtestGate.summary === 'object' ? source.backtestGate.summary : null,
      updatedAt: String(source.backtestGate.updatedAt || '')
    }
    : { ...DEFAULT_QUANT_PREMIUM_CONFIG.backtestGate };
  return {
    id: String(source.id || source.strategyId || DEFAULT_QUANT_PREMIUM_CONFIG.id).trim() || DEFAULT_QUANT_PREMIUM_CONFIG.id,
    enabled: Boolean(source.enabled),
    name: String(source.name || DEFAULT_QUANT_PREMIUM_CONFIG.name).trim().slice(0, 60),
    highCodes,
    lowCodes,
    activeSide: normalizeActiveSide(source.activeSide),
    intraSellLowerPct: pickPercent(source.intraSellLowerPct, DEFAULT_QUANT_PREMIUM_CONFIG.intraSellLowerPct),
    intraBuyOtherPct: pickPercent(source.intraBuyOtherPct, DEFAULT_QUANT_PREMIUM_CONFIG.intraBuyOtherPct),
    notifyEnabled: source.notifyEnabled === undefined ? true : Boolean(source.notifyEnabled),
    paperEnabled: source.paperEnabled === undefined ? true : Boolean(source.paperEnabled),
    liveSignalEnabled: Boolean(source.liveSignalEnabled),
    backtestGate,
    stage: String(source.stage || '').trim(),
    createdAt: String(source.createdAt || '').trim(),
    updatedAt: String(source.updatedAt || '').trim()
  };
}

function normalizeStrategyList(input = []) {
  const list = Array.isArray(input) ? input : [];
  const normalized = list.map((item) => normalizeQuantPremiumConfigShape(item));
  return normalized.length ? normalized : [normalizeQuantPremiumConfigShape(DEFAULT_QUANT_PREMIUM_CONFIG)];
}

function buildQuantUrl(path, query = {}) {
  return apiUrl(`${NOTIFY_ENDPOINT}/quant/premium${path}`, query);
}

async function readJsonResponse(response) {
  const rawText = await response.text();
  if (!rawText) return {};
  try {
    return JSON.parse(rawText);
  } catch {
    return { error: rawText };
  }
}

async function requestQuantPremium(path, { method = 'GET', body = null } = {}) {
  const clientConfig = readNotifyClientConfig();
  const headers = new Headers({ 'content-type': 'application/json' });
  const secret = String(clientConfig?.notifyClientSecret || '').trim();
  if (secret) headers.set(NOTIFY_CLIENT_SECRET_HEADER, secret);
  const init = { method, headers };
  if (body !== null && body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await fetch(
    buildQuantUrl(path, { clientId: clientConfig?.notifyClientId || '' }),
    init
  );
  const payload = await readJsonResponse(response);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `量化溢价差请求失败：状态 ${response.status}`);
  }
  return payload;
}

function withStrategyQuery(strategyId = '') {
  const id = String(strategyId || '').trim();
  return id ? { strategyId: id } : {};
}

export async function loadQuantPremiumStudioFromWorker(strategyId = '') {
  const payload = await requestQuantPremium(`/studio${buildQueryString(withStrategyQuery(strategyId))}`, { method: 'GET' });
  return payload || null;
}

export async function loadQuantPremiumConfigFromWorker() {
  const payload = await requestQuantPremium('/config', { method: 'GET' });
  return normalizeQuantPremiumConfigShape(payload?.config || DEFAULT_QUANT_PREMIUM_CONFIG);
}

export async function loadQuantPremiumStrategiesFromWorker() {
  try {
    const payload = await requestQuantPremium('/strategies', { method: 'GET' });
    return normalizeStrategyList(payload?.strategies);
  } catch {
    return [await loadQuantPremiumConfigFromWorker()];
  }
}

export async function saveQuantPremiumStrategyToWorker(strategy) {
  const clientConfig = readNotifyClientConfig();
  const next = normalizeQuantPremiumConfigShape(strategy);
  const path = next.id && next.id !== 'default'
    ? `/strategies/${encodeURIComponent(next.id)}`
    : '/strategies';
  const payload = await requestQuantPremium(path, {
    method: 'POST',
    body: {
      strategy: next,
      clientLabel: clientConfig?.notifyClientLabel || ''
    }
  });
  return {
    strategy: normalizeQuantPremiumConfigShape(payload?.strategy || next),
    strategies: normalizeStrategyList(payload?.strategies || [payload?.strategy || next])
  };
}

export async function deleteQuantPremiumStrategyInWorker(strategyId) {
  const payload = await requestQuantPremium(`/strategies/${encodeURIComponent(strategyId)}`, { method: 'DELETE' });
  return normalizeStrategyList(payload?.strategies);
}

export async function saveQuantPremiumConfigToWorker(config) {
  const clientConfig = readNotifyClientConfig();
  const next = normalizeQuantPremiumConfigShape(config);
  const payload = await requestQuantPremium('/config', {
    method: 'POST',
    body: {
      config: next,
      clientLabel: clientConfig?.notifyClientLabel || ''
    }
  });
  return normalizeQuantPremiumConfigShape(payload?.config || next);
}

export async function loadQuantPremiumSnapshotFromWorker() {
  const payload = await requestQuantPremium('/snapshot', { method: 'GET' });
  return {
    snapshot: payload?.snapshot || null,
    config: normalizeQuantPremiumConfigShape(payload?.config || DEFAULT_QUANT_PREMIUM_CONFIG)
  };
}

export async function loadQuantPremiumStrategySnapshotFromWorker(strategyId = '') {
  const payload = await requestQuantPremium(`/snapshot${buildQueryString(withStrategyQuery(strategyId))}`, { method: 'GET' });
  return {
    snapshot: payload?.snapshot || null,
    config: normalizeQuantPremiumConfigShape(payload?.config || DEFAULT_QUANT_PREMIUM_CONFIG)
  };
}

function buildQueryString(query = {}) {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}

export async function loadQuantPremiumPaperStateFromWorker(strategyId = '') {
  const payload = await requestQuantPremium(`/paper${buildQueryString(withStrategyQuery(strategyId))}`, { method: 'GET' });
  return payload?.state || null;
}

export async function adjustQuantPremiumCashInWorker(amount, note = '', strategyId = '') {
  const payload = await requestQuantPremium(`/paper${buildQueryString(withStrategyQuery(strategyId))}`, {
    method: 'POST',
    body: {
      adjustment: {
        amount: Number(amount) || 0,
        note
      }
    }
  });
  return {
    state: payload?.state || null,
    cashEvent: payload?.cashEvent || null
  };
}

export async function resetQuantPremiumPaperStateInWorker(state = null, strategyId = '') {
  const body = state && typeof state === 'object'
    ? { reset: true, state }
    : { reset: true };
  const payload = await requestQuantPremium(`/paper${buildQueryString(withStrategyQuery(strategyId))}`, {
    method: 'POST',
    body
  });
  return payload?.state || null;
}

export async function runQuantPremiumOnce(strategyId = '') {
  const id = String(strategyId || '').trim();
  if (!id) {
    return await requestQuantPremium('/run', { method: 'POST' });
  }
  return await requestQuantPremium(`/strategies/${encodeURIComponent(id)}/paper/run-once`, { method: 'POST' });
}

export async function runQuantPremiumBacktestInWorker(strategyId, options = {}) {
  const payload = await requestQuantPremium(`/strategies/${encodeURIComponent(strategyId)}/backtests`, {
    method: 'POST',
    body: options
  });
  return payload?.result || null;
}

export async function loadQuantPremiumBacktestLatestFromWorker(strategyId) {
  const payload = await requestQuantPremium(`/strategies/${encodeURIComponent(strategyId)}/backtests`, { method: 'GET' });
  return {
    result: payload?.result || null,
    gate: payload?.gate || null
  };
}

export async function approveQuantPremiumBacktestInWorker(strategyId, runId = '', { enableLiveSignal = true } = {}) {
  const payload = await requestQuantPremium(`/strategies/${encodeURIComponent(strategyId)}/approve`, {
    method: 'POST',
    body: {
      runId,
      enableLiveSignal
    }
  });
  return {
    strategy: normalizeQuantPremiumConfigShape(payload?.strategy || {}),
    strategies: normalizeStrategyList(payload?.strategies || [payload?.strategy]),
    gate: payload?.gate || null
  };
}
