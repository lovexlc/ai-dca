// ai-dca 账号数据服务 v2：普通资源逐资源同步；持仓交易使用真正的 D1 行表。
// 旧的 /api/sync/latest 整包密文接口保留只读，仅用于存量迁移与回滚。

import {
  MAX_IMPORT_BYTES,
  MAX_RESOURCE_BYTES,
  getResourceDescriptor,
  listResourceDescriptors,
  measureBytes,
  parseAccountPath,
  validateResourcePayload
} from './catalog.js';
import { applyResourcePatch, removeResourceItem, upsertResourceItem } from './patch.js';
import {
  ensureSchema,
  nowIso,
  parsePayload,
  readAllResourceRows,
  readHistory,
  readLegacyBackupMeta,
  readManifest,
  readMigration,
  readResourceRow,
  sha256Hex,
  writeMigration,
  writeResource
} from './store.js';
import {
  deleteResourceRecord,
  readResourceRecord,
  writeResourceRecord
} from './recordStore.js';
import {
  HOLDINGS_LEDGER_RESOURCE,
  deleteTransactionRow,
  ensureTransactionSchema,
  importLegacyTransactions,
  readLegacyTransactionEnvelope,
  readTransactionManifest,
  readTransactionRow,
  readTransactionRows,
  writeTransactionRow
} from './transactions.js';

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function corsHeaders(request) {
  return {
    'access-control-allow-origin': request.headers.get('origin') || '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, if-match',
    'access-control-expose-headers': 'etag, x-resource-revision',
    'access-control-max-age': '86400',
    vary: 'origin'
  };
}

function json(request, data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data ?? {}), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(request),
      ...extraHeaders
    }
  });
}

async function readBody(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求体不是合法 JSON');
  }
}

async function requireUser(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'UNAUTHORIZED', '请先登录账户');
  const tokenHash = await sha256Hex(token);
  const row = await env.DB
    .prepare('SELECT s.user_id AS userId, s.expires_at AS expiresAt, u.username AS username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .bind(tokenHash)
    .first();
  if (!row) throw new HttpError(401, 'UNAUTHORIZED', '登录状态已失效，请重新登录');
  if (Date.parse(String(row.expiresAt || '')) <= Date.now()) throw new HttpError(401, 'SESSION_EXPIRED', '登录已过期，请重新登录');
  return { id: String(row.userId), username: String(row.username || '') };
}

