// 持仓交易行存储：交易记录是一行一条，持仓汇总不再作为账号事实保存。
// 资源名仍沿用 holdings/ledger，兼容旧客户端和旧 envelope；后端实际写入独立 D1 行表。

import { measureBytes } from './catalog.js';
import { canonicalJson } from './patch.js';
import { nowIso, sha256Hex } from './store.js';

export const HOLDINGS_LEDGER_RESOURCE = 'holdings/ledger';
export const HOLDINGS_TRANSACTION_MAX_BYTES = 64 * 1024;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS account_holdings_transactions (
    user_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL DEFAULT '',
    bytes INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '',
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    updated_by_end_id TEXT NOT NULL DEFAULT '',
    updated_by_end_type TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, transaction_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_holdings_transactions_user_code_date
    ON account_holdings_transactions (user_id, transaction_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS account_holdings_transaction_meta (
    user_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL DEFAULT '',
    bytes INTEGER NOT NULL DEFAULT 0,
    item_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    updated_by_end_id TEXT NOT NULL DEFAULT '',
    updated_by_end_type TEXT NOT NULL DEFAULT ''
  )`
];

let schemaReady = false;

export async function ensureTransactionSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));
  schemaReady = true;
}

export function normalizeTransactionRow(value = {}, requestedId = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = String(value.id || requestedId || '').trim();
  if (!id || id.length > 160) return null;
  return { ...value, id };
}

export function transactionSerialized(value) {
  const normalized = normalizeTransactionRow(value);
  if (!normalized) return { ok: false, code: 'TRANSACTION_INVALID' };
  let serialized;
  try {
    serialized = JSON.stringify(normalized);
  } catch {
    return { ok: false, code: 'TRANSACTION_UNSERIALIZABLE' };
  }
  const bytes = measureBytes(serialized);
  if (bytes > HOLDINGS_TRANSACTION_MAX_BYTES) {
    return { ok: false, code: 'TRANSACTION_TOO_LARGE', bytes };
  }
  return { ok: true, value: normalized, serialized, bytes };
}

export function sortTransactionRows(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const ad = String(a?.data?.date || a?.date || a?.createdAt || '');
    const bd = String(b?.data?.date || b?.date || b?.createdAt || '');
    if (ad !== bd) return ad.localeCompare(bd);
    return String(a?.data?.id || a?.id || '').localeCompare(String(b?.data?.id || b?.id || ''));
  });
}

export function canonicalTransactionRows(rows = []) {
  const values = sortTransactionRows(rows).map((row) => row?.data || row).filter(Boolean);
  return canonicalJson(values);
}

function parsePayload(row) {
  if (!row || Number(row.deleted || 0) === 1 || !row.payload) return null;
  try {
    return JSON.parse(String(row.payload));
  } catch {
    return null;
  }
}

function rowToItem(row) {
  const data = parsePayload(row);
  if (!data) return null;
  return {
    id: String(row.transaction_id || data.id || ''),
    revision: Number(row.revision || 0),
    contentHash: String(row.content_hash || ''),
    updatedAt: String(row.updated_at || ''),
    updatedByEndId: String(row.updated_by_end_id || ''),
    updatedByEndType: String(row.updated_by_end_type || ''),
    data
  };
}

async function readMetaRow(env, userId) {
  return env.DB.prepare('SELECT * FROM account_holdings_transaction_meta WHERE user_id = ?').bind(userId).first();
}

export async function readTransactionRow(env, userId, transactionId) {
  return env.DB.prepare(
    'SELECT * FROM account_holdings_transactions WHERE user_id = ? AND transaction_id = ?'
  ).bind(userId, transactionId).first();
}

export async function readTransactionRows(env, userId, { includeDeleted = false, limit = 500, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const sql = includeDeleted
    ? 'SELECT * FROM account_holdings_transactions WHERE user_id = ? ORDER BY updated_at ASC, transaction_id ASC LIMIT ? OFFSET ?'
    : 'SELECT * FROM account_holdings_transactions WHERE user_id = ? AND deleted = 0 ORDER BY updated_at ASC, transaction_id ASC LIMIT ? OFFSET ?';
  const { results } = await env.DB.prepare(sql).bind(userId, safeLimit, safeOffset).all();
  return (results || []).map(rowToItem).filter(Boolean);
}

const legacyBackfillAttempted = new Set();

export async function backfillLegacyTransactions(env, userId) {
  const key = String(userId || '');
  if (legacyBackfillAttempted.has(key)) return false;
  legacyBackfillAttempted.add(key);
  const current = await readMetaRow(env, userId);
  if (current && (Number(current.revision || 0) > 0 || Number(current.item_count || 0) > 0)) return false;
  let legacy = null;
  try {
    legacy = await env.DB.prepare('SELECT payload, deleted FROM account_resources WHERE user_id = ? AND resource = ?')
      .bind(userId, HOLDINGS_LEDGER_RESOURCE)
      .first();
  } catch {
    return false;
  }
  if (!legacy || Number(legacy.deleted || 0) === 1 || !legacy.payload) return false;
  let parsed = null;
  try { parsed = JSON.parse(String(legacy.payload)); } catch { return false; }
  const rows = extractLegacyTransactions(parsed);
  if (!rows.length) return false;
  for (const row of rows) {
    const normalized = normalizeTransactionRow(row);
    if (!normalized) continue;
    await writeTransactionRow(env, userId, normalized.id, normalized, {
      force: true,
      end: { id: 'server-backfill', type: 'legacy-resource' }
    });
  }
  return true;
}

export async function readTransactionManifest(env, userId) {
  await backfillLegacyTransactions(env, userId);
  const row = await readMetaRow(env, userId);
  return {
    resource: HOLDINGS_LEDGER_RESOURCE,
    feature: 'holdings',
    merge: 'holdingsTransactions',
    revision: Number(row?.revision || 0),
    contentHash: String(row?.content_hash || ''),
    bytes: Number(row?.bytes || 0),
    itemCount: Number(row?.item_count || 0),
    deleted: false,
    updatedAt: String(row?.updated_at || ''),
    updatedByEndId: String(row?.updated_by_end_id || ''),
    updatedByEndType: String(row?.updated_by_end_type || '')
  };
}

async function rebuildTransactionMeta(env, userId, end = {}) {
  const rows = await readTransactionRows(env, userId, { limit: 1000 });
  const canonical = canonicalTransactionRows(rows);
  const current = await readMetaRow(env, userId);
  const revision = Number(current?.revision || 0) + 1;
  const updatedAt = nowIso();
  const contentHash = await sha256Hex(canonical);
  const bytes = measureBytes(canonical);
  const endId = String(end?.id || '').slice(0, 120);
  const endType = String(end?.type || '').slice(0, 40);
  await env.DB.prepare(`INSERT INTO account_holdings_transaction_meta
    (user_id, revision, content_hash, bytes, item_count, updated_at, updated_by_end_id, updated_by_end_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      revision = excluded.revision,
      content_hash = excluded.content_hash,
      bytes = excluded.bytes,
      item_count = excluded.item_count,
      updated_at = excluded.updated_at,
      updated_by_end_id = excluded.updated_by_end_id,
      updated_by_end_type = excluded.updated_by_end_type`)
    .bind(userId, revision, contentHash, bytes, rows.length, updatedAt, endId, endType)
    .run();
  return {
    revision,
    contentHash,
    bytes,
    itemCount: rows.length,
    updatedAt,
    updatedByEndId: endId,
    updatedByEndType: endType
  };
}

export async function writeTransactionRow(env, userId, transactionId, value, {
  expectedRevision = null,
  force = false,
  end = {}
} = {}) {
  const normalized = normalizeTransactionRow(value, transactionId);
  const validation = transactionSerialized(normalized);
  if (!validation.ok) return { invalid: true, ...validation };
  if (normalized.id !== String(transactionId || '').trim()) {
    return { invalid: true, code: 'TRANSACTION_ID_MISMATCH' };
  }

  const current = await readTransactionRow(env, userId, normalized.id);
  const currentRevision = Number(current?.revision || 0);
  if (!force && expectedRevision !== null && expectedRevision !== undefined && Number(expectedRevision) !== currentRevision) {
    return {
      conflict: true,
      currentRevision,
      current: rowToItem(current),
      resource: await readTransactionManifest(env, userId)
    };
  }

  const contentHash = await sha256Hex(canonicalJson(validation.value));
  const unchanged = Boolean(current)
    && Number(current.deleted || 0) === 0
    && String(current.content_hash || '') === contentHash;
  if (unchanged) {
    return {
      unchanged: true,
      rowRevision: currentRevision,
      contentHash: String(current?.content_hash || ''),
      transaction: rowToItem(current),
      resource: await readTransactionManifest(env, userId)
    };
  }

  const revision = currentRevision + 1;
  const updatedAt = nowIso();
  const endId = String(end?.id || '').slice(0, 120);
  const endType = String(end?.type || '').slice(0, 40);
  await env.DB.prepare(`INSERT INTO account_holdings_transactions
    (user_id, transaction_id, revision, content_hash, bytes, payload, deleted, updated_at, updated_by_end_id, updated_by_end_type)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(user_id, transaction_id) DO UPDATE SET
      revision = excluded.revision,
      content_hash = excluded.content_hash,
      bytes = excluded.bytes,
      payload = excluded.payload,
      deleted = 0,
      updated_at = excluded.updated_at,
      updated_by_end_id = excluded.updated_by_end_id,
      updated_by_end_type = excluded.updated_by_end_type`)
    .bind(userId, normalized.id, revision, contentHash, validation.bytes, validation.serialized, updatedAt, endId, endType)
    .run();
  const resource = await rebuildTransactionMeta(env, userId, end);
  return { rowRevision: revision, contentHash, transaction: { ...validation.value, revision }, resource };
}

export async function deleteTransactionRow(env, userId, transactionId, { expectedRevision = null, force = false, end = {} } = {}) {
  const id = String(transactionId || '').trim();
  const current = await readTransactionRow(env, userId, id);
  const currentRevision = Number(current?.revision || 0);
  if (!current || Number(current.deleted || 0) === 1) {
    return { unchanged: true, rowRevision: currentRevision, resource: await readTransactionManifest(env, userId) };
  }
  if (!force && expectedRevision !== null && expectedRevision !== undefined && Number(expectedRevision) !== currentRevision) {
    return { conflict: true, currentRevision, current: rowToItem(current), resource: await readTransactionManifest(env, userId) };
  }
  const revision = currentRevision + 1;
  const updatedAt = nowIso();
  const endId = String(end?.id || '').slice(0, 120);
  const endType = String(end?.type || '').slice(0, 40);
  await env.DB.prepare(`UPDATE account_holdings_transactions SET
    revision = ?, content_hash = '', bytes = 0, payload = '', deleted = 1,
    updated_at = ?, updated_by_end_id = ?, updated_by_end_type = ?
    WHERE user_id = ? AND transaction_id = ?`)
    .bind(revision, updatedAt, endId, endType, userId, id)
    .run();
  const resource = await rebuildTransactionMeta(env, userId, end);
  return { rowRevision: revision, contentHash: '', deleted: true, resource };
}

export function extractLegacyTransactions(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.transactions)) return value.transactions;
  return [];
}

export async function importLegacyTransactions(env, userId, value, { end = {}, overwrite = false } = {}) {
  const rows = extractLegacyTransactions(value);
  const imported = [];
  const skipped = [];
  const rejected = [];
  for (const row of rows) {
    const normalized = normalizeTransactionRow(row);
    if (!normalized) {
      rejected.push({ code: 'TRANSACTION_INVALID' });
      continue;
    }
    const current = await readTransactionRow(env, userId, normalized.id);
    if (!overwrite && current && Number(current.deleted || 0) === 0 && Number(current.revision || 0) > 0) {
      skipped.push(normalized.id);
      continue;
    }
    const result = await writeTransactionRow(env, userId, normalized.id, normalized, { force: true, end });
    if (result.invalid) rejected.push({ id: normalized.id, code: result.code });
    else imported.push({ id: normalized.id, revision: result.rowRevision });
  }
  return { imported, skipped, rejected, importedCount: imported.length };
}

export async function readLegacyTransactionEnvelope(env, userId) {
  const rows = await readTransactionRows(env, userId, { limit: 1000 });
  return {
    transactions: rows.map((item) => item.data),
    snapshotsByCode: {},
    lastNavMeta: { status: 'idle', updatedAt: '', successCount: 0, failureCount: 0, errors: [] },
    migratedFromLegacy: true,
    switchChains: []
  };
}
