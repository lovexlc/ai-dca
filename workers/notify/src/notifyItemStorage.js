// Feature-level row storage for notification collections.
// notify_user_records keeps client/channel/state rows; these tables keep
// every plan, DCA entry, alert rule, and registration link as an independent row.

import { normalizeSettings } from './clientSettings.js';
import {
  ensureNotifyRowSchema,
  hasNotifyRowStorage,
  loadSettingsWithLegacy,
  readSettingsFromRows,
  writeSettingsToRows
} from './notifyRowStorage.js';

const FEATURE_TABLE = 'notify_user_feature_items';
const LINK_TABLE = 'notify_registration_links';
const MIGRATION_ID = 'notify-feature-items-v2';

function nowIso() { return new Date().toISOString(); }
function text(value = '', max = 240) { return String(value ?? '').trim().slice(0, max); }
function serialize(value) { try { return JSON.stringify(value ?? {}); } catch { return '{}'; } }
function parse(value) { if (value && typeof value === 'object') return value; try { return JSON.parse(String(value || '{}')); } catch { return {}; } }

function ownerForClient(client = {}) {
  const explicit = text(client?.ownerUserId, 96);
  if (explicit) return explicit;
  const accountClientId = text(client?.accountClientId, 120);
  if (accountClientId.startsWith('account:')) return accountClientId.slice('account:'.length);
  const clientId = text(client?.clientId, 120);
  if (clientId.startsWith('account:')) return clientId.slice('account:'.length);
  return `legacy:${clientId || 'unknown'}`;
}

function clientIdOf(client = {}) { return text(client?.clientId, 120); }

function itemIdOf(value, index, prefix) {
  return text(value?.id || value?.ruleId || value?.code || value?.symbol) || `${prefix}-${index + 1}`;
}

function addFeatureRows(rows, client, feature, values, { active = false } = {}) {
  const owner = ownerForClient(client);
  const clientId = clientIdOf(client);
  for (const [index, value] of (Array.isArray(values) ? values : []).entries()) {
    if (!value || typeof value !== 'object') continue;
    rows.push({
      owner,
      clientId,
      feature,
      itemId: active ? 'active' : itemIdOf(value, index, feature),
      kind: active ? 'active' : 'item',
      position: index,
      payload: value
    });
  }
}

export function splitFeatureItems(settings = {}, options = {}) {
  const normalized = options?.preNormalized === true ? settings : normalizeSettings(settings);
  const rows = [];
  for (const client of Object.values(normalized.clients || {})) {
    const payload = client?.payload && typeof client.payload === 'object' ? client.payload : {};
    addFeatureRows(rows, client, 'plans', payload.plans);
    addFeatureRows(rows, client, 'dca', payload.dca ? [payload.dca] : [], { active: true });
    addFeatureRows(rows, client, 'dca-list', payload.dcaList);
    addFeatureRows(rows, client, 'market-alerts', payload.marketAlerts);
    addFeatureRows(rows, client, 'holding-alerts', payload.holdingAlerts);
  }
  return rows;
}

export function splitRegistrationLinks(settings = {}, options = {}) {
  const normalized = options?.preNormalized === true ? settings : normalizeSettings(settings);
  const clients = normalized.clients || {};
  const rows = [];
  for (const registration of Array.isArray(normalized.gcmRegistrations) ? normalized.gcmRegistrations : []) {
    const registrationId = text(registration?.deviceInstallationId || registration?.id, 160);
    if (!registrationId) continue;
    const pairedClients = Array.isArray(registration?.pairedClients) ? registration.pairedClients : [];
    for (const [index, paired] of pairedClients.entries()) {
      const clientId = text(typeof paired === 'string' ? paired : paired?.clientId, 120);
      if (!clientId) continue;
      const client = clients[clientId];
      rows.push({
        owner: client ? ownerForClient(client) : `legacy:${clientId}`,
        registrationId,
        clientId,
        position: index,
        payload: typeof paired === 'object' && paired ? paired : { clientId }
      });
    }
  }
  return rows;
}