function readExpectedRevision(request, body = {}) {
  const header = request.headers.get('if-match');
  if (header) {
    const normalized = header.replace(/^W\//, '').replace(/"/g, '').trim();
    if (normalized === '*') return null;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  const fromBody = body?.baseRevision ?? body?.expectedRevision;
  if (fromBody === null || fromBody === undefined || fromBody === '') return null;
  const parsed = Number(fromBody);
  return Number.isFinite(parsed) ? parsed : null;
}

function resourceResponse(request, descriptor, row) {
  const revision = Number(row?.revision || 0);
  return json(request, {
    resource: descriptor.resource,
    feature: descriptor.feature,
    merge: descriptor.merge,
    revision,
    contentHash: String(row?.content_hash || ''),
    updatedAt: String(row?.updated_at || ''),
    updatedByEndId: String(row?.updated_by_end_id || ''),
    updatedByEndType: String(row?.updated_by_end_type || ''),
    deleted: Boolean(row?.deleted),
    data: parsePayload(row)
  }, 200, { etag: `"${revision}"`, 'x-resource-revision': String(revision) });
}

function writeResultResponse(request, descriptor, result) {
  if (result.conflict) {
    return json(request, {
      error: 'REVISION_MISMATCH',
      message: '该功能的云端数据已更新，请合并后重试',
      resource: descriptor.resource,
      merge: descriptor.merge,
      currentRevision: result.currentRevision,
      updatedAt: result.updatedAt,
      contentHash: result.contentHash,
      data: result.data
    }, 409);
  }
  const revision = Number(result.revision || 0);
  return json(request, {
    resource: descriptor.resource,
    feature: descriptor.feature,
    revision,
    updatedAt: result.updatedAt,
    contentHash: result.contentHash,
    bytes: result.bytes ?? 0,
    itemCount: result.itemCount ?? 0,
    unchanged: Boolean(result.unchanged),
    deleted: Boolean(result.deleted)
  }, 200, { etag: `"${revision}"`, 'x-resource-revision': String(revision) });
}

async function readCombinedManifest(env, userId) {
  const [resources, transaction] = await Promise.all([
    readManifest(env, userId),
    readTransactionManifest(env, userId)
  ]);
  return resources.map((item) => item.resource === HOLDINGS_LEDGER_RESOURCE ? transaction : item);
}

async function handleManifest(request, env, user) {
  const [resources, migration, legacy] = await Promise.all([
    readCombinedManifest(env, user.id),
    readMigration(env, user.id),
    readLegacyBackupMeta(env, user.id)
  ]);
  const populated = resources.filter((item) => item.revision > 0 && !item.deleted);
  return json(request, {
    username: user.username,
    serverTime: nowIso(),
    resourceCount: populated.length,
    resources,
    migration: { ...migration, legacy }
  });
}

async function handleBundle(request, env, user, url) {
  const requested = String(url.searchParams.get('resources') || '').split(',').map((item) => item.trim()).filter(Boolean);
  const descriptors = requested.length
    ? requested.map((name) => getResourceDescriptor(name)).filter(Boolean)
    : listResourceDescriptors();
  if (requested.length && descriptors.length !== requested.length) {
    throw new HttpError(400, 'UNKNOWN_RESOURCE', '存在未知的资源名');
  }
  const rows = await readAllResourceRows(env, user.id);
  const payload = {};
  for (const descriptor of descriptors) {
    if (descriptor.resource === HOLDINGS_LEDGER_RESOURCE) {
      const meta = await readTransactionManifest(env, user.id);
      const envelope = await readLegacyTransactionEnvelope(env, user.id);
      if (meta.revision > 0) {
        payload[descriptor.resource] = {
          revision: meta.revision,
          updatedAt: meta.updatedAt,
          contentHash: meta.contentHash,
          data: envelope
        };
      }
      continue;
    }
    const row = rows.get(descriptor.resource);
    if (!row || row.deleted || descriptor.resource === 'holdings/position-snapshot') continue;
    payload[descriptor.resource] = {
      revision: Number(row.revision || 0),
      updatedAt: String(row.updated_at || ''),
      contentHash: String(row.content_hash || ''),
      data: parsePayload(row)
    };
  }
  return json(request, { serverTime: nowIso(), resources: payload });
}

async function handleExportEnvelope(request, env, user) {
  const rows = await readAllResourceRows(env, user.id);
  const payload = {};
  const transactionMeta = await readTransactionManifest(env, user.id);
  const transactionEnvelope = await readLegacyTransactionEnvelope(env, user.id);
  if (transactionMeta.revision > 0 && transactionEnvelope.transactions.length) {
    payload.aiDcaFundHoldingsLedger = JSON.stringify(transactionEnvelope);
  }
  for (const descriptor of listResourceDescriptors()) {
    if (descriptor.resource === HOLDINGS_LEDGER_RESOURCE || descriptor.resource === 'holdings/position-snapshot') continue;
    const row = rows.get(descriptor.resource);
    if (!row || row.deleted) continue;
    const data = parsePayload(row);
    if (data === null || data === undefined) continue;
    payload[descriptor.legacyKey] = JSON.stringify(data);
  }
  const keys = Object.keys(payload).sort();
  return json(request, {
    version: 1,
    source: 'ai-dca',
    exportedAt: nowIso(),
    keyCount: keys.length,
    keys,
    payload
  });
}

function normalizeMigrationState(migration = {}, legacy = {}) {
  const rawStatus = String(migration?.status || 'pending').trim().toLowerCase();
  const legacyExists = Boolean(legacy?.exists);
  const status = rawStatus === 'pending' && !legacyExists ? 'no-legacy' : rawStatus;
  return {
    ...migration,
    status,
    legacy,
    needsMigration: status === 'pending' && legacyExists
  };
}

async function readLegacyMigrationGate(env, userId) {
  const [migration, legacy] = await Promise.all([
    readMigration(env, userId),
    readLegacyBackupMeta(env, userId)
  ]);
  return normalizeMigrationState(migration, legacy);
}

async function assertLegacyMigrationSettled(env, userId) {
  const migration = await readLegacyMigrationGate(env, userId);
  if (migration.status === 'imported' || migration.status === 'skipped' || migration.status === 'no-legacy') {
    return migration;
  }
  throw new HttpError(409, 'LEGACY_MIGRATION_REQUIRED', '账号旧数据尚未迁移，暂不允许访问新账号资源');
}

async function handleMigrationStatus(request, env, user) {
  const [migration, manifest] = await Promise.all([
    readLegacyMigrationGate(env, user.id),
    readCombinedManifest(env, user.id)
  ]);
  const migratedResources = manifest.filter((item) => item.revision > 0 && !item.deleted).map((item) => item.resource);
  return json(request, { ...migration, migratedResources });
}

async function handleMigrationImport(request, env, user, body) {
  const resources = body?.resources && typeof body.resources === 'object' ? body.resources : null;
  if (!resources) throw new HttpError(400, 'RESOURCES_REQUIRED', '缺少 resources 字段');
  const totalBytes = measureBytes(JSON.stringify(resources));
  if (totalBytes > MAX_IMPORT_BYTES) throw new HttpError(413, 'IMPORT_TOO_LARGE', '导入数据过大，请分批迁移');

  const overwrite = Boolean(body?.overwrite);
  const end = body?.end || {};
  const existing = await readAllResourceRows(env, user.id);
  const imported = [];
  const skipped = [];
  const rejected = [];

  for (const [name, value] of Object.entries(resources)) {
    const descriptor = getResourceDescriptor(name);
    if (!descriptor) {
      rejected.push({ resource: name, code: 'UNKNOWN_RESOURCE' });
      continue;
    }
    if (descriptor.resource === HOLDINGS_LEDGER_RESOURCE) {
      const result = await importLegacyTransactions(env, user.id, value, { end, overwrite });
      const meta = await readTransactionManifest(env, user.id);
      imported.push({ resource: descriptor.resource, revision: meta.revision, itemCount: result.importedCount });
      skipped.push(...result.skipped.map((id) => ({ resource: descriptor.resource, id })));
      rejected.push(...result.rejected.map((item) => ({ resource: descriptor.resource, ...item })));
      continue;
    }
    if (descriptor.resource === 'holdings/position-snapshot') {
      skipped.push({ resource: descriptor.resource, reason: 'deprecated_snapshot' });
      continue;
    }
    const current = existing.get(descriptor.resource);
    if (!overwrite && current && !current.deleted && Number(current.revision || 0) > 0) {
      skipped.push({ resource: descriptor.resource, reason: 'exists' });
      continue;
    }
    const validation = validateResourcePayload(descriptor, value);
    if (!validation.ok) {
      rejected.push({ resource: descriptor.resource, code: validation.code, message: validation.message });
      continue;
    }
    const result = await writeResource(env, user.id, descriptor, {
      data: value,
      serialized: validation.serialized,
      force: true,
      end
    });
    imported.push({ resource: descriptor.resource, revision: result.revision, unchanged: Boolean(result.unchanged) });
  }

  const migration = await writeMigration(env, user.id, {
    status: 'imported',
    source: String(body?.source || 'client-decrypt').slice(0, 60),
    legacyVersion: Number(body?.legacyVersion || 0),
    importedResources: imported.length,
    note: String(body?.note || '')
  });
  return json(request, { migration, imported, skipped, rejected });
}

async function handleMigrationSkip(request, env, user, body) {
  const migration = await writeMigration(env, user.id, {
    status: 'skipped',
    source: String(body?.source || 'local-fresh').slice(0, 60),
    legacyVersion: Number(body?.legacyVersion || 0),
    importedResources: 0,
    note: String(body?.reason || '用户选择用本机数据重新开始，旧密文保留')
  });
  return json(request, { migration });
}

async function handleHoldingsLedgerResourceRequest(request, env, user, body = null) {
  if (request.method === 'GET') {
    const resource = await readTransactionManifest(env, user.id);
    const rows = await readTransactionRows(env, user.id, { limit: 1000 });
    return json(request, { resource: HOLDINGS_LEDGER_RESOURCE, ...resource, data: { transactions: rows.map((item) => item.data), snapshotsByCode: {} } });
  }
  if (request.method === 'PUT') {
    const result = await importLegacyTransactions(env, user.id, body?.data ?? body, {
      end: body?.end || {},
      overwrite: Boolean(body?.force)
    });
    const resource = await readTransactionManifest(env, user.id);
    return json(request, { resource: HOLDINGS_LEDGER_RESOURCE, ...resource, imported: result.imported, skipped: result.skipped, rejected: result.rejected });
  }
  if (request.method === 'DELETE') {
    const rows = await readTransactionRows(env, user.id, { limit: 1000 });
    for (const item of rows) await deleteTransactionRow(env, user.id, item.id, { force: true, end: body?.end || {} });
    return json(request, { resource: HOLDINGS_LEDGER_RESOURCE, ...(await readTransactionManifest(env, user.id)), deleted: true });
  }
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
}

function transactionItemResponse(request, result, id = '') {
  if (result.conflict) {
    return json(request, {
      error: 'REVISION_MISMATCH',
      message: '该交易行已在其他设备更新，请重新合并后重试',
      resource: HOLDINGS_LEDGER_RESOURCE,
      id,
      currentRevision: result.currentRevision,
      current: result.current,
      resourceMeta: result.resource
    }, 409);
  }
  const row = result.transaction || null;
  return json(request, {
    resource: HOLDINGS_LEDGER_RESOURCE,
    id: id || row?.id || '',
    rowRevision: Number(result.rowRevision || row?.revision || 0),
    transaction: row,
    contentHash: String(result.contentHash || ''),
    deleted: Boolean(result.deleted),
    unchanged: Boolean(result.unchanged),
    resourceMeta: result.resource
  }, 200, { etag: `"${Number(result.rowRevision || row?.revision || 0)}"` });
}

async function handleHoldingTransactionCollection(request, env, user, url) {
  if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '交易行集合只支持 GET');
  const resource = await readTransactionManifest(env, user.id);
  const rows = await readTransactionRows(env, user.id, {
    limit: url.searchParams.get('limit'),
    offset: url.searchParams.get('cursor')
  });
  const offset = Math.max(Number(url.searchParams.get('cursor') || 0), 0);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 500, 1), 1000);
  return json(request, {
    resource: HOLDINGS_LEDGER_RESOURCE,
    ...resource,
    rows,
    nextCursor: rows.length >= limit ? String(offset + rows.length) : ''
  });
}

