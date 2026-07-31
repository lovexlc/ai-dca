import { loadCloudSession, requestCloudSync } from '../authClient.js';

function requireSession(session = loadCloudSession()) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  return session;
}

function normalizeLimit(limit = 100) {
  return Math.min(Math.max(Number(limit) || 100, 1), 100);
}

export async function fetchManifest(session = loadCloudSession()) {
  const current = requireSession(session);
  return requestCloudSync('/v2/manifest', { method: 'GET', token: current.accessToken });
}

export async function readDocuments(syncKeys = [], session = loadCloudSession()) {
  const current = requireSession(session);
  return requestCloudSync('/v2/documents/read', {
    method: 'POST',
    token: current.accessToken,
    body: JSON.stringify({ syncKeys: Array.from(new Set((Array.isArray(syncKeys) ? syncKeys : []).map((key) => String(key || '').trim()).filter(Boolean))) })
  });
}

export async function writeDocument({ mutationId, syncKey, baseRevision = 0, contentHash = '', encryptedPayload = null, operation = 'upsert' } = {}, session = loadCloudSession()) {
  const current = requireSession(session);
  const body = {
    mutationId: String(mutationId || '').trim(),
    syncKey: String(syncKey || '').trim(),
    baseRevision: Number(baseRevision) || 0,
    contentHash: String(contentHash || '').trim(),
    operation: operation === 'delete' ? 'delete' : 'upsert'
  };
  if (body.operation !== 'delete') body.encryptedPayload = encryptedPayload;
  return requestCloudSync('/v2/documents/write', {
    method: 'POST',
    token: current.accessToken,
    body: JSON.stringify(body)
  });
}

export async function fetchChanges({ since = 0, limit = 100 } = {}, session = loadCloudSession()) {
  const current = requireSession(session);
  const query = new URLSearchParams({ since: String(Math.max(0, Number(since) || 0)), limit: String(normalizeLimit(limit)) });
  return requestCloudSync(`/v2/changes?${query.toString()}`, { method: 'GET', token: current.accessToken });
}

export const __internals = { normalizeLimit };