export function clearAggregateFeatureData(settings = {}) {
  // 写入链路上的输入已是 normalizeSettings 产物；跳过入口归一化省一次全量拷贝，
  // 形状由末尾的 normalize 兜底。
  const source = settings && typeof settings === 'object' ? settings : {};
  const clients = {};
  for (const [clientId, sourceClient] of Object.entries(source.clients || {})) {
    const client = { ...sourceClient, payload: { ...(sourceClient.payload || {}) } };
    client.payload.plans = [];
    client.payload.dca = null;
    client.payload.dcaList = [];
    client.payload.marketAlerts = [];
    client.payload.holdingAlerts = [];
    clients[clientId] = client;
  }
  const gcmRegistrations = (Array.isArray(source.gcmRegistrations) ? source.gcmRegistrations : []).map((registration) => ({
    ...registration,
    pairedClients: []
  }));
  return normalizeSettings({ ...source, clients, gcmRegistrations });
}

async function ensureSchema(env) {
  if (!hasNotifyRowStorage(env)) throw new Error('通知行存储缺少 SYNC_DB 绑定。');
  await ensureNotifyRowSchema(env);
  await env.SYNC_DB.prepare(`CREATE TABLE IF NOT EXISTS ${FEATURE_TABLE} (
    owner_user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    feature TEXT NOT NULL,
    item_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'item',
    position INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_user_id, client_id, feature, item_id)
  )`).run();
  await env.SYNC_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notify_feature_items_lookup
    ON ${FEATURE_TABLE} (owner_user_id, client_id, feature, deleted, position)`).run();
  await env.SYNC_DB.prepare(`CREATE TABLE IF NOT EXISTS ${LINK_TABLE} (
    owner_user_id TEXT NOT NULL,
    registration_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_user_id, registration_id, client_id)
  )`).run();
  await env.SYNC_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notify_registration_links_lookup
    ON ${LINK_TABLE} (owner_user_id, registration_id, deleted, position)`).run();
}