async function handleHoldingTransactionItem(request, env, user, route) {
  const id = String(route.itemId || '').trim();
  const current = await readTransactionRow(env, user.id, id);
  if (request.method === 'GET') {
    if (!current || Number(current.deleted || 0) === 1) throw new HttpError(404, 'ITEM_NOT_FOUND', '交易行不存在');
    let data = null;
    try { data = JSON.parse(String(current.payload || 'null')); } catch { data = null; }
    return json(request, { resource: HOLDINGS_LEDGER_RESOURCE, id, revision: Number(current.revision || 0), data });
  }
  const body = await readBody(request);
  if (request.method === 'PUT' || request.method === 'PATCH') {
    const data = body?.data ?? body?.item ?? body;
    const result = await writeTransactionRow(env, user.id, id, data, {
      expectedRevision: readExpectedRevision(request, body),
      force: Boolean(body?.force),
      end: body?.end || {}
    });
    if (result.invalid) throw new HttpError(400, result.code, '交易行数据无效');
    return transactionItemResponse(request, result, id);
  }
  if (request.method === 'DELETE') {
    const result = await deleteTransactionRow(env, user.id, id, {
      expectedRevision: readExpectedRevision(request, body),
      force: Boolean(body?.force),
      end: body?.end || {}
    });
    return transactionItemResponse(request, result, id);
  }
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
}

