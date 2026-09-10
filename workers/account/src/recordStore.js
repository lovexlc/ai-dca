// Per-record CRUD for account resources. This is separate from the aggregate
// compatibility endpoints so an item revision can be checked independently.

import { RESOURCE_HISTORY_LIMIT, measureBytes } from './catalog.js';
import { canonicalJson } from './patch.js';
import { assembleResourceRows } from './recordRows.js';
import { ensureSchema, nowIso, readResourceRow, sha256Hex } from './store.js';

function parsePayload(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || 'null')); } catch { return null; }
}

async function readRows(env, userId, resource) {
  const result = await env.DB.prepare(`SELECT * FROM account_resource_records
    WHERE user_id = ? AND resource = ? ORDER BY position ASC, record_id ASC`).bind(userId, resource).all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function readRawResource(env, userId, resource) {
  return env.DB.prepare('SELECT * FROM account_resources WHERE user_id = ? AND resource = ?').bind(userId, resource).first();
}

function recordResult(row) {
  if (!row) return null;
  return {
    id: String(row.record_id || ''),
    parentId: String(row.parent_id || ''),
    kind: String(row.record_kind || 'item'),
    position: Number(row.position || 0),
    revision: Number(row.revision || 0),
    contentHash: String(row.content_hash || ''),
    updatedAt: String(row.updated_at || ''),
    updatedByEndId: String(row.updated_by_end_id || ''),
    updatedByEndType: String(row.updated_by_end_type || ''),
    deleted: Boolean(row.deleted),
    data: parsePayload(row.payload)
  };
}

// The item endpoint serializes this value twice: it needs revision metadata in
// JavaScript, while the public `resource` field remains the resource name.
function responseResource(descriptor, value) {
  const metadata = value && typeof value === 'object' ? { ...value } : {};
  Object.defineProperty(metadata, 'toJSON', {
    enumerable: false,
    value: () => descriptor.resource
  });
  return metadata;
}

async function refreshResourceManifest(env, userId, descriptor, end = {}) {
  const records = await readRows(env, userId, descriptor.resource);
  const assembled = assembleResourceRows(descriptor, records);
  const serialized = canonicalJson(assembled);
  const contentHash = await sha256Hex(serialized);
  const current = await readRawResource(env, userId, descriptor.resource);
  const revision = Number(current?.revision || 0) + 1;
  const updatedAt = nowIso();
  const endId = String(end?.id || '').slice(0, 120);
  const endType = String(end?.type || '').slice(0, 40);
  const activeCount = records.filter((record) => Number(record.deleted || 0) === 0 && record.record_kind !== 'meta').length;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO account_resources
      (user_id, resource, feature, revision, content_hash, bytes, item_count, payload, deleted, updated_at, updated_by_end_id, updated_by_end_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, '', 0, ?, ?, ?)
      ON CONFLICT(user_id, resource) DO UPDATE SET
        revision = excluded.revision,
        content_hash = excluded.content_hash,
        bytes = excluded.bytes,
        item_count = excluded.item_count,
        payload = '',
        deleted = 0,
        updated_at = excluded.updated_at,
        updated_by_end_id = excluded.updated_by_end_id,
        updated_by_end_type = excluded.updated_by_end_type`)
      .bind(userId, descriptor.resource, descriptor.feature, revision, contentHash, measureBytes(serialized), activeCount, updatedAt, endId, endType),
    env.DB.prepare(`INSERT OR REPLACE INTO account_resource_history
      (user_id, resource, revision, content_hash, bytes, payload, deleted, updated_at, updated_by_end_id, created_at)
      VALUES (?, ?, ?, ?, ?, '', 0, ?, ?, ?)`)
      .bind(userId, descriptor.resource, revision, contentHash, measureBytes(serialized), updatedAt, endId, updatedAt),
    env.DB.prepare('DELETE FROM account_resource_history WHERE user_id = ? AND resource = ? AND revision <= ?')
      .bind(userId, descriptor.resource, revision - RESOURCE_HISTORY_LIMIT)
  ]);
  return { revision, contentHash, updatedAt, itemCount: activeCount };
}

export async function readResourceRecord(env, userId, descriptor, recordId) {
  await ensureSchema(env);
  let row = await env.DB.prepare(`SELECT * FROM account_resource_records
    WHERE user_id = ? AND resource = ? AND record_id = ?`).bind(userId, descriptor.resource, recordId).first();
  if (!row) {
    // This also lazily converts an old account_resources.payload aggregate.
    await readResourceRow(env, userId, descriptor.resource);
    row = await env.DB.prepare(`SELECT * FROM account_resource_records
      WHERE user_id = ? AND resource = ? AND record_id = ?`).bind(userId, descriptor.resource, recordId).first();
  }
  return recordResult(row);
}

export async function writeResourceRecord(env, userId, descriptor, recordId, data, {
  parentId = '',
  kind = 'item',
  position = 0,
  expectedRevision = null,
  force = false,
  end = {}
} = {}) {
  await ensureSchema(env);
  // Backfill first, otherwise updating one item on an old aggregate would
  // accidentally hide its untouched sibling records.
  await readResourceRow(env, userId, descriptor.resource);
  const id = String(recordId || '').trim();
  const current = await env.DB.prepare(`SELECT * FROM account_resource_records
    WHERE user_id = ? AND resource = ? AND record_id = ?`).bind(userId, descriptor.resource, id).first();
  const currentRevision = Number(current?.revision || 0);
  if (!force && expectedRevision !== null && expectedRevision !== undefined && Number(expectedRevision) !== currentRevision) {
    return { conflict: true, currentRevision, current: recordResult(current), resource: responseResource(descriptor, await readResourceRow(env, userId, descriptor.resource)) };
  }
  const serialized = JSON.stringify(data ?? null);
  const contentHash = await sha256Hex(canonicalJson(data ?? null));
  if (current && Number(current.deleted || 0) === 0 && String(current.content_hash || '') === contentHash) {
    return { unchanged: true, recordRevision: currentRevision, record: recordResult(current), resource: responseResource(descriptor, await readResourceRow(env, userId, descriptor.resource)) };
  }
  const timestamp = nowIso();
  const endId = String(end?.id || '').slice(0, 120);
  const endType = String(end?.type || '').slice(0, 40);
  const revision = currentRevision + 1;
  await env.DB.prepare(`INSERT INTO account_resource_records
    (user_id, resource, record_id, parent_id, record_kind, position, revision, content_hash, bytes, payload, deleted, created_at, updated_at, updated_by_end_id, updated_by_end_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    ON CONFLICT(user_id, resource, record_id) DO UPDATE SET
      parent_id = excluded.parent_id,
      record_kind = excluded.record_kind,
      position = excluded.position,
      revision = excluded.revision,
      content_hash = excluded.content_hash,
      bytes = excluded.bytes,
      payload = excluded.payload,
      deleted = 0,
      updated_at = excluded.updated_at,
      updated_by_end_id = excluded.updated_by_end_id,
      updated_by_end_type = excluded.updated_by_end_type`)
    .bind(userId, descriptor.resource, id, String(parentId || '').slice(0, 240), String(kind || 'item').slice(0, 40), Number(position) || 0, revision, contentHash, measureBytes(serialized), serialized, timestamp, timestamp, endId, endType)
    .run();
  const resource = await refreshResourceManifest(env, userId, descriptor, end);
  return { recordRevision: revision, record: { id, parentId, kind, position: Number(position) || 0, revision, contentHash, updatedAt: timestamp, data }, resource: responseResource(descriptor, resource) };
}

export async function deleteResourceRecord(env, userId, descriptor, recordId, { expectedRevision = null, force = false, end = {} } = {}) {
  await ensureSchema(env);
  await readResourceRow(env, userId, descriptor.resource);
  const id = String(recordId || '').trim();
  const current = await env.DB.prepare(`SELECT * FROM account_resource_records
    WHERE user_id = ? AND resource = ? AND record_id = ?`).bind(userId, descriptor.resource, id).first();
  const currentRevision = Number(current?.revision || 0);
  if (!current || Number(current.deleted || 0) === 1) return { notFound: true, currentRevision };
  if (!force && expectedRevision !== null && expectedRevision !== undefined && Number(expectedRevision) !== currentRevision) {
    return { conflict: true, currentRevision, current: recordResult(current), resource: responseResource(descriptor, await readResourceRow(env, userId, descriptor.resource)) };
  }
  const timestamp = nowIso();
  const revision = currentRevision + 1;
  await env.DB.prepare(`UPDATE account_resource_records SET
    revision = ?, content_hash = '', bytes = 0, payload = '{}', deleted = 1,
    updated_at = ?, updated_by_end_id = ?, updated_by_end_type = ?
    WHERE user_id = ? AND resource = ? AND record_id = ?`)
    .bind(revision, timestamp, String(end?.id || '').slice(0, 120), String(end?.type || '').slice(0, 40), userId, descriptor.resource, id)
    .run();
  const resource = await refreshResourceManifest(env, userId, descriptor, end);
  return { recordRevision: revision, deleted: true, resource: responseResource(descriptor, resource) };
}
