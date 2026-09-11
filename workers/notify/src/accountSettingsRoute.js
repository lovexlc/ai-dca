import { maskServerChan3SendKey, normalizeServerChan3Config } from './channels/serverChan3.js';
import { jsonResponse, readOrigin } from './notifyHttp.js';
import { VERIFIED_NOTIFY_USER_ID_HEADER, VERIFIED_NOTIFY_USERNAME_HEADER } from './notifyAccountAuth.js';
import { buildAccountClientId, normalizeClientName, normalizeNotifyUserId } from './clientSettings.js';

const RECORD_TABLE = 'notify_user_records';
const BINDING_TABLE = 'notify_channel_bindings';
const schemaPromises = new WeakMap();

function nowIso() { return new Date().toISOString(); }
function text(value = '', max = 240) { return String(value ?? '').trim().slice(0, max); }
function serialize(value) { return JSON.stringify(value ?? {}); }
function parse(value, fallback = {}) { try { const parsed = JSON.parse(String(value || '')); return parsed && typeof parsed === 'object' ? parsed : fallback; } catch { return fallback; } }
function channelRecordId(clientId, channel) { return `${clientId}::${channel}`; }

class AccountSettingsError extends Error {
  constructor(message, status = 400, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function hashToken(value = '') {
  const bytes = new TextEncoder().encode(String(value || '').trim());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function ensureSchema(env) {
  if (!env?.SYNC_DB?.prepare || !env?.SYNC_DB?.batch) throw new AccountSettingsError('通知账户存储暂不可用。', 503, 'AUTH_UNAVAILABLE');
  const current = schemaPromises.get(env.SYNC_DB);
  if (current) return current;
  const promise = (async () => {
    await env.SYNC_DB.prepare(`CREATE TABLE IF NOT EXISTS ${BINDING_TABLE} (
      channel_type TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      channel_identity TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (channel_type, token_hash)
    )`).run();
    await env.SYNC_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notify_channel_bindings_owner
      ON ${BINDING_TABLE} (owner_user_id, channel_type)`).run();
  })().catch((error) => { schemaPromises.delete(env.SYNC_DB); throw error; });
  schemaPromises.set(env.SYNC_DB, promise);
  return promise;
}

function verifiedAccount(request) {
  const userId = normalizeNotifyUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER));
  const username = text(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER), 48).toLowerCase();
  if (!userId || !username) throw new AccountSettingsError('请先登录账户后配置通知。', 401, 'AUTH_REQUIRED');
  return { userId, username, clientId: buildAccountClientId(userId) };
}

async function loadCanonicalChannels(env, ownerUserId, clientId) {
  const result = await env.SYNC_DB.prepare(`SELECT record_id, payload FROM ${RECORD_TABLE}
    WHERE owner_user_id = ? AND record_type = 'client-channel'
      AND record_id IN (?, ?, ?)`)
    .bind(ownerUserId, channelRecordId(clientId, 'bark'), channelRecordId(clientId, 'serverchan3'), channelRecordId(clientId, 'email'))
    .all();
  const channels = { barkDeviceKey: '', serverChan3: {}, email: {} };
  for (const row of result?.results || []) {
    const payload = parse(row.payload);
    if (String(row.record_id).endsWith('::bark')) channels.barkDeviceKey = text(payload.barkDeviceKey);
    if (String(row.record_id).endsWith('::serverchan3')) channels.serverChan3 = normalizeServerChan3Config(payload.serverChan3 || {});
    if (String(row.record_id).endsWith('::email')) channels.email = payload.email || {};
  }
  return channels;
}

async function findConflicts(env, { barkDeviceKey, serverChan3 }) {
  const clauses = [];
  const bindings = [];
  if (barkDeviceKey) { clauses.push(`json_extract(payload, '$.barkDeviceKey') = ?`); bindings.push(barkDeviceKey); }
  if (serverChan3.uid) { clauses.push(`lower(json_extract(payload, '$.serverChan3.uid')) = lower(?)`); bindings.push(serverChan3.uid); }
  if (!clauses.length) return [];
  const result = await env.SYNC_DB.prepare(`SELECT owner_user_id, record_id, payload FROM ${RECORD_TABLE}
    WHERE record_type = 'client-channel' AND (${clauses.join(' OR ')})`)
    .bind(...bindings).all();
  return Array.isArray(result?.results) ? result.results : [];
}

function writeRecord(db, owner, type, id, payload, timestamp) {
  return db.prepare(`INSERT INTO ${RECORD_TABLE}
    (owner_user_id, record_type, record_id, payload, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(owner_user_id, record_type, record_id) DO UPDATE SET
      payload = excluded.payload, revision = ${RECORD_TABLE}.revision + 1, updated_at = excluded.updated_at`)
    .bind(owner, type, id, serialize(payload), timestamp, timestamp);
}

function timingResponse(payload, request, timings) {
  const response = jsonResponse(payload, { origin: readOrigin(request) });
  const headers = new Headers(response.headers);
  headers.set('server-timing', Object.entries(timings).map(([name, value]) => `${name};dur=${Math.max(0, Math.round(value))}`).join(', '));
  return new Response(response.body, { status: response.status, headers });
}

export async function handleAccountSettings(request, env) {
  const startedAt = Date.now();
  const marks = {};
  await ensureSchema(env);
  marks.schema = Date.now() - startedAt;
  const account = verifiedAccount(request);
  const payload = await request.json().catch(() => ({}));
  const current = await loadCanonicalChannels(env, account.userId, account.clientId);
  marks.read = Date.now() - startedAt - marks.schema;

  const barkProvided = Object.prototype.hasOwnProperty.call(payload, 'barkDeviceKey');
  const serverProvided = Object.prototype.hasOwnProperty.call(payload, 'serverChan3');
  const barkDeviceKey = barkProvided ? text(payload.barkDeviceKey) : current.barkDeviceKey;
  const serverChan3 = serverProvided ? normalizeServerChan3Config(payload.serverChan3 || {}) : current.serverChan3;
  if (serverProvided && serverChan3.uid && !serverChan3.sendKey && current.serverChan3?.uid === serverChan3.uid) serverChan3.sendKey = current.serverChan3.sendKey;
  const rebindChannel = text(payload.rebindChannel, 32).toLowerCase();
  const conflicts = await findConflicts(env, { barkDeviceKey: barkProvided ? barkDeviceKey : '', serverChan3: serverProvided ? serverChan3 : {} });
  marks.conflicts = Date.now() - startedAt - marks.schema - marks.read;

  const deletes = [];
  for (const row of conflicts) {
    const old = parse(row.payload);
    const isCanonical = row.owner_user_id === account.userId && row.record_id.startsWith(`${account.clientId}::`);
    if (isCanonical) continue;
    if (text(old.barkDeviceKey) && barkDeviceKey && text(old.barkDeviceKey) === barkDeviceKey) {
      if (row.owner_user_id !== account.userId && rebindChannel !== 'bark') throw new AccountSettingsError('该 Bark 通道已绑定其他账号，需要确认换绑。', 409, 'CHANNEL_REBIND_REQUIRED');
      deletes.push({ owner: row.owner_user_id, id: row.record_id, channel: 'bark' });
    }
    const oldServer = normalizeServerChan3Config(old.serverChan3 || {});
    if (oldServer.uid && serverChan3.uid && oldServer.uid.toLowerCase() === serverChan3.uid.toLowerCase()) {
      if (row.owner_user_id !== account.userId && oldServer.sendKey !== serverChan3.sendKey) throw new AccountSettingsError('该 Server酱³ UID 已绑定其他账号，但 SendKey 不匹配。', 409, 'CHANNEL_BINDING_MISMATCH');
      if (row.owner_user_id !== account.userId && rebindChannel !== 'serverchan3') throw new AccountSettingsError('该 Server酱³ 通道已绑定其他账号，需要确认换绑。', 409, 'CHANNEL_REBIND_REQUIRED');
      deletes.push({ owner: row.owner_user_id, id: row.record_id, channel: 'serverchan3' });
    }
  }

  const timestamp = nowIso();
  const label = normalizeClientName(payload.clientLabel || `账号通知 · ${account.username}`);
  const statements = [];
  for (const item of deletes) statements.push(env.SYNC_DB.prepare(`DELETE FROM ${RECORD_TABLE} WHERE owner_user_id = ? AND record_type = 'client-channel' AND record_id = ?`).bind(item.owner, item.id));
  // 同账号只能保留 canonical account 记录上的渠道；设备 client 仍保留用于 PC 注册，但不能持有业务渠道。
  if (barkProvided) statements.push(env.SYNC_DB.prepare(`DELETE FROM ${RECORD_TABLE} WHERE owner_user_id = ? AND record_type = 'client-channel' AND record_id LIKE '%::bark' AND record_id != ?`).bind(account.userId, channelRecordId(account.clientId, 'bark')));
  if (serverProvided) statements.push(env.SYNC_DB.prepare(`DELETE FROM ${RECORD_TABLE} WHERE owner_user_id = ? AND record_type = 'client-channel' AND record_id LIKE '%::serverchan3' AND record_id != ?`).bind(account.userId, channelRecordId(account.clientId, 'serverchan3')));
  statements.push(writeRecord(env.SYNC_DB, account.userId, 'client', account.clientId, { clientId: account.clientId, clientLabel: label, accountUsername: account.username, ownerUserId: account.userId, accountClientId: account.clientId, isDeviceOnly: false, notifyGroupId: account.clientId, clientSecretHash: '' }, timestamp));
  if (barkProvided) statements.push(writeRecord(env.SYNC_DB, account.userId, 'client-channel', channelRecordId(account.clientId, 'bark'), { clientId: account.clientId, barkDeviceKey }, timestamp));
  if (serverProvided) statements.push(writeRecord(env.SYNC_DB, account.userId, 'client-channel', channelRecordId(account.clientId, 'serverchan3'), { clientId: account.clientId, serverChan3 }, timestamp));

  if (barkProvided) {
    await env.SYNC_DB.prepare(`DELETE FROM ${BINDING_TABLE} WHERE owner_user_id = ? AND channel_type = 'bark'`).bind(account.userId).run();
    if (barkDeviceKey) {
      const tokenHash = await hashToken(barkDeviceKey);
      statements.push(env.SYNC_DB.prepare(`INSERT INTO ${BINDING_TABLE} (channel_type, token_hash, owner_user_id, client_id, channel_identity, created_at, updated_at) VALUES ('bark', ?, ?, ?, '', ?, ?) ON CONFLICT(channel_type, token_hash) DO UPDATE SET owner_user_id = excluded.owner_user_id, client_id = excluded.client_id, updated_at = excluded.updated_at`).bind(tokenHash, account.userId, account.clientId, timestamp, timestamp));
    }
  }
  if (serverProvided) {
    await env.SYNC_DB.prepare(`DELETE FROM ${BINDING_TABLE} WHERE owner_user_id = ? AND channel_type = 'serverchan3'`).bind(account.userId).run();
    if (serverChan3.uid && serverChan3.sendKey) {
      const tokenHash = await hashToken(`${serverChan3.uid.toLowerCase()}:${serverChan3.sendKey}`);
      statements.push(env.SYNC_DB.prepare(`INSERT INTO ${BINDING_TABLE} (channel_type, token_hash, owner_user_id, client_id, channel_identity, created_at, updated_at) VALUES ('serverchan3', ?, ?, ?, ?, ?, ?) ON CONFLICT(channel_type, token_hash) DO UPDATE SET owner_user_id = excluded.owner_user_id, client_id = excluded.client_id, channel_identity = excluded.channel_identity, updated_at = excluded.updated_at`).bind(tokenHash, account.userId, account.clientId, serverChan3.uid, timestamp, timestamp));
    }
  }
  if (statements.length) await env.SYNC_DB.batch(statements);
  marks.write = Date.now() - startedAt - marks.schema - marks.read - marks.conflicts;
  console.log('[notify-settings-timing]', JSON.stringify({ totalMs: Date.now() - startedAt, ...marks, conflicts: conflicts.length, cleared: deletes.length }));

  return timingResponse({ ok: true, setup: { barkDeviceKey, serverChan3: { uid: text(serverChan3.uid), sendKeyMasked: maskServerChan3SendKey(serverChan3.sendKey || ''), configured: Boolean(serverChan3.uid && serverChan3.sendKey) }, clientId: text(payload.clientId) || account.clientId, accountClientId: account.clientId, accountUsername: account.username, clientLabel: label } }, request, marks);
}

export { AccountSettingsError, hashToken };