async function handleResourceRequest(request, env, user, route, url) {
  const { descriptor } = route;
  if (descriptor.resource === HOLDINGS_LEDGER_RESOURCE) {
    return handleHoldingsLedgerResourceRequest(request, env, user, request.method === 'GET' ? null : await readBody(request));
  }
  if (request.method === 'GET') {
    if (url.searchParams.get('history') === '1') {
      const history = await readHistory(env, user.id, descriptor.resource, url.searchParams.get('limit'));
      return json(request, { resource: descriptor.resource, history });
    }
    const row = await readResourceRow(env, user.id, descriptor.resource);
    return resourceResponse(request, descriptor, row);
  }
  if (request.method === 'PUT') {
    const body = await readBody(request);
    const validation = validateResourcePayload(descriptor, body?.data);
    if (!validation.ok) throw new HttpError(400, validation.code, validation.message);
    const result = await writeResource(env, user.id, descriptor, {
      data: body.data,
      serialized: validation.serialized,
      expectedRevision: readExpectedRevision(request, body),
      force: Boolean(body?.force),
      end: body?.end || {}
    });
    return writeResultResponse(request, descriptor, result);
  }
  if (request.method === 'PATCH') {
    const body = await readBody(request);
    const row = await readResourceRow(env, user.id, descriptor.resource);
    const expectedRevision = readExpectedRevision(request, body);
    if (expectedRevision !== null && expectedRevision !== Number(row?.revision || 0)) {
      return writeResultResponse(request, descriptor, {
        conflict: true,
        currentRevision: Number(row?.revision || 0),
        updatedAt: String(row?.updated_at || ''),
        contentHash: String(row?.content_hash || ''),
        data: parsePayload(row)
      });
    }
    const patched = applyResourcePatch(descriptor, parsePayload(row), body?.patch || body);
    const validation = validateResourcePayload(descriptor, patched.data);
    if (!validation.ok) throw new HttpError(400, validation.code, validation.message);
    const result = await writeResource(env, user.id, descriptor, {
      data: patched.data,
      serialized: validation.serialized,
      force: true,
      end: body?.end || {}
    });
    return writeResultResponse(request, descriptor, result);
  }
  if (request.method === 'DELETE') {
    const result = await writeResource(env, user.id, descriptor, { deleted: true, force: true });
    return writeResultResponse(request, descriptor, { ...result, deleted: true });
  }
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
}

