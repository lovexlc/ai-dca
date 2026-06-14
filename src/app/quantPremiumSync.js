import { apiUrl } from './apiBase.js';
import { readNotifyClientConfig } from './notifySync.js';

const NOTIFY_ENDPOINT = '/api/notify';
const NOTIFY_CLIENT_SECRET_HEADER = 'x-notify-client-secret';
const FUND_CODE_PATTERN = /^\d{6}$/;

export const DEFAULT_QUANT_PREMIUM_CONFIG = {
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

export async function loadQuantPremiumConfigFromWorker() {
  const payload = await requestQuantPremium('/config', { method: 'GET' });
  return normalizeQuantPremiumConfigShape(payload?.config || DEFAULT_QUANT_PREMIUM_CONFIG);
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

export async function loadQuantPremiumPaperStateFromWorker() {
  const payload = await requestQuantPremium('/paper', { method: 'GET' });
  return payload?.state || null;
}

export async function adjustQuantPremiumCashInWorker(amount, note = '') {
  const payload = await requestQuantPremium('/paper', {
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

export async function resetQuantPremiumPaperStateInWorker(state = null) {
  const body = state && typeof state === 'object'
    ? { reset: true, state }
    : { reset: true };
  const payload = await requestQuantPremium('/paper', {
    method: 'POST',
    body
  });
  return payload?.state || null;
}

export async function runQuantPremiumOnce() {
  return await requestQuantPremium('/run', { method: 'POST' });
}
