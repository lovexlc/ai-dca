// /api/account/v1 的 REST 客户端：每个功能一组资源接口，不再有整包上传。
// 鉴权沿用现有登录会话（Bearer）；请求体为明文 JSON，不再携带任何密文与密钥。
// 所有账号资源请求必须先实时检查 migrations/legacy，迁移状态是唯一门禁。

import { loadCloudSession } from './authSession.js';

const DEFAULT_ACCOUNT_BASE = 'https://api.freebacktrack.tech/api/account/v1';
const SETTLED_MIGRATION_STATUSES = new Set(['imported', 'skipped', 'no-legacy']);

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

export function normalizeLegacyMigrationStatus(migration = {}) {
  const status = String(migration?.status || 'pending').trim().toLowerCase();
  const legacyExists = Boolean(migration?.legacy?.exists);
  if (status === 'pending' && !legacyExists) {
    return { ...migration, status: 'no-legacy', needsMigration: false };
  }
  return {
    ...migration,
    status,
    needsMigration: status === 'pending' && legacyExists
  };
}

export function isLegacyMigrationSettled(migration = {}) {
  return SETTLED_MIGRATION_STATUSES.has(normalizeLegacyMigrationStatus(migration).status);
}

export async function fetchLegacyMigrationStatus(session = loadCloudSession()) {
  const migration = await request('/migrations/legacy', { token: requireToken(session) });
  return normalizeLegacyMigrationStatus(migration);
}

export async function assertLegacyMigrationSettled(session = loadCloudSession()) {
  const migration = await fetchLegacyMigrationStatus(session);
  if (isLegacyMigrationSettled(migration)) return migration;
  const error = new Error('账号旧数据尚未迁移，暂不允许访问新账号资源。');
  error.status = 409;
  error.code = 'LEGACY_MIGRATION_REQUIRED';
  error.migration = migration;
  error.data = migration;
  throw error;
}

async function requestAccountResource(path, options = {}, session = loadCloudSession()) {
  const token = requireToken(session);
  await assertLegacyMigrationSettled(session);
  return request(path, { ...options, token });
}

export async function fetchAccountHealth() {
  return request('/health');
}

export async function fetchAccountManifest(session = loadCloudSession()) {
  return requestAccountResource('/manifest', {}, session);
}

export async function fetchAccountBundle(resources = [], session = loadCloudSession()) {
  const list = Array.isArray(resources) ? resources.filter(Boolean) : [];
  const query = list.length ? `?resources=${encodeURIComponent(list.join(','))}` : '';
  return requestAccountResource(`/bundle${query}`, {}, session);
}

export async function fetchAccountResource(resource, session = loadCloudSession()) {
  return requestAccountResource(`/${resource}`, {}, session);
}

export async function fetchAccountResourceHistory(resource, session = loadCloudSession()) {
  return requestAccountResource(`/${resource}?history=1`, {}, session);
}

export async function putAccountResource(resource, { data, baseRevision = null, force = false, end = null } = {}, session = loadCloudSession()) {
  const headers = {};
  if (!force && Number.isFinite(Number(baseRevision))) headers['if-match'] = `"${Number(baseRevision)}"`;
  return requestAccountResource(`/${resource}`, {
    method: 'PUT',
    headers,
    body: { data, baseRevision: force ? null : baseRevision, force, end }
  }, session);
}

export async function patchAccountResource(resource, patch = {}, { baseRevision = null, end = null } = {}, session = loadCloudSession()) {
  return requestAccountResource(`/${resource}`, {
    method: 'PATCH',
    body: { patch, baseRevision, end }
  }, session);
}

export async function deleteAccountResource(resource, session = loadCloudSession()) {
  return requestAccountResource(`/${resource}`, { method: 'DELETE' }, session);
}

export async function putAccountResourceItem(resource, itemId, item, session = loadCloudSession()) {
  return requestAccountResource(`/${resource}/items/${encodeURIComponent(itemId)}`, {
    method: 'PUT',
    body: { item }
  }, session);
}

export async function deleteAccountResourceItem(resource, itemId, session = loadCloudSession()) {
  return requestAccountResource(`/${resource}/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE'
  }, session);
}

export async function fetchAccountEnvelopeExport(session = loadCloudSession()) {
  return requestAccountResource('/exports/envelope', {}, session);
}

export async function importLegacyResources(payload = {}, session = loadCloudSession()) {
  return request('/migrations/legacy', { method: 'POST', token: requireToken(session), body: payload });
}

export async function skipLegacyMigrationOnServer(payload = {}, session = loadCloudSession()) {
  return request('/migrations/legacy/skip', { method: 'POST', token: requireToken(session), body: payload });
}
