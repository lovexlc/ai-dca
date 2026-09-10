import { normalizeSettings } from './clientSettings.js';

const TABLE_NAME = 'notify_user_records';
const MIGRATION_RECORD_TYPE = 'migration';
const MIGRATION_RECORD_ID = 'notify-settings-v1';
const LEGACY_OWNER = 'legacy';
const GLOBAL_OWNER = 'global';
const ROW_STORAGE_MARKER = '__notifyRowStorage';
const MAX_RECENT_EVENTS = 30;
const MAX_ACKS_PER_CLIENT = 200;

const schemaPromises = new WeakMap();

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value = '', max = 240) {
  return String(value || '').trim().slice(0, max);
}

function normalizeOwner(value = '') {
  return normalizeText(value, 96) || LEGACY_OWNER;
}

function parsePayload(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function serializePayload(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch (_error) {
    return '{}';
  }
}

function isD1Binding(value) {
  return Boolean(
    value
    && typeof value.prepare === 'function'
    && typeof value.batch === 'function'
  );
}

export function hasNotifyRowStorage(env) {
  return isD1Binding(env?.SYNC_DB);
}

export async function ensureNotifyRowSchema(env) {
  if (!hasNotifyRowStorage(env)) {
    throw new Error('通知行存储缺少 SYNC_DB 绑定。');
  }

  const db = env.SYNC_DB;
  const existing = schemaPromises.get(db);
  if (existing) return existing;

  const promise = (async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      owner_user_id TEXT NOT NULL,
      record_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_user_id, record_type, record_id)
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_notify_user_records_type_id
      ON ${TABLE_NAME} (record_type, record_id)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_notify_user_records_owner_type
      ON ${TABLE_NAME} (owner_user_id, record_type)`).run();
  })().catch((error) => {
    schemaPromises.delete(db);
    throw error;
  });

  schemaPromises.set(db, promise);
  return promise;
}

function clientOwner(client = {}) {
  const explicit = normalizeText(client?.ownerUserId, 96);
  if (explicit) return explicit;
  const accountClientId = normalizeText(client?.accountClientId, 120);
  if (accountClientId.startsWith('account:')) return normalizeOwner(accountClientId.slice('account:'.length));
  const clientId = normalizeText(client?.clientId, 120);
  if (clientId.startsWith('account:')) return normalizeOwner(clientId.slice('account:'.length));
  return `${LEGACY_OWNER}:${clientId || 'unknown'}`;
}

function clientFeatureId(clientId, feature) {
  return `${normalizeText(clientId, 120)}::${normalizeText(feature, 80)}`;
}

function splitClientFeatureId(value = '') {
  const normalized = normalizeText(value, 220);
  const separator = normalized.lastIndexOf('::');
  if (separator <= 0) return { clientId: '', feature: '' };
  return {
    clientId: normalized.slice(0, separator),
    feature: normalized.slice(separator + 2)
  };
}

function buildClientProfile(client = {}) {
  return {
    clientId: normalizeText(client.clientId, 120),
    clientLabel: normalizeText(client.clientLabel, 120),
    accountUsername: normalizeText(client.accountUsername, 48),
    ownerUserId: normalizeText(client.ownerUserId, 96),
    accountClientId: normalizeText(client.accountClientId, 120),
    isDeviceOnly: Boolean(client.isDeviceOnly),
    notifyGroupId: normalizeText(client.notifyGroupId, 120),
    clientSecretHash: normalizeText(client.clientSecretHash, 160)
  };
}

function buildClientMeta(client = {}) {
  return {
    counts: {
      planRuleCount: Number(client?.meta?.counts?.planRuleCount) || 0,
      dcaRuleCount: Number(client?.meta?.counts?.dcaRuleCount) || 0,
      marketAlertCount: Number(client?.meta?.counts?.marketAlertCount) || 0,
      holdingAlertCount: Number(client?.meta?.counts?.holdingAlertCount) || 0,
      totalRuleCount: Number(client?.meta?.counts?.totalRuleCount) || 0
    },
    lastSyncedAt: normalizeText(client?.meta?.lastSyncedAt, 64),
    lastCheckedAt: normalizeText(client?.meta?.lastCheckedAt, 64),
    lastTestedAt: normalizeText(client?.meta?.lastTestedAt, 64)
  };
}

function buildRowsFromSettings(settings = {}, { insertOnly = false } = {}) {
  const normalized = normalizeSettings(settings);
  const rows = [];
  const add = (owner, type, id, payload) => {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedType = normalizeText(type, 64);
    const normalizedId = normalizeText(id, 240);
    if (!normalizedType || !normalizedId) return;
    rows.push({ owner: normalizedOwner, type: normalizedType, id: normalizedId, payload });
  };

  for (const client of Object.values(normalized.clients || {})) {
    const clientId = normalizeText(client?.clientId, 120);
    if (!clientId) continue;
    const owner = clientOwner(client);
    add(owner, 'client', clientId, buildClientProfile(client));

    // 每个通道单独一行，避免 email/bark/serverchan3 的并发更新互相覆盖。
    add(owner, 'client-channel', clientFeatureId(clientId, 'bark'), {
      clientId,
      barkDeviceKey: normalizeText(client?.barkDeviceKey, 240)
    });
    add(owner, 'client-channel', clientFeatureId(clientId, 'serverchan3'), {
      clientId,
      serverChan3: client?.serverChan3 || {}
    });
    add(owner, 'client-channel', clientFeatureId(clientId, 'email'), {
      clientId,
      email: client?.email || {}
    });

    // 规则按功能分开存储，而不是把整套 notify payload 放进一个用户大 JSON。
    add(owner, 'client-feature', clientFeatureId(clientId, 'plans'), {
      clientId,
      syncedAt: normalizeText(client?.payload?.syncedAt, 64),
      value: Array.isArray(client?.payload?.plans) ? client.payload.plans : []
    });
    add(owner, 'client-feature', clientFeatureId(clientId, 'dca'), {
      clientId,
      syncedAt: normalizeText(client?.payload?.syncedAt, 64),
      value: {
        dca: client?.payload?.dca || null,
        dcaList: Array.isArray(client?.payload?.dcaList) ? client.payload.dcaList : []
      }
    });
    add(owner, 'client-feature', clientFeatureId(clientId, 'market-alerts'), {
      clientId,
      syncedAt: normalizeText(client?.payload?.syncedAt, 64),
      value: Array.isArray(client?.payload?.marketAlerts) ? client.payload.marketAlerts : []
    });
    add(owner, 'client-feature', clientFeatureId(clientId, 'holding-alerts'), {
      clientId,
      syncedAt: normalizeText(client?.payload?.syncedAt, 64),
      value: Array.isArray(client?.payload?.holdingAlerts) ? client.payload.holdingAlerts : []
    });
    add(owner, 'client-meta', clientId, buildClientMeta(client));

    for (const [ruleId, state] of Object.entries(client?.state?.ruleStates || {})) {
      add(owner, 'rule-state', clientFeatureId(clientId, ruleId), { clientId, ruleId, value: state });
    }
    for (const [failureId, failure] of Object.entries(client?.state?.deliveryFailures || {})) {
      add(owner, 'delivery-failure', clientFeatureId(clientId, failureId), {
        clientId,
        failureId,
        lastFailedAt: normalizeText(failure?.lastFailedAt, 64),
        value: failure
      });
    }
    for (const event of Array.isArray(client?.state?.recentEvents) ? client.state.recentEvents : []) {
      const eventId = normalizeText(event?.id || event?.eventId || event?.messageId, 240);
      if (eventId) {
        add(owner, 'event', clientFeatureId(clientId, eventId), {
          clientId,
          createdAt: normalizeText(event?.createdAt, 64),
          value: event
        });
      }
    }
    for (const [messageId, ack] of Object.entries(client?.state?.deliveryAcks || {})) {
      add(owner, 'delivery-ack', clientFeatureId(clientId, messageId), {
        clientId,
        messageId,
        updatedAt: normalizeText(ack?.updatedAt || ack?.lastAckAt, 64),
        value: ack
      });
    }
    add(owner, 'client-state-meta', clientId, {
      clientId,
      lastRunAt: normalizeText(client?.state?.lastRunAt, 64)
    });
  }

  const registrations = Array.isArray(normalized.gcmRegistrations) ? normalized.gcmRegistrations : [];
  for (const registration of registrations) {
    const registrationId = normalizeText(registration?.deviceInstallationId || registration?.id, 160);
    if (!registrationId) continue;
    const pairedClients = Array.isArray(registration?.pairedClients) ? registration.pairedClients : [];
    const owners = new Set();
    for (const paired of pairedClients) {
      const client = normalized.clients?.[normalizeText(paired?.clientId, 120)];
      owners.add(client ? clientOwner(client) : `${LEGACY_OWNER}:${normalizeText(paired?.clientId, 120)}`);
    }
    if (!owners.size) owners.add(LEGACY_OWNER);
    for (const owner of owners) add(owner, 'registration', registrationId, registration);
  }

  add(GLOBAL_OWNER, 'global', 'notify-global', {
    gotifyBaseUrl: normalizeText(normalized.gotifyBaseUrl, 240),
    gotifyUsername: normalizeText(normalized.gotifyUsername, 120),
    gotifyPassword: normalizeText(normalized.gotifyPassword, 240),
    gotifyToken: normalizeText(normalized.gotifyToken, 240),
    gotifyClients: normalized.gotifyClients || []
  });

  return { rows, insertOnly };
}

function hasTimestampPayload(payload = {}) {
  return ['updatedAt', 'syncedAt', 'computedAt', 'generatedAt', 'createdAt', 'lastFailedAt', 'lastAckAt']
    .some((key) => Boolean(String(payload?.[key] || '').trim()));
}

function shouldGuardTimestamp(row) {
  return ['client-feature', 'event', 'delivery-failure', 'delivery-ack'].includes(row.type)
    || (row.type === 'user-kv' && hasTimestampPayload(row.payload));
}

function rowTimestampExpression(alias) {
  return `COALESCE(
    NULLIF(json_extract(${alias}.payload, '$.updatedAt'), ''),
    NULLIF(json_extract(${alias}.payload, '$.syncedAt'), ''),
    NULLIF(json_extract(${alias}.payload, '$.computedAt'), ''),
    NULLIF(json_extract(${alias}.payload, '$.generatedAt'), ''),
    NULLIF(json_extract(${alias}.payload, '$.createdAt'), ''),
    NULLIF(json_extract(${alias}.payload, '$.lastFailedAt'), ''),
    NULLIF(json_extract(${alias}.payload, '$.lastAckAt'), ''),
    ''
  )`;
}

function createWriteStatement(db, row, { insertOnly = false, now = nowIso() } = {}) {
  const timestampGuard = !insertOnly && shouldGuardTimestamp(row)
    ? ` WHERE ${rowTimestampExpression('excluded')} >= ${rowTimestampExpression(TABLE_NAME)}`
    : '';
  const sql = insertOnly
    ? `INSERT OR IGNORE INTO ${TABLE_NAME}
      (owner_user_id, record_type, record_id, payload, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)`
    : `INSERT INTO ${TABLE_NAME}
      (owner_user_id, record_type, record_id, payload, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(owner_user_id, record_type, record_id) DO UPDATE SET
        payload = excluded.payload,
        revision = ${TABLE_NAME}.revision + 1,
        updated_at = excluded.updated_at${timestampGuard}`;
  return db.prepare(sql).bind(
    row.owner,
    row.type,
    row.id,
    serializePayload(row.payload),
    now,
    now
  );
}

async function runBatches(db, statements, batchSize = 80) {
  for (let index = 0; index < statements.length; index += batchSize) {
    const batch = statements.slice(index, index + batchSize);
    if (batch.length) await db.batch(batch);
  }
}

async function getAllRows(env) {
  await ensureNotifyRowSchema(env);
  const result = await env.SYNC_DB.prepare(`SELECT owner_user_id, record_type, record_id, payload, revision, created_at, updated_at
    FROM ${TABLE_NAME}`).all();
  return Array.isArray(result?.results) ? result.results : [];
}

function ensureClient(settings, clientId) {
  const normalizedClientId = normalizeText(clientId, 120);
  if (!normalizedClientId) return null;
  settings.clients[normalizedClientId] = settings.clients[normalizedClientId] || {
    clientId: normalizedClientId,
    clientLabel: '',
    accountUsername: '',
    ownerUserId: '',
    accountClientId: '',
    isDeviceOnly: false,
    notifyGroupId: normalizedClientId,
    clientSecretHash: '',
    barkDeviceKey: '',
    serverChan3: {},
    email: {},
    payload: {},
    state: {
      ruleStates: {},
      deliveryFailures: {},
      recentEvents: [],
      deliveryAcks: {},
      lastRunAt: ''
    },
    meta: { counts: {}, lastSyncedAt: '', lastCheckedAt: '', lastTestedAt: '' }
  };
  return settings.clients[normalizedClientId];
}

function applyRowToSettings(settings, row) {
  const type = normalizeText(row?.record_type, 64);
  const id = normalizeText(row?.record_id, 240);
  const payload = parsePayload(row?.payload, {});
  if (!type || !id) return;

  if (type === 'client') {
    const client = ensureClient(settings, id);
    Object.assign(client, payload);
    return;
  }
  if (type === 'client-channel') {
    const { clientId, feature } = splitClientFeatureId(id);
    const client = ensureClient(settings, payload?.clientId || clientId);
    if (!client) return;
    if (feature === 'bark') client.barkDeviceKey = normalizeText(payload?.barkDeviceKey, 240);
    if (feature === 'serverchan3') client.serverChan3 = payload?.serverChan3 || {};
    if (feature === 'email') client.email = payload?.email || {};
    return;
  }
  if (type === 'client-feature') {
    const { clientId, feature } = splitClientFeatureId(id);
    const client = ensureClient(settings, payload?.clientId || clientId);
    if (!client) return;
    client.payload = client.payload || {};
    if (feature === 'plans') client.payload.plans = Array.isArray(payload?.value) ? payload.value : [];
    if (feature === 'dca') {
      client.payload.dca = payload?.value?.dca || null;
      client.payload.dcaList = Array.isArray(payload?.value?.dcaList) ? payload.value.dcaList : [];
    }
    if (feature === 'market-alerts') client.payload.marketAlerts = Array.isArray(payload?.value) ? payload.value : [];
    if (feature === 'holding-alerts') client.payload.holdingAlerts = Array.isArray(payload?.value) ? payload.value : [];
    if (payload?.syncedAt) client.payload.syncedAt = payload.syncedAt;
    return;
  }
  if (type === 'client-meta') {
    const client = ensureClient(settings, id);
    client.meta = payload;
    return;
  }
  if (type === 'client-state-meta') {
    const client = ensureClient(settings, id);
    client.state = client.state || {};
    client.state.lastRunAt = normalizeText(payload?.lastRunAt, 64);
    return;
  }
  if (type === 'rule-state' || type === 'delivery-failure' || type === 'event' || type === 'delivery-ack') {
    const { clientId } = splitClientFeatureId(id);
    const client = ensureClient(settings, payload?.clientId || clientId);
    if (!client) return;
    client.state = client.state || {};
    if (type === 'rule-state') {
      client.state.ruleStates[payload?.ruleId || id] = payload?.value || {};
    } else if (type === 'delivery-failure') {
      client.state.deliveryFailures[payload?.failureId || id] = payload?.value || {};
    } else if (type === 'event') {
      const event = payload?.value;
      if (event && typeof event === 'object') client.state.recentEvents.push(event);
    } else if (type === 'delivery-ack') {
      const messageId = normalizeText(payload?.messageId, 240);
      if (messageId) client.state.deliveryAcks[messageId] = payload?.value || {};
    }
    return;
  }
  if (type === 'registration') {
    const registration = payload;
    const key = normalizeText(registration?.deviceInstallationId || registration?.id, 160);
    if (!key) return;
    const existing = settings.gcmRegistrations.find((item) => (
      normalizeText(item?.deviceInstallationId || item?.id, 160) === key
    ));
    if (existing) Object.assign(existing, registration);
    else settings.gcmRegistrations.push(registration);
    return;
  }
  if (type === 'global' && id === 'notify-global') Object.assign(settings, payload);
}

export async function readSettingsFromRows(env) {
  const rows = await getAllRows(env);
  const settings = { clients: {}, gcmRegistrations: [] };
  for (const row of rows) applyRowToSettings(settings, row);

  for (const client of Object.values(settings.clients)) {
    client.state.recentEvents = Array.from(new Map(
      client.state.recentEvents
        .map((event) => [normalizeText(event?.id || event?.eventId || event?.messageId, 240), event])
        .filter(([id]) => id)
    ).values())
      .sort((left, right) => (Date.parse(String(right?.createdAt || '')) || 0) - (Date.parse(String(left?.createdAt || '')) || 0))
      .slice(0, MAX_RECENT_EVENTS);
    const ackEntries = Object.entries(client.state.deliveryAcks || {})
      .sort((left, right) => (Date.parse(String(right[1]?.updatedAt || right[1]?.lastAckAt || '')) || 0)
        - (Date.parse(String(left[1]?.updatedAt || left[1]?.lastAckAt || '')) || 0));
    client.state.deliveryAcks = Object.fromEntries(ackEntries.slice(0, MAX_ACKS_PER_CLIENT));
  }

  return normalizeSettings(settings);
}

async function getMigrationMarker(env) {
  await ensureNotifyRowSchema(env);
  return env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE_NAME}
    WHERE owner_user_id = ? AND record_type = ? AND record_id = ?`)
    .bind(GLOBAL_OWNER, MIGRATION_RECORD_TYPE, MIGRATION_RECORD_ID)
    .first();
}

async function setMigrationMarker(env, payload, { insertOnly = false } = {}) {
  const row = { owner: GLOBAL_OWNER, type: MIGRATION_RECORD_TYPE, id: MIGRATION_RECORD_ID, payload };
  await ensureNotifyRowSchema(env);
  await env.SYNC_DB.batch([createWriteStatement(env.SYNC_DB, row, { insertOnly })]);
}

export async function migrateLegacySettingsToRows(env, legacySettings = {}) {
  if (!hasNotifyRowStorage(env)) return { migrated: false, reason: 'no-d1' };
  const marker = await getMigrationMarker(env);
  const markerPayload = parsePayload(marker?.payload, {});
  if (markerPayload.status === 'done') return { migrated: false, reason: 'already-migrated' };

  await setMigrationMarker(env, {
    status: 'running',
    startedAt: markerPayload.startedAt || nowIso()
  }, { insertOnly: true });

  const { rows } = buildRowsFromSettings(legacySettings, { insertOnly: true });
  await runBatches(env.SYNC_DB, rows.map((row) => createWriteStatement(env.SYNC_DB, row, { insertOnly: true })));
  await setMigrationMarker(env, {
    status: 'done',
    completedAt: nowIso(),
    rowCount: rows.length,
    source: 'notify:settings'
  });
  return { migrated: true, rowCount: rows.length };
}

export async function loadSettingsWithLegacy(env, readLegacySettings) {
  if (!hasNotifyRowStorage(env)) return null;
  await ensureNotifyRowSchema(env);
  const marker = await getMigrationMarker(env);
  const markerPayload = parsePayload(marker?.payload, {});
  if (markerPayload.status !== 'done') {
    const legacySettings = typeof readLegacySettings === 'function'
      ? await readLegacySettings()
      : {};
    await migrateLegacySettingsToRows(env, legacySettings || {});
  }
  return readSettingsFromRows(env);
}

function shouldPreserveChannelRow(row) {
  if (row.type !== 'client-channel') return false;
  const payload = row.payload || {};
  const { feature } = splitClientFeatureId(row.id);
  if (feature === 'bark') return !String(payload.barkDeviceKey || '').trim();
  if (feature === 'serverchan3') {
    const config = payload.serverChan3 || {};
    return !String(config.uid || '').trim() && !String(config.sendKey || '').trim();
  }
  if (feature === 'email') {
    const email = payload.email || {};
    return !String(email.address || '').trim() && !email.verified && email.enabled !== true;
  }
  return false;
}

export async function writeSettingsToRows(env, settings = {}, { preserveConfiguredChannels = true } = {}) {
  if (!hasNotifyRowStorage(env)) throw new Error('通知行存储缺少 SYNC_DB 绑定。');
  await ensureNotifyRowSchema(env);
  const { rows } = buildRowsFromSettings(settings);
  const rowsToWrite = preserveConfiguredChannels
    ? rows.filter((row) => !shouldPreserveChannelRow(row))
    : rows;
  const statements = rowsToWrite.map((row) => createWriteStatement(env.SYNC_DB, row));
  await runBatches(env.SYNC_DB, statements);
  return readSettingsFromRows(env);
}

export async function deleteNotifyRegistration(env, registrationId = '') {
  if (!hasNotifyRowStorage(env)) return false;
  const normalizedId = normalizeText(registrationId, 160);
  if (!normalizedId) return false;
  await ensureNotifyRowSchema(env);
  await env.SYNC_DB.prepare(`DELETE FROM ${TABLE_NAME}
    WHERE record_type = 'registration' AND record_id = ?`).bind(normalizedId).run();
  return true;
}

function keyOwnerAndId(key = '') {
  const normalizedKey = normalizeText(key, 500);
  if (!normalizedKey) return null;

  let owner = LEGACY_OWNER;
  if (normalizedKey.startsWith('wechat:user:')) {
    const rest = normalizedKey.slice('wechat:user:'.length);
    owner = normalizeOwner(rest.split(':')[0] || LEGACY_OWNER);
  } else {
    const clientMatch = normalizedKey.match(/^(?:notify:market-alerts:|holdings-rule:|vix-state:|sell-plan-state:|position-state:|switch:(?:config|snapshot|state|push-digest):)([^:]+(?::[^:]+)?)/);
    if (clientMatch) {
      const rawClientId = clientMatch[1];
      owner = rawClientId.startsWith('account:')
        ? normalizeOwner(rawClientId.slice('account:'.length))
        : `${LEGACY_OWNER}:${normalizeOwner(rawClientId)}`;
    }
  }

  return { owner, id: normalizedKey };
}

export function isDurableUserKey(key = '') {
  const normalized = normalizeText(key, 500);
  if (!normalized) return false;
  return normalized.startsWith('notify:market-alerts:')
    || normalized.startsWith('holdings-rule:')
    || normalized.startsWith('switch:config:')
    || normalized.startsWith('switch:snapshot:')
    || normalized.startsWith('switch:state:')
    || normalized.startsWith('switch:push-digest:')
    || normalized.startsWith('vix-state:')
    || normalized.startsWith('sell-plan-state:')
    || normalized.startsWith('position-state:')
    || normalized.startsWith('wechat:user:');
}

function isRowStorageMarker(value) {
  return Boolean(value && typeof value === 'object' && value[ROW_STORAGE_MARKER] === 'd1');
}

export async function readDurableUserJson(env, key, fallback, readLegacy) {
  if (!hasNotifyRowStorage(env) || !isDurableUserKey(key)) return fallback;
  const mapped = keyOwnerAndId(key);
  if (!mapped) return fallback;
  await ensureNotifyRowSchema(env);
  const row = await env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE_NAME}
    WHERE owner_user_id = ? AND record_type = 'user-kv' AND record_id = ?`)
    .bind(mapped.owner, mapped.id)
    .first();
  if (row) return parsePayload(row.payload, fallback);

  const legacyValue = typeof readLegacy === 'function' ? await readLegacy() : null;
  if (legacyValue == null || isRowStorageMarker(legacyValue)) return fallback;
  await env.SYNC_DB.prepare(`INSERT OR IGNORE INTO ${TABLE_NAME}
    (owner_user_id, record_type, record_id, payload, revision, created_at, updated_at)
    VALUES (?, 'user-kv', ?, ?, 1, ?, ?)`)
    .bind(mapped.owner, mapped.id, serializePayload(legacyValue), nowIso(), nowIso())
    .run();
  return legacyValue;
}

export async function writeDurableUserJson(env, key, value) {
  if (!hasNotifyRowStorage(env) || !isDurableUserKey(key)) return false;
  const mapped = keyOwnerAndId(key);
  if (!mapped) return false;
  await ensureNotifyRowSchema(env);
  const row = { owner: mapped.owner, type: 'user-kv', id: mapped.id, payload: value };
  await env.SYNC_DB.batch([createWriteStatement(env.SYNC_DB, row)]);
  // 仅保留一个很小的 KV 索引标记，兼容现有 list(prefix) 调度代码；真实用户数据只在 D1 行中。
  try {
    if (env?.NOTIFY_STATE && typeof env.NOTIFY_STATE.put === 'function') {
      await env.NOTIFY_STATE.put(key, serializePayload({
        [ROW_STORAGE_MARKER]: 'd1',
        updatedAt: nowIso()
      }));
    }
  } catch (_error) {
    // D1 是主存储，KV 索引失败不阻断 CRUD。
  }
  return true;
}

export async function listDurableUserKeys(env, prefix = '') {
  const normalizedPrefix = normalizeText(prefix, 500);
  const result = new Set();
  if (hasNotifyRowStorage(env)) {
    await ensureNotifyRowSchema(env);
    const rows = await env.SYNC_DB.prepare(`SELECT record_id FROM ${TABLE_NAME}
      WHERE record_type = 'user-kv' AND record_id LIKE ?`)
      .bind(`${normalizedPrefix}%`)
      .all();
    for (const row of rows?.results || []) {
      const key = normalizeText(row?.record_id, 500);
      if (key) result.add(key);
    }
  }
  if (env?.NOTIFY_STATE && typeof env.NOTIFY_STATE.list === 'function') {
    let cursor;
    do {
      const page = await env.NOTIFY_STATE.list({ prefix: normalizedPrefix, cursor });
      for (const item of page?.keys || []) {
        const key = normalizeText(item?.name, 500);
        if (key) result.add(key);
      }
      cursor = page?.list_complete ? undefined : page?.cursor;
    } while (cursor);
  }
  return Array.from(result);
}
