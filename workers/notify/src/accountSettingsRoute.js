import { maskServerChan3SendKey, normalizeServerChan3Config } from './channels/serverChan3.js';
import { jsonResponse, readOrigin } from './notifyHttp.js';
import { VERIFIED_NOTIFY_USER_ID_HEADER, VERIFIED_NOTIFY_USERNAME_HEADER } from './notifyAccountAuth.js';
import { buildAccountClientId, normalizeClientName, normalizeNotifyUserId } from './clientSettings.js';
import { mergeAccountResourceNotifySettings, readAccountResourceNotifySettings } from './accountResourceSettings.js';

const RECORD_TABLE = 'notify_user_records';
const BINDING_TABLE = 'notify_channel_bindings';
function nowIso() { return new Date().toISOString(); }
function text(value = '', max = 240) { return String(value ?? '').trim().slice(0, max); }
function parse(value, fallback = {}) { try { const data = JSON.parse(String(value || '')); return data && typeof data === 'object' ? data : fallback; } catch { return fallback; } }
function channelRecordId(clientId, channel) { return `${clientId}::${channel}`; }
export class AccountSettingsError extends Error { constructor(message, status = 400, code = '') { super(message); this.status = status; this.code = code; } }
export async function hashToken(value = '') { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '').trim())); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''); }
function accountOf(request) { const userId = normalizeNotifyUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER)); const username = text(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER), 48).toLowerCase(); if (!userId || !username) throw new AccountSettingsError('请先登录账户后配置通知。', 401, 'AUTH_REQUIRED'); return { userId, username, clientId: buildAccountClientId(userId) }; }
function rowStatement(db, owner, type, id, payload, now) { return db.prepare(`INSERT INTO ${RECORD_TABLE} (owner_user_id, record_type, record_id, payload, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(owner_user_id, record_type, record_id) DO UPDATE SET payload=excluded.payload, revision=${RECORD_TABLE}.revision+1, updated_at=excluded.updated_at`).bind(owner, type, id, JSON.stringify(payload), now, now); }
async function loadChannels(env, account) { const [result, resource] = await Promise.all([env.SYNC_DB.prepare(`SELECT record_id, payload FROM ${RECORD_TABLE} WHERE owner_user_id = ? AND record_type = 'client-channel' AND record_id IN (?, ?, ?)`).bind(account.userId, channelRecordId(account.clientId, 'bark'), channelRecordId(account.clientId, 'serverchan3'), channelRecordId(account.clientId, 'email')).all(), readAccountResourceNotifySettings(env, account.userId)]); const value = { barkDeviceKey: '', serverChan3: {}, email: {} }; for (const row of result?.results || []) { const payload = parse(row.payload); if (String(row.record_id).endsWith('::bark')) value.barkDeviceKey = text(payload.barkDeviceKey); else if (String(row.record_id).endsWith('::serverchan3')) value.serverChan3 = normalizeServerChan3Config(payload.serverChan3 || {}); else if (String(row.record_id).endsWith('::email')) value.email = payload.email || {}; } const merged = mergeAccountResourceNotifySettings(value, resource); return { ...merged, serverChan3: normalizeServerChan3Config(merged.serverChan3 || {}) }; }
async function findBinding(env, channel, tokenHash, identity = '') { if (tokenHash) { const exact = await env.SYNC_DB.prepare(`SELECT channel_type, token_hash, owner_user_id, client_id, channel_identity FROM ${BINDING_TABLE} WHERE channel_type = ? AND token_hash = ?`).bind(channel, tokenHash).first(); if (exact) return exact; } if (channel === 'serverchan3' && identity) return env.SYNC_DB.prepare(`SELECT channel_type, token_hash, owner_user_id, client_id, channel_identity FROM ${BINDING_TABLE} WHERE channel_type = 'serverchan3' AND lower(channel_identity) = lower(?) LIMIT 1`).bind(identity).first(); return null; }
function bindingUpsert(db, channel, hash, account, identity, now) { return db.prepare(`INSERT INTO ${BINDING_TABLE} (channel_type, token_hash, owner_user_id, client_id, channel_identity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(channel_type, token_hash) DO UPDATE SET owner_user_id=excluded.owner_user_id, client_id=excluded.client_id, channel_identity=excluded.channel_identity, updated_at=excluded.updated_at`).bind(channel, hash, account.userId, account.clientId, identity, now, now); }
async function cleanupLegacy(env, account, channels) { for (const channel of channels) { const suffix = `::${channel}`; await env.SYNC_DB.prepare(`DELETE FROM ${RECORD_TABLE} WHERE owner_user_id = ? AND record_type = 'client-channel' AND record_id != ? AND substr(record_id, -?) = ?`).bind(account.userId, channelRecordId(account.clientId, channel), suffix.length, suffix).run(); } }
async function syncAccountResourceChannels(env, account, channels, values) {
  try {
    const now = nowIso();
    const statements = channels.map((channel) => {
      const payload = JSON.stringify(values[channel] || {});
      return env.SYNC_DB.prepare(`INSERT INTO account_resource_records
        (user_id, resource, record_id, parent_id, record_kind, position, revision, content_hash, bytes, payload, deleted, created_at, updated_at, updated_by_end_id, updated_by_end_type)
        VALUES (?, 'notify/client-config', ?, '', 'channel', 1, 1, '', ?, ?, 0, ?, ?, '', 'notify-compat')
        ON CONFLICT(user_id, resource, record_id) DO UPDATE SET
          revision = account_resource_records.revision + 1, payload = excluded.payload, bytes = excluded.bytes,
          deleted = 0, updated_at = excluded.updated_at, updated_by_end_type = excluded.updated_by_end_type`)
        .bind(account.userId, `channel:${channel}`, payload.length, payload, now, now);
    });
    if (statements.length) await env.SYNC_DB.batch(statements);
  } catch (error) {
    console.log('[notify-account-resource-sync-failed]', JSON.stringify({ message: error instanceof Error ? error.message : String(error) }));
  }
}
function response(payload, request, startedAt, readMs, writeMs) { const result = jsonResponse(payload, { origin: readOrigin(request) }); const headers = new Headers(result.headers); headers.set('server-timing', `read;dur=${readMs}, write;dur=${writeMs}, total;dur=${Date.now() - startedAt}`); return new Response(result.body, { status: result.status, headers }); }