function resourceRecordResponse(request, descriptor, id, result) {
  if (result.conflict) {
    return json(request, {
      error: 'REVISION_MISMATCH',
      message: '该记录已在其他设备更新，请合并后重试',
      resource: descriptor.resource,
      id,
      currentRevision: result.currentRevision,
      current: result.current,
      resource: result.resource
    }, 409);
  }
  if (result.notFound) throw new HttpError(404, 'ITEM_NOT_FOUND', '记录不存在');
  const record = result.record || null;
  const resourceRevision = Number(result.resource?.revision || 0);
  return json(request, {
    resource: descriptor.resource,
    id,
    revision: Number(result.recordRevision || record?.revision || 0),
    recordRevision: Number(result.recordRevision || record?.revision || 0),
    resourceRevision,
    data: record?.data ?? null,
    deleted: Boolean(result.deleted),
    unchanged: Boolean(result.unchanged),
    contentHash: String(record?.contentHash || '')
  }, 200, { etag: `"${Number(result.recordRevision || record?.revision || 0)}"` });
}

async function handleResourceItemRequest(request, env, user, route) {
  if (route.descriptor.resource === HOLDINGS_LEDGER_RESOURCE) return handleHoldingTransactionItem(request, env, user, route);
  const { descriptor, itemId } = route;
  if (request.method === 'GET') {
    const record = await readResourceRecord(env, user.id, descriptor, itemId);
    if (!record || record.deleted) throw new HttpError(404, 'ITEM_NOT_FOUND', '记录不存在');
    return json(request, {
      resource: descriptor.resource,
      id: record.id,
      revision: record.revision,
      parentId: record.parentId,
      kind: record.kind,
      position: record.position,
      data: record.data
    }, 200, { etag: `"${record.revision}"` });
  }
  const body = await readBody(request);
  if (request.method === 'PUT' || request.method === 'PATCH') {
    const current = await readResourceRecord(env, user.id, descriptor, itemId);
    let data = body?.item ?? body?.data;
    if (request.method === 'PATCH' && body?.patch) {
      const patched = applyResourcePatch(descriptor, current?.data, body.patch);
      data = patched.data;
    }
    if (data === undefined) throw new HttpError(400, 'PAYLOAD_REQUIRED', '缺少记录数据');
    let serialized;
    try { serialized = JSON.stringify(data); } catch { serialized = undefined; }
    if (serialized === undefined) throw new HttpError(400, 'PAYLOAD_UNSERIALIZABLE', '记录无法序列化为 JSON');
    if (measureBytes(serialized) > MAX_RESOURCE_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '单条记录过大');
    const result = await writeResourceRecord(env, user.id, descriptor, itemId, data, {
      parentId: body?.parentId ?? current?.parentId ?? '',
      kind: body?.kind ?? current?.kind ?? 'item',
      position: body?.position ?? current?.position ?? 0,
      expectedRevision: readExpectedRevision(request, body),
      force: Boolean(body?.force),
      end: body?.end || {}
    });
    return resourceRecordResponse(request, descriptor, itemId, result);
  }
  if (request.method === 'DELETE') {
    const result = await deleteResourceRecord(env, user.id, descriptor, itemId, {
      expectedRevision: readExpectedRevision(request, body),
      force: Boolean(body?.force),
      end: body?.end || {}
    });
    return resourceRecordResponse(request, descriptor, itemId, result);
  }
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
}

