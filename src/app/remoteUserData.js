import { loadCloudSession } from './authSession.js';

const DEFAULT_USER_DATA_BASE = 'https://api.freebacktrack.tech/api/user-data';
export const REMOTE_DATA_KEYS = Object.freeze([
  'aiDcaAccountAllocationSettings', 'aiDcaAccumulationState', 'aiDcaDcaState', 'aiDcaDcaStore',
  'aiDcaFundHoldingsLedger', 'aiDcaFundHoldingsState', 'aiDcaHoldingAlerts', 'aiDcaHomeDashboardState',
  'aiDcaMarketAlerts', 'aiDcaNotifyClientConfig', 'aiDcaPlanState', 'aiDcaPlanStore',
  'aiDcaPositionSnapshot', 'aiDcaSellPlanStore', 'aiDcaSwitchStrategyPrefs',
  'aiDcaSwitchStrategyWorkerConfig', 'aiDcaTradeLedger', 'aiDcaWebNotifyConfig',
  'aiDcaWorkspacePrefs', 'markets:watchlist:v1'
]);

function baseUrl() {
  const origin = String(import.meta.env?.VITE_USER_DATA_API_ORIGIN || import.meta.env?.VITE_API_ORIGIN || '').trim();
  if (!origin) return DEFAULT_USER_DATA_BASE;
  if (origin.endsWith('/api/user-data')) return origin.replace(/\/$/, '');
  return `${origin.replace(/\/$/, '')}/api/user-data`;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { message: text }; }
}

export async function requestRemoteUserData(path = '', { method = 'GET', token = '', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${String(token).trim()}`;
  const response = await fetch(`${baseUrl()}${path}`, {
    method, headers, credentials: 'include', cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `远端数据请求失败：HTTP ${response.status}`);
    error.status = response.status;
    error.code = data?.code || '';
    throw error;
  }
  return data;
}

export async function exchangeRemoteSession(session = loadCloudSession()) {
  const token = String(session?.accessToken || '').trim();
  return token ? requestRemoteUserData('/session/exchange', { method: 'POST', token }) : null;
}
export function loadRemoteBootstrap({ token = '' } = {}) { return requestRemoteUserData('/bootstrap', { token }); }
export function writeRemoteRecords(records, { token = '', mutationId = '', mode = 'write' } = {}) {
  return requestRemoteUserData('/records', { method: 'PUT', token, body: {
    mode, mutationId: String(mutationId || '').trim() || undefined,
    records: Array.isArray(records) ? records : []
  }});
}
export function importLegacyRemoteRecords(records, options = {}) {
  return writeRemoteRecords(records, { ...options, mode: 'legacy-import' });
}
export async function logoutRemoteSession() {
  try { await requestRemoteUserData('/session/logout', { method: 'POST' }); } catch { /* best effort */ }
}
