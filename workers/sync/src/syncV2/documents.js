import {
  ACCOUNT_SYNC_KEYS,
  MAX_SYNC_DOCUMENT_BYTES,
  normalizeSyncKey
} from './schema.js';
import { currentSyncCursor } from './changes.js';
import { findSyncMutation, normalizeMutationId, saveSyncMutation } from './mutations.js';

function userKey(userId) {
  return String(userId || '').trim();
}

function documentSummary(row) {
  return {
    syncKey: String(row?.syncKey || row?.sync_key || ''),
    revision: Math.max(0, Number(row?.revision) || 0),
    contentHash: String(row?.contentHash || row?.content_hash || ''),
    updatedAt: String(row?.updatedAt || row?.updated_at || ''),
    deleted: Boolean(row?.deleted || row?.deleted_at || row?.deletedAt)
  };
}

function parseEncryptedPayload(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeEncryptedPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const ciphertext = String(value.ciphertext || '');
  if (!ciphertext || ciphertext.length > MAX_SYNC_DOCUMENT_BYTES) return null;
  if (String(value.source || '') !== 'ai-dca-secure-sync') return null;
  if (!value.crypto || typeof value.crypto !== 'object' || Array.isArray(value.crypto)) return null;
  return {
    version: Number(value.version) || 3,
    source: 'ai-dca-secure-sync',
    crypto: value.crypto,
    meta: value.meta && typeof value.meta === 'object' ? value.meta : {},
    ciphertext
  };
}

export async function getSyncDocument(env, userId, syncKey) {
  const key = normalizeSyncKey(syncKey);
  if (!key) return null;
  const row = await env.DB.prepare(`SELECT sync_key AS syncKey, revision,
    content_hash AS contentHash, encrypted_payload AS encryptedPayload,
    updated_at AS updatedAt, deleted_at AS deletedAt
    FROM sync_documents_v2 WHERE user_id = ? AND sync_key = ?`)
    .bind(userKey(userId), key).first();
  if (!row) return null;
  return {
    ...documentSummary(row),
    encryptedPayload: parseEncryptedPayload(row.encryptedPayload)
  };
}

export async function listSyncManifest(env, userId) {
  const result = await env.DB.prepare(`SELECT sync_key AS syncKey, revision,
    content_hash AS contentHash, updated_at AS updatedAt, deleted_at AS deletedAt
    FROM sync_documents_v2 WHERE user_id = ? ORDER BY sync_key ASC`)
    .bind(userKey(userId)).all();
  return {
    cursor: await currentSyncCursor(env, userId),
    documents: (result?.results || []).map(documentSummary)
  };
}

export async function readSyncDocuments(env, userId, syncKeys = []) {
  const requested = Array.from(new Set((Array.isArray(syncKeys) ? syncKeys : [])
    .map(normalizeSyncKey).filter(Boolean)));
  if (!requested.length) return { documents: [] };
  const placeholders = requested.map(() => '?').join(', ');
  const result = await env.DB.prepare(`SELECT sync_key AS syncKey, revision,
    content_hash AS contentHash, encrypted_payload AS encryptedPayload,
    updated_at AS updatedAt, deleted_at AS deletedAt
    FROM sync_documents_v2 WHERE user_id = ? AND sync_key IN (${placeholders})`)
    .bind(userKey(userId), ...requested).all();
  const byKey = new Map((result?.results || []).map((row) => [String(row.syncKey || ''), row]));
  return {
    documents: requested.map((key) => {
      const row = byKey.get(key);
      if (!row) return { syncKey: key, revision: 0, contentHash: '', updatedAt: '', deleted: false, encryptedPayload: null };
      return {
        ...documentSummary(row),
        encryptedPayload: parseEncryptedPayload(row.encryptedPayload)
      };
    })
  };
}

export function validateSyncDocumentRead(body = {}) {
  const identityFields = ['clientId', 'username', 'userId', 'end'];
  if (identityFields.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    throw invalidWrite('V2 同步接口不接受客户端身份字段', 'SYNC_IDENTITY_FIELD_NOT_ALLOWED');
  }
  return body;
}

