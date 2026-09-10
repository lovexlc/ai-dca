// D1 access layer. account_resources is retained as a compatibility manifest;
// active business data is stored one record per row in account_resource_records.

import { RESOURCE_CATALOG, RESOURCE_HISTORY_LIMIT, measureBytes, getResourceDescriptor } from './catalog.js';
import { canonicalJson } from './patch.js';
import { assembleResourceRows, rowCount, splitResourceRows } from './recordRows.js';

let schemaReady = false;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS account_resources (
    user_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    feature TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL DEFAULT '',
    bytes INTEGER NOT NULL DEFAULT 0,
    item_count INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '',
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    updated_by_end_id TEXT NOT NULL DEFAULT '',
    updated_by_end_type TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, resource)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_account_resources_user_updated ON account_resources (user_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS account_resource_records (
    user_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    record_id TEXT NOT NULL,
    parent_id TEXT NOT NULL DEFAULT '',
    record_kind TEXT NOT NULL DEFAULT 'item',
    position INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL DEFAULT '',
    bytes INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '{}',
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by_end_id TEXT NOT NULL DEFAULT '',
    updated_by_end_type TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, resource, record_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_account_resource_records_collection ON account_resource_records (user_id, resource, deleted, position)`,
  `CREATE TABLE IF NOT EXISTS account_resource_history (
    user_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    revision INTEGER NOT NULL,
    content_hash TEXT NOT NULL DEFAULT '',
    bytes INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '',
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    updated_by_end_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, resource, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS account_migrations (
    user_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL DEFAULT '',
    legacy_version INTEGER NOT NULL DEFAULT 0,
    imported_resources INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`
];

export function nowIso() {
  return new Date().toISOString();
}

export async function sha256Hex(text = '') {
  const bytes = new TextEncoder().encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));
  schemaReady = true;
}

function parseJson(value, fallback = null) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')); } catch { return fallback; }
}

export function parsePayload(row) {
  if (!row || row.deleted) return null;
  if (!row.payload) return null;
  return parseJson(row.payload, null);
}

function rowToMeta(row, descriptor) {
  return {
    resource: descriptor.resource,
    feature: descriptor.feature,
    merge: descriptor.merge,
    revision: Number(row?.revision || 0),
    contentHash: String(row?.content_hash || ''),
    bytes: Number(row?.bytes || 0),
    itemCount: Number(row?.item_count || 0),
    deleted: Boolean(row?.deleted),
    updatedAt: String(row?.updated_at || ''),
    updatedByEndId: String(row?.updated_by_end_id || ''),
    updatedByEndType: String(row?.updated_by_end_type || '')
  };
}

async function readRawResourceRow(env, userId, resource) {
  return env.DB.prepare('SELECT * FROM account_resources WHERE user_id = ? AND resource = ?').bind(userId, resource).first();
}

async function readRecordRows(env, userId, resource) {
  const result = await env.DB.prepare(`SELECT * FROM account_resource_records
    WHERE user_id = ? AND resource = ? ORDER BY position ASC, record_id ASC`).bind(userId, resource).all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function runBatches(env, statements, batchSize = 80) {
  for (let index = 0; index < statements.length; index += batchSize) {
    const batch = statements.slice(index, index + batchSize);
    if (batch.length) await env.DB.batch(batch);
  }
}

async function backfillLegacyRows(env, userId, descriptor, legacyRow) {
  if (!legacyRow || Number(legacyRow.deleted || 0) === 1 || !legacyRow.payload) return [];
  const existing = await readRecordRows(env, userId, descriptor.resource);
  if (existing.length) return existing;
  const data = parseJson(legacyRow.payload, null);
  if (data === null || data === undefined) return [];
  const rows = splitResourceRows(descriptor, data);
  const timestamp = nowIso();
  const statements = rows.map((item) => {
    const serialized = JSON.stringify(item.payload ?? null);
    return env.DB.prepare(`INSERT OR IGNORE INTO account_resource_records
      (user_id, resource, record_id, parent_id, record_kind, position, revision, content_hash, bytes, payload, deleted, created_at, updated_at, updated_by_end_id, updated_by_end_type)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, ?, ?, ?, ?)`)
      .bind(userId, descriptor.resource, item.recordId, item.parentId, item.recordKind, item.position, '', measureBytes(serialized), serialized, timestamp, timestamp, 'server-backfill', 'legacy-resource');
  });
  await runBatches(env, statements);
  return readRecordRows(env, userId, descriptor.resource);
}

async function hydratedResourceRow(env, userId, descriptor, rawRow = null) {
  const row = rawRow || await readRawResourceRow(env, userId, descriptor.resource);
  if (!row) return null;
  let records = await readRecordRows(env, userId, descriptor.resource);
  if (!records.length) records = await backfillLegacyRows(env, userId, descriptor, row);
  if (records.length) {
    return { ...row, payload: JSON.stringify(assembleResourceRows(descriptor, records)) };
  }
  return row;
}

export async function readResourceRow(env, userId, resource) {
  await ensureSchema(env);
  const descriptor = getResourceDescriptor(resource);
  return hydratedResourceRow(env, userId, descriptor || { resource, shape: 'object' });
}

export async function readAllResourceRows(env, userId) {
  await ensureSchema(env);
  const { results } = await env.DB.prepare('SELECT * FROM account_resources WHERE user_id = ?').bind(userId).all();
  const map = new Map();
  for (const raw of results || []) {
    const descriptor = getResourceDescriptor(raw.resource) || { resource: raw.resource, shape: 'object' };
    map.set(String(raw.resource), await hydratedResourceRow(env, userId, descriptor, raw));
  }
  return map;
}

export async function readManifest(env, userId) {
  const rows = await readAllRawResourceRows(env, userId);
  return RESOURCE_CATALOG.map((descriptor) => rowToMeta(rows.get(descriptor.resource), descriptor));
}

async function readAllRawResourceRows(env, userId) {
  await ensureSchema(env);
  const { results } = await env.DB.prepare('SELECT * FROM account_resources WHERE user_id = ?').bind(userId).all();
  const map = new Map();
  for (const row of results || []) map.set(String(row.resource), row);
  return map;
}

async function writeRecordRows(env, userId, descriptor, data, end = {}) {
  const incoming = splitResourceRows(descriptor, data);
  const existing = await readRecordRows(env, userId, descriptor.resource);
  const existingById = new Map(existing.map((item) => [String(item.record_id), item]));
  const incomingIds = new Set(incoming.map((item) => item.recordId));
  const now = nowIso();
  const endId = String(end?.id || '').slice(0, 120);
  const endType = String(end?.type || '').slice(0, 40);
  const statements = [];

  for (const item of incoming) {
    const current = existingById.get(item.recordId);
    const serialized = JSON.stringify(item.payload ?? null);
    const contentHash = await sha256Hex(canonicalJson(item.payload ?? null));
    const revision = Number(current?.revision || 0) + 1;
    statements.push(env.DB.prepare(`INSERT INTO account_resource_records
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
      .bind(userId, descriptor.resource, item.recordId, item.parentId, item.recordKind, item.position, revision, contentHash, measureBytes(serialized), serialized, now, now, endId, endType));
  }

  for (const current of existing) {
    const id = String(current.record_id || '');
    if (!incomingIds.has(id) && Number(current.deleted || 0) === 0) {
      statements.push(env.DB.prepare(`UPDATE account_resource_records SET
        revision = ?, content_hash = '', bytes = 0, payload = '{}', deleted = 1,
        updated_at = ?, updated_by_end_id = ?, updated_by_end_type = ?
        WHERE user_id = ? AND resource = ? AND record_id = ?`)
        .bind(Number(current.revision || 0) + 1, now, endId, endType, userId, descriptor.resource, id));
    }
  }

  await runBatches(env, statements);
  return { rows: incoming, count: incoming.length };
}

