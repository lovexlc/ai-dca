// /api/account/v1 的 REST 客户端：每个功能一组资源接口，不再有整包上传。
// 鉴权沿用现有登录会话（Bearer）；请求体为明文 JSON，不再携带任何密文与密钥。

import { loadCloudSession } from './authSession.js';

const DEFAULT_ACCOUNT_BASE = 'https://api.freebacktrack.tech/api/account/v1';

export function getAccountApiBase() {
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
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

async function request(path, { method = 'GET', token = '', body = null, headers = {} } = {}) {
  const finalHeaders = { 'content-type': 'application/json; charset=utf-8', ...headers };
  if (token) finalHeaders.authorization = `Bearer ${token}`;
  const response = await fetch(`${getAccountApiBase()}${path}`, {
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

function requireToken(session) {
  const token = session?.accessToken || '';
  if (!token) throw new Error('请先登录账户');
  return token;
}

export async function fetchAccountHealth() {
  return request('/health');
}

export async function fetchAccountManifest(session = loadCloudSession()) {
  return request('/manifest', { token: requireToken(session) });
}

export async function fetchAccountBundle(resources = [], session = loadCloudSession()) {
  const list = Array.isArray(resources) ? resources.filter(Boolean) : [];
  const query = list.length ? `?resources=${encodeURIComponent(list.join(','))}` : '';
  return request(`/bundle${query}`, { token: requireToken(session) });
}

export async function fetchAccountResource(resource, session = loadCloudSession()) {
  return request(`/${resource}`, { token: requireToken(session) });
}

export async function fetchAccountResourceHistory(resource, session = loadCloudSession()) {
  return request(`/${resource}?history=1`, { token: requireToken(session) });
}

export async function putAccountResource(resource, { data, baseRevision = null, force = false, end = null } = {}, session = loadCloudSession()) {
  const headers = {};
  if (!force && Number.isFinite(Number(baseRevision))) headers['if-match'] = `"${Number(baseRevision)}"`;
  return request(`/${resource}`, {
    method: 'PUT',
    token: requireToken(session),
    headers,
    body: { data, baseRevision: force ? null : baseRevision, force, end }
  });
}

export async function patchAccountResource(resource, patch = {}, { baseRevision = null, end = null } = {}, session = loadCloudSession()) {
  return request(`/${resource}`, {
    method: 'PATCH',
    token: requireToken(session),
    body: { patch, baseRevision, end }
  });
}

export async function deleteAccountResource(resource, session = loadCloudSession()) {
  return request(`/${resource}`, { method: 'DELETE', token: requireToken(session) });
}

export async function putAccountResourceItem(resource, itemId, item, session = loadCloudSession()) {
  return request(`/${resource}/items/${encodeURIComponent(itemId)}`, {
    method: 'PUT',
    token: requireToken(session),
    body: { item }
  });
}

export async function deleteAccountResourceItem(resource, itemId, session = loadCloudSession()) {
  return request(`/${resource}/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    token: requireToken(session)
  });
}

export async function fetchAccountEnvelopeExport(session = loadCloudSession()) {
  return request('/exports/envelope', { token: requireToken(session) });
}

export async function fetchLegacyMigrationStatus(session = loadCloudSession()) {
  return request('/migrations/legacy', { token: requireToken(session) });
}

export async function importLegacyResources(payload = {}, session = loadCloudSession()) {
  return request('/migrations/legacy', { method: 'POST', token: requireToken(session), body: payload });
}

export async function skipLegacyMigrationOnServer(payload = {}, session = loadCloudSession()) {
  return request('/migrations/legacy/skip', { method: 'POST', token: requireToken(session), body: payload });
}