function invalidWrite(message, code = 'SYNC_DOCUMENT_INVALID', status = 400, extra = {}) {
  return Object.assign(new Error(message), { code, status, ...extra });
}

export function validateSyncDocumentWrite(body = {}) {
  const identityFields = ['clientId', 'username', 'userId', 'end'];
  if (identityFields.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    throw invalidWrite('V2 同步接口不接受客户端身份字段', 'SYNC_IDENTITY_FIELD_NOT_ALLOWED');
  }
  const syncKey = normalizeSyncKey(body.syncKey);
  if (!syncKey) throw invalidWrite('不支持的同步 key', 'SYNC_KEY_NOT_ALLOWED');
  const mutationId = normalizeMutationId(body.mutationId);
  if (!mutationId) throw invalidWrite('缺少有效的 mutationId', 'MUTATION_ID_REQUIRED');
  const baseRevision = Number(body.baseRevision);
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw invalidWrite('缺少有效的 baseRevision', 'BASE_REVISION_REQUIRED');
  }
  const operation = body.operation === 'delete' ? 'delete' : 'upsert';
  const contentHash = String(body.contentHash || '').trim().slice(0, 160);
  if (operation === 'upsert' && !contentHash) throw invalidWrite('缺少 contentHash', 'CONTENT_HASH_REQUIRED');
  const encryptedPayload = operation === 'delete' ? null : normalizeEncryptedPayload(body.encryptedPayload);
  if (operation === 'upsert' && !encryptedPayload) {
    throw invalidWrite('密文文档格式不合法', 'ENCRYPTED_PAYLOAD_INVALID');
  }
  return { syncKey, mutationId, baseRevision, operation, contentHash, encryptedPayload };
}

export async function writeSyncDocument(env, user, body = {}) {
  const input = validateSyncDocumentWrite(body);
  const userId = userKey(user?.id);
  const previousMutation = await findSyncMutation(env, userId, input.mutationId);
  if (previousMutation) return { ...previousMutation, idempotent: true };

  const current = await getSyncDocument(env, userId, input.syncKey);
  const currentRevision = Number(current?.revision) || 0;
  if (currentRevision !== input.baseRevision) {
    throw invalidWrite('同步文档版本已变化，请重新合并', 'DOCUMENT_REVISION_CONFLICT', 409, {
      syncKey: input.syncKey,
      expectedRevision: input.baseRevision,
      currentRevision
    });
  }
  if (current && input.operation === 'upsert' && !current.deleted && current.contentHash === input.contentHash) {
    const unchanged = {
      syncKey: input.syncKey,
      revision: currentRevision,
      contentHash: current.contentHash,
      updatedAt: current.updatedAt,
      cursor: await currentSyncCursor(env, userId),
      unchanged: true
    };
    await saveSyncMutation(env, userId, input.mutationId, unchanged);
    return unchanged;
  }

  const revision = currentRevision + 1;
  const updatedAt = new Date().toISOString();
  const encodedPayload = input.encryptedPayload ? JSON.stringify(input.encryptedPayload) : '';
  const deletedAt = input.operation === 'delete' ? updatedAt : null;
  await env.DB.prepare(`INSERT INTO sync_documents_v2
    (user_id, sync_key, revision, content_hash, encrypted_payload, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, sync_key) DO UPDATE SET
      revision = excluded.revision,
      content_hash = excluded.content_hash,
      encrypted_payload = excluded.encrypted_payload,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at`)
    .bind(userId, input.syncKey, revision, input.contentHash, encodedPayload, updatedAt, deletedAt).run();
  await env.DB.prepare(`INSERT INTO sync_changes_v2
    (user_id, sync_key, revision, operation, content_hash, changed_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(userId, input.syncKey, revision, input.operation, input.contentHash, updatedAt).run();
  const result = {
    syncKey: input.syncKey,
    revision,
    contentHash: input.contentHash,
    updatedAt,
    cursor: await currentSyncCursor(env, userId),
    deleted: input.operation === 'delete'
  };
  await saveSyncMutation(env, userId, input.mutationId, result);
  return result;
}

export const __internals = {
  normalizeEncryptedPayload,
  documentSummary,
  ACCOUNT_SYNC_KEYS
};