export async function handleAccountSettings(request, env, ctx = null) {
  const startedAt = Date.now(); if (!env?.SYNC_DB?.prepare || !env?.SYNC_DB?.batch) throw new AccountSettingsError('通知账户存储暂不可用。', 503, 'AUTH_UNAVAILABLE');
  const account = accountOf(request); const payload = await request.json().catch(() => ({})); const readAt = Date.now(); const current = await loadChannels(env, account); const readMs = Date.now() - readAt;
  const barkProvided = Object.prototype.hasOwnProperty.call(payload, 'barkDeviceKey'); const serverProvided = Object.prototype.hasOwnProperty.call(payload, 'serverChan3');
  const barkDeviceKey = barkProvided ? text(payload.barkDeviceKey) : current.barkDeviceKey; const serverChan3 = serverProvided ? normalizeServerChan3Config(payload.serverChan3 || {}) : current.serverChan3;
  if (serverProvided && serverChan3.uid && !serverChan3.sendKey && current.serverChan3?.uid === serverChan3.uid) serverChan3.sendKey = current.serverChan3.sendKey;
  const rebind = text(payload.rebindChannel, 32).toLowerCase(); const barkHash = barkProvided && barkDeviceKey ? await hashToken(barkDeviceKey) : ''; const serverHash = serverProvided && serverChan3.uid && serverChan3.sendKey ? await hashToken(`${serverChan3.uid.toLowerCase()}:${serverChan3.sendKey}`) : '';
  const [barkBinding, serverBinding] = await Promise.all([barkProvided ? findBinding(env, 'bark', barkHash) : null, serverProvided ? findBinding(env, 'serverchan3', serverHash, serverChan3.uid) : null]);
  if (barkBinding?.owner_user_id && barkBinding.owner_user_id !== account.userId && rebind !== 'bark') throw new AccountSettingsError('该 Bark 通道已绑定其他账号，需要确认换绑。', 409, 'CHANNEL_REBIND_REQUIRED');
  if (serverBinding?.owner_user_id && serverBinding.owner_user_id !== account.userId) { if (serverBinding.token_hash !== serverHash) throw new AccountSettingsError('该 Server酱³ UID 已绑定其他账号，但 SendKey 不匹配。', 409, 'CHANNEL_BINDING_MISMATCH'); if (rebind !== 'serverchan3') throw new AccountSettingsError('该 Server酱³ 通道已绑定其他账号，需要确认换绑。', 409, 'CHANNEL_REBIND_REQUIRED'); }
  const now = nowIso(); const label = normalizeClientName(payload.clientLabel || `账号通知 · ${account.username}`); const statements = [];
  for (const [channel, binding] of [['bark', barkBinding], ['serverchan3', serverBinding]]) if (binding?.owner_user_id && binding.owner_user_id !== account.userId) { statements.push(env.SYNC_DB.prepare(`DELETE FROM ${RECORD_TABLE} WHERE owner_user_id = ? AND record_type = 'client-channel' AND record_id = ?`).bind(binding.owner_user_id, channelRecordId(binding.client_id, channel))); statements.push(env.SYNC_DB.prepare(`DELETE FROM ${BINDING_TABLE} WHERE channel_type = ? AND token_hash = ?`).bind(channel, binding.token_hash)); }
  statements.push(rowStatement(env.SYNC_DB, account.userId, 'client', account.clientId, { clientId: account.clientId, clientLabel: label, accountUsername: account.username, ownerUserId: account.userId, accountClientId: account.clientId, isDeviceOnly: false, notifyGroupId: account.clientId, clientSecretHash: '' }, now));
  if (barkProvided) { statements.push(rowStatement(env.SYNC_DB, account.userId, 'client-channel', channelRecordId(account.clientId, 'bark'), { clientId: account.clientId, barkDeviceKey }, now)); statements.push(env.SYNC_DB.prepare(`DELETE FROM ${BINDING_TABLE} WHERE owner_user_id = ? AND channel_type = 'bark'`).bind(account.userId)); if (barkHash) statements.push(bindingUpsert(env.SYNC_DB, 'bark', barkHash, account, '', now)); }
  if (serverProvided) { statements.push(rowStatement(env.SYNC_DB, account.userId, 'client-channel', channelRecordId(account.clientId, 'serverchan3'), { clientId: account.clientId, serverChan3 }, now)); statements.push(env.SYNC_DB.prepare(`DELETE FROM ${BINDING_TABLE} WHERE owner_user_id = ? AND channel_type = 'serverchan3'`).bind(account.userId)); if (serverHash) statements.push(bindingUpsert(env.SYNC_DB, 'serverchan3', serverHash, account, serverChan3.uid, now)); }
  const writeAt = Date.now(); await env.SYNC_DB.batch(statements); const writeMs = Date.now() - writeAt;
  const channels = [...(barkProvided ? ['bark'] : []), ...(serverProvided ? ['serverchan3'] : [])]; if (channels.length) { const task = cleanupLegacy(env, account, channels).catch((error) => console.log('[notify-settings-legacy-cleanup-failed]', String(error?.message || error))); if (ctx?.waitUntil) ctx.waitUntil(task); else task.catch(() => {}); }
  if (channels.length) {
    const resourceTask = syncAccountResourceChannels(env, account, channels, {
      bark: { barkDeviceKey },
      serverchan3: { serverChan3Uid: text(serverChan3.uid), serverChan3SendKey: text(serverChan3.sendKey) }
    });
    if (ctx?.waitUntil) ctx.waitUntil(resourceTask); else resourceTask.catch(() => {});
  }
  return response({ ok: true, setup: { barkDeviceKey, serverChan3: { uid: text(serverChan3.uid), sendKeyMasked: maskServerChan3SendKey(serverChan3.sendKey || ''), configured: Boolean(serverChan3.uid && serverChan3.sendKey) }, clientId: text(payload.clientId) || account.clientId, accountClientId: account.clientId, accountUsername: account.username, clientLabel: label } }, request, startedAt, readMs, writeMs);
}