function parseRequestPath(pathname) {
  const normalized = String(pathname || '').replace(/\/+$/, '');
  const match = normalized.match(/^\/api\/account\/v1\/([^/]+)\/([^/]+)\/items$/);
  if (match) {
    const descriptor = getResourceDescriptor(`${match[1]}/${match[2]}`);
    if (descriptor?.resource === HOLDINGS_LEDGER_RESOURCE) return { kind: 'holding-transaction-items', descriptor };
  }
  return parseAccountPath(pathname);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });

    const route = parseRequestPath(url.pathname);
    if (route.kind === 'unknown' || route.kind === 'root') return json(request, { error: 'NOT_FOUND', message: '接口不存在' }, 404);
    if (route.kind === 'health') return json(request, { ok: true, service: 'ai-dca-account', encryption: 'none', time: nowIso() });

    try {
      await ensureSchema(env);
      await ensureTransactionSchema(env);
      const user = await requireUser(request, env);

      // migrations/legacy 是账号资源的唯一门禁。迁移查询/导入/跳过之外，
      // manifest、bundle、资源与交易行接口都必须在服务端再次确认已 settled。
      if (route.kind !== 'migration' && route.kind !== 'migration-skip') {
        await assertLegacyMigrationSettled(env, user.id);
      }

      if (route.kind === 'manifest') {
        if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
        return await handleManifest(request, env, user);
      }
      if (route.kind === 'bundle') {
        if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
        return await handleBundle(request, env, user, url);
      }
      if (route.kind === 'export-envelope') {
        if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
        return await handleExportEnvelope(request, env, user);
      }
      if (route.kind === 'migration') {
        if (request.method === 'GET') return await handleMigrationStatus(request, env, user);
        if (request.method === 'POST') return await handleMigrationImport(request, env, user, await readBody(request));
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
      }
      if (route.kind === 'migration-skip') {
        if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
        return await handleMigrationSkip(request, env, user, await readBody(request));
      }
      if (route.kind === 'holding-transaction-items') return await handleHoldingTransactionCollection(request, env, user, url);
      if (route.kind === 'resource') return await handleResourceRequest(request, env, user, route, url);
      if (route.kind === 'resource-item') return await handleResourceItemRequest(request, env, user, route);
      return json(request, { error: 'NOT_FOUND', message: '接口不存在' }, 404);
    } catch (err) {
      if (err instanceof HttpError) return json(request, { error: err.code, message: err.message }, err.status);
      console.error('[account] 未处理异常', err);
      return json(request, { error: 'INTERNAL_ERROR', message: '服务异常，请稍后重试' }, 500);
    }
  }
};
