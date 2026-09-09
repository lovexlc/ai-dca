// 持仓交易行 API：一条交易对应一个 REST 资源，不再 PUT 整个持仓快照。
import { loadCloudSession } from './authSession.js';

const DEFAULT_ACCOUNT_BASE = 'https://api.freebacktrack.tech/api/account/v1';

function getBase() {
  if (typeof window !== 'undefined') {
    if (window.__AI_DCA_ACCOUNT_BASE__) return String(window.__AI_DCA_ACCOUNT_BASE__).replace(/\/$/, '');
    if (window.__AI_DCA_SYNC_BASE__) {
      const syncBase = String(window.__AI_DCA_SYNC_BASE__).replace(/\/$/, '');
      if (syncBase.endsWith('/api/sync')) return `${syncBase.slice(0, -'/api/sync'.length)}/api/account/v1`;
    }
  }
  return DEFAULT_ACCOUNT_BASE;
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { message: text }; }
}

async function request(path, { method = 'GET', session = loadCloudSession(), body = null, headers = {} } = {}) {
  const token = session?.accessToken || '';
  if (!token) throw new Error('请先登录账户');
  const finalHeaders = {
    'content-type': 'application/json; charset=utf-8',
    authorization: `Bearer ${token}`,
    ...headers
  };
  const response = await fetch(`${getBase()}${path}`, {
    method,
    headers: finalHeaders,
    body: body === null || body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `请求失败：HTTP ${response.status}`);
    error.status = response.status;
    error.code = data?.error || '';
    error.data = data;
    error.isRevisionConflict = response.status === 409;
    throw error;
  }
  return data;
}

export async function fetchHoldingTransactionRows({ cursor = '', limit = 500 } = {}, session = loadCloudSession()) {
  const params = new URLSearchParams();
  if (cursor !== '' && cursor !== null && cursor !== undefined) params.set('cursor', String(cursor));
  params.set('limit', String(Math.min(Math.max(Number(limit) || 500, 1), 1000)));
  return request(`/holdings/ledger/items?${params.toString()}`, { session });
}

export async function putHoldingTransaction(transactionId, data, { baseRevision = null, force = false, end = null } = {}, session = loadCloudSession()) {
  const id = encodeURIComponent(String(transactionId || '').trim());
  const headers = {};
  if (!force && Number.isFinite(Number(baseRevision))) headers['if-match'] = `"${Number(baseRevision)}"`;
  return request(`/holdings/ledger/items/${id}`, {
    method: 'PUT',
    session,
    headers,
    body: { data, baseRevision: force ? null : baseRevision, force, end }
  });
}

export async function deleteHoldingTransaction(transactionId, { baseRevision = null, force = false, end = null } = {}, session = loadCloudSession()) {
  const id = encodeURIComponent(String(transactionId || '').trim());
  const headers = {};
  if (!force && Number.isFinite(Number(baseRevision))) headers['if-match'] = `"${Number(baseRevision)}"`;
  return request(`/holdings/ledger/items/${id}`, {
    method: 'DELETE',
    session,
    headers,
    body: { baseRevision: force ? null : baseRevision, force, end }
  });
}
