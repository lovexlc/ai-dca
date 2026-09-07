import { loadCloudSession } from './authSession.js';

const DEFAULT_USER_DATA_BASE = 'https://api.freebacktrack.tech/api/user-data';

export const REMOTE_DATA_KEYS = Object.freeze([
  'aiDcaAccountAllocationSettings',
  'aiDcaAccumulationState',
  'aiDcaDcaState',
  'aiDcaDcaStore',
  'aiDcaFundHoldingsLedger',
  'aiDcaFundHoldingsState',
  'aiDcaHoldingAlerts',
  'aiDcaHomeDashboardState',
  'aiDcaMarketAlerts',
  'aiDcaNotifyClientConfig',
  'aiDcaPlanState',
  'aiDcaPlanStore',
  'aiDcaPositionSnapshot',
  'aiDcaSellPlanStore',
  'aiDcaSwitchStrategyPrefs',
  'aiDcaSwitchStrategyWorkerConfig',
  'aiDcaTradeLedger',
  'aiDcaWebNotifyConfig',
  'aiDcaWorkspacePrefs',
  'markets:watchlist:v1'
]);

function getRemoteDataBase() {
  const configuredOrigin = String(import.meta.env?.VITE_USER_DATA_API_ORIGIN || import.meta.env?.VITE_API_ORIGIN || '').trim();
  if (!configuredOrigin) return DEFAULT_USER_DATA_BASE;
  if (configuredOrigin.endsWith('/api/user-data')) return configuredOrigin.replace(/\/$/, '');
  return `${configuredOrigin.replace(/\/$/, '')}/api/user-data`;
}

function normalizeToken(token = '') {
  return String(token || '').trim();
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function requestRemoteUserData(path = '', { method = 'GET', token = '', body, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const accessToken = normalizeToken(token);
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${getRemoteDataBase()}${path}`, {
    method,
    headers,
    credentials: 'include',
    cache: 'no-store',
    signal,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `远端数据请求失败：HTTP ${response.status}`);
    error.status = response.status;
    error.code = data?.code || '';
    error.data = data;
    throw error;
  }
  return data;
}

export async function loadRemoteSession() {
  try {
    return await requestRemoteUserData('/session');
  } catch (error) {
    if (error?.status === 401) return null;
    throw error;
  }
}

export async function exchangeRemoteSession(session = loadCloudSession()) {
  const token = normalizeToken(session?.accessToken);
  if (!token) return null;
  return requestRemoteUserData('/session/exchange', { method: 'POST', token });
}

export async function loadRemoteBootstrap({ token = '' } = {}) {
  return requestRemoteUserData('/bootstrap', { token });
}

export async function writeRemoteRecords(records, { token = '', mutationId = '', mode = 'write' } = {}) {
  return requestRemoteUserData('/records', {
    method: 'PUT',
    token,
    body: {
      mode,
      mutationId: String(mutationId || '').trim() || undefined,
      records: Array.isArray(records) ? records : []
    }
  });
}

export async function importLegacyRemoteRecords(records, { token = '', mutationId = '' } = {}) {
  return writeRemoteRecords(records, {
    token,
    mutationId,
    mode: 'legacy-import'
  });
}

export async function logoutRemoteSession() {
  try {
    await requestRemoteUserData('/session/logout', { method: 'POST' });
  } catch {
    // 本地退出不能因为网络错误被阻塞；HttpOnly cookie 会在过期后失效。
  }
}
