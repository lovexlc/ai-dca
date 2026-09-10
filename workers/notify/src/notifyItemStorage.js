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

export function splitFeatureItems(settings = {}) {
  const normalized = normalizeSettings(settings);
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

export function splitRegistrationLinks(settings = {}) {
  const normalized = normalizeSettings(settings);
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
  const normalized = normalizeSettings(settings);
  const clients = {};
  for (const [clientId, source] of Object.entries(normalized.clients || {})) {
    const client = { ...source, payload: { ...(source.payload || {}) } };
    client.payload.plans = [];
    client.payload.dca = null;
    client.payload.dcaList = [];
    client.payload.marketAlerts = [];
    client.payload.holdingAlerts = [];
    clients[clientId] = client;
  }
  const gcmRegistrations = (normalized.gcmRegistrations || []).map((registration) => ({
    ...registration,
    pairedClients: []
  }));
  return normalizeSettings({ ...normalized, clients, gcmRegistrations });
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
  const existingResult = await env.SYNC_DB.prepare(`SELECT * FROM ${FEATURE_TABLE}`).all();
  const existing = Array.isArray(existingResult?.results) ? existingResult.results : [];
  const incoming = new Set(rows.map((row) => `${row.owner}\u0000${row.clientId}\u0000${row.feature}\u0000${row.itemId}`));
  const timestamp = nowIso();
  const statements = [];
  for (const row of rows) {
    const key = `${row.owner}\u0000${row.clientId}\u0000${row.feature}\u0000${row.itemId}`;
    const current = existing.find((item) => `${item.owner_user_id}\u0000${item.client_id}\u0000${item.feature}\u0000${item.item_id}` === key);
    statements.push(env.SYNC_DB.prepare(`INSERT INTO ${FEATURE_TABLE}
      (owner_user_id, client_id, feature, item_id, kind, position, payload, revision, deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(owner_user_id, client_id, feature, item_id) DO UPDATE SET
        kind = excluded.kind,
        position = excluded.position,
        payload = excluded.payload,
        revision = ${FEATURE_TABLE}.revision + 1,
        deleted = 0,
        updated_at = excluded.updated_at`)
      .bind(row.owner, row.clientId, row.feature, row.itemId, row.kind, row.position, serialize(row.payload), Number(current?.revision || 0) + 1, timestamp, timestamp));
  }
  for (const current of existing) {
    const key = `${current.owner_user_id}\u0000${current.client_id}\u0000${current.feature}\u0000${current.item_id}`;
    if (!incoming.has(key) && Number(current.deleted || 0) === 0) {
      statements.push(env.SYNC_DB.prepare(`UPDATE ${FEATURE_TABLE} SET
        revision = revision + 1, deleted = 1, payload = '{}', updated_at = ?
        WHERE owner_user_id = ? AND client_id = ? AND feature = ? AND item_id = ?`)
        .bind(timestamp, current.owner_user_id, current.client_id, current.feature, current.item_id));
    }
  }
  for (let index = 0; index < statements.length; index += 80) await env.SYNC_DB.batch(statements.slice(index, index + 80));
}

async function writeRegistrationLinks(env, rows) {
  await ensureSchema(env);
  const existingResult = await env.SYNC_DB.prepare(`SELECT * FROM ${LINK_TABLE}`).all();
  const existing = Array.isArray(existingResult?.results) ? existingResult.results : [];
  const incoming = new Set(rows.map((row) => `${row.owner}\u0000${row.registrationId}\u0000${row.clientId}`));
  const timestamp = nowIso();
  const statements = [];
  for (const row of rows) {
    const key = `${row.owner}\u0000${row.registrationId}\u0000${row.clientId}`;
    const current = existing.find((item) => `${item.owner_user_id}\u0000${item.registration_id}\u0000${item.client_id}` === key);
    statements.push(env.SYNC_DB.prepare(`INSERT INTO ${LINK_TABLE}
      (owner_user_id, registration_id, client_id, position, payload, revision, deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(owner_user_id, registration_id, client_id) DO UPDATE SET
        position = excluded.position,
        payload = excluded.payload,
        revision = ${LINK_TABLE}.revision + 1,
        deleted = 0,
        updated_at = excluded.updated_at`)
      .bind(row.owner, row.registrationId, row.clientId, row.position, serialize(row.payload), Number(current?.revision || 0) + 1, timestamp, timestamp));
  }
  for (const current of existing) {
    const key = `${current.owner_user_id}\u0000${current.registration_id}\u0000${current.client_id}`;
    if (!incoming.has(key) && Number(current.deleted || 0) === 0) {
      statements.push(env.SYNC_DB.prepare(`UPDATE ${LINK_TABLE} SET
        revision = revision + 1, deleted = 1, payload = '{}', updated_at = ?
        WHERE owner_user_id = ? AND registration_id = ? AND client_id = ?`)
        .bind(timestamp, current.owner_user_id, current.registration_id, current.client_id));
    }
  }
  for (let index = 0; index < statements.length; index += 80) await env.SYNC_DB.batch(statements.slice(index, index + 80));
}

async function ensureFeatureMigration(env, seedSettings = {}) {
  await ensureSchema(env);
  const marker = await readMigration(env);
  if (parse(marker?.payload).status === 'done') return;
  const legacy = await loadSettingsWithLegacy(env, () => ({}));
  const source = legacy?.clients && Object.keys(legacy.clients).length ? legacy : seedSettings;
  await writeFeatureRows(env, splitFeatureItems(source));
  await writeRegistrationLinks(env, splitRegistrationLinks(source));
  await writeSettingsToRows(env, clearAggregateFeatureData(source), { preserveConfiguredChannels: true });
  await writeMigration(env, 'done');
}

function applyFeatureRows(settings, rows = []) {
  const normalized = normalizeSettings(settings);
  const clients = { ...(normalized.clients || {}) };
  for (const row of rows) {
    const client = clients[row.client_id];
    if (!client) continue;
    client.payload = { ...(client.payload || {}) };
    const value = parse(row.payload);
    if (row.feature === 'plans') client.payload.plans = [...(client.payload.plans || []), value];
    if (row.feature === 'dca') client.payload.dca = value;
    if (row.feature === 'dca-list') client.payload.dcaList = [...(client.payload.dcaList || []), value];
    if (row.feature === 'market-alerts') client.payload.marketAlerts = [...(client.payload.marketAlerts || []), value];
    if (row.feature === 'holding-alerts') client.payload.holdingAlerts = [...(client.payload.holdingAlerts || []), value];
  }
  return normalizeSettings({ ...normalized, clients });
}

function applyRegistrationLinks(settings, rows = []) {
  const normalized = normalizeSettings(settings);
  const registrations = (normalized.gcmRegistrations || []).map((registration) => ({ ...registration, pairedClients: [] }));
  const byId = new Map(registrations.map((registration) => [text(registration?.deviceInstallationId || registration?.id, 160), registration]));
  for (const row of rows) {
    const registration = byId.get(text(row.registration_id, 160));
    if (!registration) continue;
    const value = parse(row.payload);
    registration.pairedClients.push(value && typeof value === 'object' ? value : { clientId: row.client_id });
  }
  return normalizeSettings({ ...normalized, gcmRegistrations: registrations });
}

export function applyNotificationRows(settings, featureRows = [], linkRows = []) {
  return applyRegistrationLinks(applyFeatureRows(settings, featureRows), linkRows);
}

export async function loadSettingsWithFeatureItems(env, readLegacySettings) {
  if (!hasNotifyRowStorage(env)) return normalizeSettings(await readLegacySettings());
  const base = await loadSettingsWithLegacy(env, readLegacySettings);
  await ensureFeatureMigration(env, base);
  const rowSettings = await readSettingsFromRows(env);
  return applyNotificationRows(rowSettings || base, await readRows(env), await readLinks(env));
}

export async function writeSettingsWithFeatureItems(env, settings, options = {}) {
  if (!hasNotifyRowStorage(env)) return false;
  await ensureFeatureMigration(env, settings);
  await writeSettingsToRows(env, clearAggregateFeatureData(settings), options);
  await writeFeatureRows(env, splitFeatureItems(settings));
  await writeRegistrationLinks(env, splitRegistrationLinks(settings));
  return true;
}