export async function writeResource(env, userId, descriptor, {
  data = null,
  serialized = null,
  expectedRevision = null,
  force = false,
  deleted = false,
  end = {}
} = {}) {
  await ensureSchema(env);
  const current = await readRawResourceRow(env, userId, descriptor.resource);
  const currentRevision = Number(current?.revision || 0);
  if (!force && expectedRevision !== null && expectedRevision !== undefined && Number(expectedRevision) !== currentRevision) {
    const hydrated = await hydratedResourceRow(env, userId, descriptor, current);
    return {
      conflict: true,
      currentRevision,
      updatedAt: String(current?.updated_at || ''),
      contentHash: String(current?.content_hash || ''),
      data: parsePayload(hydrated)
    };
  }

  const payloadData = deleted ? null : data;
  const contentHash = deleted ? '' : await sha256Hex(canonicalJson(payloadData));
  const alreadySame = Boolean(current) && Number(current.deleted || 0) === (deleted ? 1 : 0) && String(current.content_hash || '') === contentHash;
  if (alreadySame) {
    return {
      unchanged: true,
      revision: currentRevision,
      updatedAt: String(current.updated_at || ''),
      contentHash,
      bytes: Number(current.bytes || 0),
      itemCount: Number(current.item_count || 0)
    };
  }

  let count = 0;
  if (!deleted) {
    const result = await writeRecordRows(env, userId, descriptor, payloadData, end);
    count = result.count;
  } else {
    const records = await readRecordRows(env, userId, descriptor.resource);
    const now = nowIso();
    await runBatches(env, records.filter((item) => Number(item.deleted || 0) === 0).map((item) => env.DB.prepare(`UPDATE account_resource_records SET
      revision = ?, content_hash = '', bytes = 0, payload = '{}', deleted = 1,
      updated_at = ?, updated_by_end_id = ?, updated_by_end_type = ?
      WHERE user_id = ? AND resource = ? AND record_id = ?`)
      .bind(Number(item.revision || 0) + 1, now, String(end?.id || '').slice(0, 120), String(end?.type || '').slice(0, 40), userId, descriptor.resource, item.record_id)));
  }

  const revision = currentRevision + 1;
  const updatedAt = nowIso();
  const bytes = deleted ? 0 : measureBytes(canonicalJson(payloadData));
  const endId = String(end?.id || '').slice(0, 120);
  const endType = String(end?.type || '').slice(0, 40);
  const statements = [
    env.DB.prepare(`INSERT INTO account_resources (user_id, resource, feature, revision, content_hash, bytes, item_count, payload, deleted, updated_at, updated_by_end_id, updated_by_end_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)
      ON CONFLICT(user_id, resource) DO UPDATE SET
        revision = excluded.revision,
        content_hash = excluded.content_hash,
        bytes = excluded.bytes,
        item_count = excluded.item_count,
        payload = '',
        deleted = excluded.deleted,
        updated_at = excluded.updated_at,
        updated_by_end_id = excluded.updated_by_end_id,
        updated_by_end_type = excluded.updated_by_end_type`)
      .bind(userId, descriptor.resource, descriptor.feature, revision, contentHash, bytes, count, deleted ? 1 : 0, updatedAt, endId, endType),
    env.DB.prepare(`INSERT OR REPLACE INTO account_resource_history (user_id, resource, revision, content_hash, bytes, payload, deleted, updated_at, updated_by_end_id, created_at)
      VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?)`)
      .bind(userId, descriptor.resource, revision, contentHash, bytes, deleted ? 1 : 0, updatedAt, endId, updatedAt),
    env.DB.prepare('DELETE FROM account_resource_history WHERE user_id = ? AND resource = ? AND revision <= ?')
      .bind(userId, descriptor.resource, revision - RESOURCE_HISTORY_LIMIT)
  ];
  await runBatches(env, statements);

  return { revision, updatedAt, contentHash, bytes, itemCount: count, deleted };
}