async function readRows(env) {
  await ensureSchema(env);
  const result = await env.SYNC_DB.prepare(`SELECT * FROM ${FEATURE_TABLE}
    WHERE deleted = 0 ORDER BY position ASC, item_id ASC`).all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function readLinks(env) {
  await ensureSchema(env);
  const result = await env.SYNC_DB.prepare(`SELECT * FROM ${LINK_TABLE}
    WHERE deleted = 0 ORDER BY position ASC, client_id ASC`).all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function readMigration(env) {
  await ensureSchema(env);
  return env.SYNC_DB.prepare(`SELECT payload FROM notify_user_records
    WHERE owner_user_id = 'global' AND record_type = 'migration' AND record_id = ?`)
    .bind(MIGRATION_ID).first();
}

async function writeMigration(env, status = 'done') {
  await ensureSchema(env);
  const timestamp = nowIso();
  const payload = serialize({ status, completedAt: timestamp });
  await env.SYNC_DB.prepare(`INSERT INTO notify_user_records
    (owner_user_id, record_type, record_id, payload, revision, created_at, updated_at)
    VALUES ('global', 'migration', ?, ?, 1, ?, ?)
    ON CONFLICT(owner_user_id, record_type, record_id) DO UPDATE SET
      payload = excluded.payload,
      revision = notify_user_records.revision + 1,
      updated_at = excluded.updated_at`)
    .bind(MIGRATION_ID, payload, timestamp, timestamp).run();
}

async function writeFeatureRows(env, rows) {
  await ensureSchema(env);
  // 只取合并需要的键列与 revision/deleted，避免把全表 payload（含软删行）拉进内存。
  const existingResult = await env.SYNC_DB.prepare(`SELECT owner_user_id, client_id, feature, item_id, revision, deleted FROM ${FEATURE_TABLE}`).all();
  const existingByKey = new Map();
  for (const item of Array.isArray(existingResult?.results) ? existingResult.results : []) {
    existingByKey.set(`${item.owner_user_id}\u0000${item.client_id}\u0000${item.feature}\u0000${item.item_id}`, item);
  }
  const incoming = new Set(rows.map((row) => `${row.owner}\u0000${row.clientId}\u0000${row.feature}\u0000${row.itemId}`));
  const timestamp = nowIso();
  // 80 行一批边构建边执行，避免全量 payload 字符串长期驻留内存。
  for (let index = 0; index < rows.length; index += 80) {
    const statements = rows.slice(index, index + 80).map((row) => {
      const current = existingByKey.get(`${row.owner}\u0000${row.clientId}\u0000${row.feature}\u0000${row.itemId}`);
      return env.SYNC_DB.prepare(`INSERT INTO ${FEATURE_TABLE}
      (owner_user_id, client_id, feature, item_id, kind, position, payload, revision, deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(owner_user_id, client_id, feature, item_id) DO UPDATE SET
        kind = excluded.kind,
        position = excluded.position,
        payload = excluded.payload,
        revision = ${FEATURE_TABLE}.revision + 1,
        deleted = 0,
        updated_at = excluded.updated_at`)
      .bind(row.owner, row.clientId, row.feature, row.itemId, row.kind, row.position, serialize(row.payload), Number(current?.revision || 0) + 1, timestamp, timestamp);
    });
    if (statements.length) await env.SYNC_DB.batch(statements);
  }
  const deleteStatements = [];
  for (const [key, current] of existingByKey) {
    if (!incoming.has(key) && Number(current.deleted || 0) === 0) {
      deleteStatements.push(env.SYNC_DB.prepare(`UPDATE ${FEATURE_TABLE} SET
        revision = revision + 1, deleted = 1, payload = '{}', updated_at = ?
        WHERE owner_user_id = ? AND client_id = ? AND feature = ? AND item_id = ?`)
        .bind(timestamp, current.owner_user_id, current.client_id, current.feature, current.item_id));
    }
  }
  for (let index = 0; index < deleteStatements.length; index += 80) {
    await env.SYNC_DB.batch(deleteStatements.slice(index, index + 80));
  }
}

async function writeRegistrationLinks(env, rows) {
  await ensureSchema(env);
  // 与 writeFeatureRows 同理：只取键列、Map 索引、分批执行。
  const existingResult = await env.SYNC_DB.prepare(`SELECT owner_user_id, registration_id, client_id, revision, deleted FROM ${LINK_TABLE}`).all();
  const existingByKey = new Map();
  for (const item of Array.isArray(existingResult?.results) ? existingResult.results : []) {
    existingByKey.set(`${item.owner_user_id}\u0000${item.registration_id}\u0000${item.client_id}`, item);
  }
  const incoming = new Set(rows.map((row) => `${row.owner}\u0000${row.registrationId}\u0000${row.clientId}`));
  const timestamp = nowIso();
  for (let index = 0; index < rows.length; index += 80) {
    const statements = rows.slice(index, index + 80).map((row) => {
      const current = existingByKey.get(`${row.owner}\u0000${row.registrationId}\u0000${row.clientId}`);
      return env.SYNC_DB.prepare(`INSERT INTO ${LINK_TABLE}
      (owner_user_id, registration_id, client_id, position, payload, revision, deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(owner_user_id, registration_id, client_id) DO UPDATE SET
        position = excluded.position,
        payload = excluded.payload,
        revision = ${LINK_TABLE}.revision + 1,
        deleted = 0,
        updated_at = excluded.updated_at`)
      .bind(row.owner, row.registrationId, row.clientId, row.position, serialize(row.payload), Number(current?.revision || 0) + 1, timestamp, timestamp);
    });
    if (statements.length) await env.SYNC_DB.batch(statements);
  }
  const deleteStatements = [];
  for (const [key, current] of existingByKey) {
    if (!incoming.has(key) && Number(current.deleted || 0) === 0) {
      deleteStatements.push(env.SYNC_DB.prepare(`UPDATE ${LINK_TABLE} SET
        revision = revision + 1, deleted = 1, payload = '{}', updated_at = ?
        WHERE owner_user_id = ? AND registration_id = ? AND client_id = ?`)
        .bind(timestamp, current.owner_user_id, current.registration_id, current.client_id));
    }
  }
  for (let index = 0; index < deleteStatements.length; index += 80) {
    await env.SYNC_DB.batch(deleteStatements.slice(index, index + 80));
  }
}

async function ensureFeatureMigration(env, seedSettings = {}) {
  await ensureSchema(env);
  const marker = await readMigration(env);
  if (parse(marker?.payload).status === 'done') return false;
  const legacy = await loadSettingsWithLegacy(env, () => ({}));
  const source = legacy?.clients && Object.keys(legacy.clients).length ? legacy : seedSettings;
  await writeFeatureRows(env, splitFeatureItems(source));
  await writeRegistrationLinks(env, splitRegistrationLinks(source));
  await writeSettingsToRows(env, clearAggregateFeatureData(source), { preserveConfiguredChannels: true });
  await writeMigration(env, 'done');
  return true;
}

function applyFeatureRows(settings, rows = []) {
  // 按 client+feature 分组后一次性挂回，避免逐行 spread 造成 O(n²) 拷贝。
  // settings 是 readSettingsFromRows 刚构建的新对象，就地修改安全；
  // 归一化由调用链末尾的 applyRegistrationLinks 统一完成。
  const clients = settings?.clients || {};
  const grouped = new Map();
  for (const row of rows) {
    const client = clients[row.client_id];
    if (!client) continue;
    let features = grouped.get(client);
    if (!features) {
      features = new Map();
      grouped.set(client, features);
    }
    const values = features.get(row.feature);
    if (values) values.push(parse(row.payload));
    else features.set(row.feature, [parse(row.payload)]);
  }
  for (const [client, features] of grouped) {
    const payload = { ...(client.payload || {}) };
    if (features.has('plans')) payload.plans = features.get('plans');
    if (features.has('dca')) {
      const dcaValues = features.get('dca');
      payload.dca = dcaValues[dcaValues.length - 1] ?? null;
    }
    if (features.has('dca-list')) payload.dcaList = features.get('dca-list');
    if (features.has('market-alerts')) payload.marketAlerts = features.get('market-alerts');
    if (features.has('holding-alerts')) payload.holdingAlerts = features.get('holding-alerts');
    client.payload = payload;
  }
  return settings;
}

function applyRegistrationLinks(settings, rows = []) {
  // settings 为刚构建的行读取对象，就地替换 pairedClients 后只在收尾做一次 normalize。
  const registrations = (Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations : []).map((registration) => ({ ...registration, pairedClients: [] }));
  const byId = new Map(registrations.map((registration) => [text(registration?.deviceInstallationId || registration?.id, 160), registration]));
  for (const row of rows) {
    const registration = byId.get(text(row.registration_id, 160));
    if (!registration) continue;
    const value = parse(row.payload);
    registration.pairedClients.push(value && typeof value === 'object' ? value : { clientId: row.client_id });
  }
  settings.gcmRegistrations = registrations;
  return normalizeSettings(settings);
}

export function applyNotificationRows(settings, featureRows = [], linkRows = []) {
  return applyRegistrationLinks(applyFeatureRows(settings, featureRows), linkRows);
}

export async function loadSettingsWithFeatureItems(env, readLegacySettings) {
  if (!hasNotifyRowStorage(env)) return normalizeSettings(await readLegacySettings());
  // loadSettingsWithLegacy 已经返回行读取结果；只有迁移刚发生时才需要重读一次，
  // 常规请求避免对 notify_user_records 做第二次全表扫描。
  const base = await loadSettingsWithLegacy(env, readLegacySettings);
  const didMigrate = await ensureFeatureMigration(env, base);
  const rowSettings = didMigrate ? await readSettingsFromRows(env) : (base || {});
  return applyNotificationRows(rowSettings, await readRows(env), await readLinks(env));
}

export async function writeSettingsWithFeatureItems(env, settings, options = {}) {
  if (!hasNotifyRowStorage(env)) return false;
  await ensureFeatureMigration(env, settings);
  await writeSettingsToRows(env, clearAggregateFeatureData(settings), options);
  // merged settings 已是 normalizeSettings 产物，跳过 split 阶段的重复归一化拷贝。
  await writeFeatureRows(env, splitFeatureItems(settings, { preNormalized: true }));
  await writeRegistrationLinks(env, splitRegistrationLinks(settings, { preNormalized: true }));
  return true;
}
