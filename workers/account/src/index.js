// ai-dca 账号数据服务 v2：每个功能一组 RESTful 资源，明文存储、逐资源版本号。
// 旧的 /api/sync/latest 整包密文接口保留只读，用于存量迁移与回滚（见 docs/architecture/cn-account-resource-sync-plan.md）。

import {
  MAX_IMPORT_BYTES,
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
    // 冲突只回传这一个资源的服务端版本，客户端按该功能的合并策略就地解决，无需再拉整包。
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

async function handleManifest(request, env, user) {
  const [resources, migration, legacy] = await Promise.all([
    readManifest(env, user.id),
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
    const row = rows.get(descriptor.resource);
    if (!row || row.deleted) continue;
    payload[descriptor.resource] = {
      revision: Number(row.revision || 0),
      updatedAt: String(row.updated_at || ''),
      contentHash: String(row.content_hash || ''),
      data: parsePayload(row)
    };
  }
  return json(request, { serverTime: nowIso(), resources: payload });
}

// 兼容导出：把逐资源明文重新拼回旧 envelope 形态，供本地导出备份与回滚使用。
async function handleExportEnvelope(request, env, user) {
  const rows = await readAllResourceRows(env, user.id);
  const payload = {};
  for (const descriptor of listResourceDescriptors()) {
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

async function handleMigrationStatus(request, env, user) {
  const [migration, legacy, manifest] = await Promise.all([
    readMigration(env, user.id),
    readLegacyBackupMeta(env, user.id),
    readManifest(env, user.id)
  ]);
  const migratedResources = manifest.filter((item) => item.revision > 0 && !item.deleted).map((item) => item.resource);
  const needsMigration = migration.status === 'pending' && legacy.exists && migratedResources.length === 0;
  return json(request, { ...migration, legacy, migratedResources, needsMigration });
}

// 存量导入：客户端解密旧信封后，按资源提交明文；默认不覆盖已存在的资源（幂等、可重试）。
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
    const current = existing.get(descriptor.resource);
    if (!overwrite && current && !current.deleted && Number(current.revision || 0) > 0) {
      skipped.push(descriptor.resource);
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

// 无法解密（换设备 / 忘记安全密码）时的兜底：标记跳过，旧密文保留在 backups 表里不删。
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

async function handleResourceRequest(request, env, user, route, url) {
  const { descriptor } = route;
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

async function handleResourceItemRequest(request, env, user, route) {
  const { descriptor, itemId } = route;
  const row = await readResourceRow(env, user.id, descriptor.resource);
  const current = parsePayload(row);

  if (request.method === 'GET') {
    const list = Array.isArray(current) ? current : [];
    const item = list.find((entry) => String(entry?.id || '') === itemId) || null;
    if (!item) throw new HttpError(404, 'ITEM_NOT_FOUND', '条目不存在');
    return json(request, { resource: descriptor.resource, revision: Number(row?.revision || 0), item });
  }

  if (request.method === 'PUT' || request.method === 'PATCH') {
    const body = await readBody(request);
    const patched = upsertResourceItem(descriptor, current, itemId, body?.item ?? body?.data);
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
    const patched = removeResourceItem(descriptor, current, itemId);
    if (!patched.changed) throw new HttpError(404, 'ITEM_NOT_FOUND', '条目不存在');
    const validation = validateResourcePayload(descriptor, patched.data);
    if (!validation.ok) throw new HttpError(400, validation.code, validation.message);
    const result = await writeResource(env, user.id, descriptor, {
      data: patched.data,
      serialized: validation.serialized,
      force: true
    });
    return writeResultResponse(request, descriptor, result);
  }

  throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const route = parseAccountPath(url.pathname);
    if (route.kind === 'unknown' || route.kind === 'root') {
      return json(request, { error: 'NOT_FOUND', message: '接口不存在' }, 404);
    }
    if (route.kind === 'health') {
      return json(request, { ok: true, service: 'ai-dca-account', encryption: 'none', time: nowIso() });
    }

    try {
      await ensureSchema(env);
      const user = await requireUser(request, env);

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
      if (route.kind === 'resource') return await handleResourceRequest(request, env, user, route, url);
      if (route.kind === 'resource-item') return await handleResourceItemRequest(request, env, user, route);
      return json(request, { error: 'NOT_FOUND', message: '接口不存在' }, 404);
    } catch (err) {
      if (err instanceof HttpError) {
        return json(request, { error: err.code, message: err.message }, err.status);
      }
      console.error('[account] 未处理异常', err);
      return json(request, { error: 'INTERNAL_ERROR', message: '服务异常，请稍后重试' }, 500);
    }
  }
};