export async function readHistory(env, userId, resource, limit = RESOURCE_HISTORY_LIMIT) {
  const size = Math.min(Math.max(Number(limit) || RESOURCE_HISTORY_LIMIT, 1), RESOURCE_HISTORY_LIMIT);
  const { results } = await env.DB
    .prepare('SELECT revision, content_hash, bytes, deleted, updated_at, updated_by_end_id FROM account_resource_history WHERE user_id = ? AND resource = ? ORDER BY revision DESC LIMIT ?')
    .bind(userId, resource, size)
    .all();
  return (results || []).map((row) => ({
    revision: Number(row.revision || 0),
    contentHash: String(row.content_hash || ''),
    bytes: Number(row.bytes || 0),
    deleted: Boolean(row.deleted),
    updatedAt: String(row.updated_at || ''),
    updatedByEndId: String(row.updated_by_end_id || '')
  }));
}

export async function readMigration(env, userId) {
  const row = await env.DB.prepare('SELECT * FROM account_migrations WHERE user_id = ?').bind(userId).first();
  if (!row) return { status: 'pending', source: '', legacyVersion: 0, importedResources: 0, note: '', updatedAt: '' };
  return {
    status: String(row.status || 'pending'),
    source: String(row.source || ''),
    legacyVersion: Number(row.legacy_version || 0),
    importedResources: Number(row.imported_resources || 0),
    note: String(row.note || ''),
    updatedAt: String(row.updated_at || '')
  };
}

export async function writeMigration(env, userId, { status, source = '', legacyVersion = 0, importedResources = 0, note = '' }) {
  const timestamp = nowIso();
  await env.DB.prepare(`INSERT INTO account_migrations (user_id, status, source, legacy_version, imported_resources, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      status = excluded.status,
      source = excluded.source,
      legacy_version = excluded.legacy_version,
      imported_resources = excluded.imported_resources,
      note = excluded.note,
      updated_at = excluded.updated_at`)
    .bind(userId, status, source, Number(legacyVersion) || 0, Number(importedResources) || 0, String(note || '').slice(0, 400), timestamp, timestamp)
    .run();
  return readMigration(env, userId);
}

export async function readLegacyBackupMeta(env, userId) {
  let row = null;
  try {
    row = await env.DB
      .prepare('SELECT version, updated_at, key_count, bytes, content_hash, envelope FROM backups WHERE user_id = ?')
      .bind(userId)
      .first();
  } catch {
    return { exists: false, reason: 'legacy-table-missing' };
  }
  if (!row) return { exists: false };
  let cryptoKind = 'unknown';
  let envelopeVersion = 0;
  try {
    const parsed = JSON.parse(String(row.envelope || 'null'));
    envelopeVersion = Number(parsed?.version || 0);
    const cryptoMeta = parsed?.crypto || {};
    if (!parsed?.ciphertext) cryptoKind = 'plaintext';
    else if (envelopeVersion === 3 && cryptoMeta.wrappedDek) cryptoKind = 'password';
    else if (String(cryptoMeta.kdf || '') === 'RAW-AES-GCM' || !cryptoMeta.salt) cryptoKind = 'device-key';
    else cryptoKind = 'password';
  } catch {
    cryptoKind = 'unknown';
  }
  return {
    exists: true,
    version: Number(row.version || 0),
    envelopeVersion,
    updatedAt: String(row.updated_at || ''),
    keyCount: Number(row.key_count || 0),
    bytes: Number(row.bytes || 0),
    contentHash: String(row.content_hash || ''),
    cryptoKind
  };
}
