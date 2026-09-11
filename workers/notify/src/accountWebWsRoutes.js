import { jsonResponse, readOrigin } from './notifyHttp.js';
import { VERIFIED_NOTIFY_USER_ID_HEADER, VERIFIED_NOTIFY_USERNAME_HEADER } from './notifyAccountAuth.js';
import { buildAccountClientId, hashText, normalizeClientId, normalizeClientName, normalizeClientSecret, normalizeDeviceInstallationId, normalizeNotifyUserId, randomString } from './clientSettings.js';

const TABLE = 'notify_user_records';
const WS_PREFIX = '/api/notify/ws/';
function text(value = '', max = 240) { return String(value ?? '').trim().slice(0, max); }
function parse(value, fallback = {}) { try { const data = JSON.parse(String(value || '')); return data && typeof data === 'object' ? data : fallback; } catch { return fallback; } }
function accountOf(request) { const userId = normalizeNotifyUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER)); const username = text(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER), 48).toLowerCase(); if (!userId || !username) { const error = new Error('请先登录账户。'); error.status = 401; error.code = 'AUTH_REQUIRED'; throw error; } return { userId, username, clientId: buildAccountClientId(userId) }; }
function nowIso() { return new Date().toISOString(); }
function rowStatement(db, owner, type, id, payload) { const now = nowIso(); return db.prepare(`INSERT INTO ${TABLE} (owner_user_id, record_type, record_id, payload, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(owner_user_id, record_type, record_id) DO UPDATE SET payload=excluded.payload, revision=${TABLE}.revision+1, updated_at=excluded.updated_at`).bind(owner, type, id, JSON.stringify(payload), now, now); }
async function readClient(env, owner, clientId) { const row = await env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'client' AND record_id = ?`).bind(owner, clientId).first(); return row ? parse(row.payload) : null; }
function capabilities(value) { const raw = Array.isArray(value) ? value : String(value || '').split(','); const result = raw.map((item) => String(item || '').trim().toLowerCase()).filter((item) => item === 'notify' || item === 'market'); return result.length ? Array.from(new Set(result)) : ['notify', 'market']; }

export async function handleFastWebWsRegistration(request, env, unregister = false) {
  const origin = readOrigin(request); const account = accountOf(request); const payload = await request.json().catch(() => ({}));
  const clientId = normalizeClientId(payload.clientId); const secret = normalizeClientSecret(payload.clientSecret);
  if (!clientId || !secret) return jsonResponse({ ok: false, message: '缺少设备 clientId 或 clientSecret。' }, { status: 400, origin });
  const current = await readClient(env, account.userId, clientId); const secretHash = await hashText(secret);
  if (current?.ownerUserId && current.ownerUserId !== account.userId) return jsonResponse({ ok: false, message: '当前设备已绑定其他账号。' }, { status: 403, origin });
  if (current?.clientSecretHash && current.clientSecretHash !== secretHash) return jsonResponse({ ok: false, message: 'clientSecret 验证失败。' }, { status: 401, origin });
  const deviceId = `web-ws:${clientId}`;
  if (unregister) {
    await env.SYNC_DB.prepare(`DELETE FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'registration' AND record_id = ?`).bind(account.userId, deviceId).run();
    return jsonResponse({ ok: true }, { origin });
  }
  const label = normalizeClientName(payload.clientLabel || payload.label || payload.clientName || current?.clientLabel || '');
  const token = randomString(64); const now = nowIso();
  const client = { ...(current || {}), clientId, clientLabel: label, accountUsername: account.username, ownerUserId: account.userId, accountClientId: account.clientId, isDeviceOnly: true, notifyGroupId: account.clientId, clientSecretHash: secretHash };
  const registration = { id: deviceId, deviceInstallationId: deviceId, deviceName: `Web · ${label || clientId}`, packageName: '', token, isWebClient: true, capabilities: capabilities(payload.capabilities), pairedClients: [{ clientId, groupId: account.clientId, clientName: label, pairedAt: now, lastSeenAt: now }], createdAt: now, updatedAt: now };
  await env.SYNC_DB.batch([rowStatement(env.SYNC_DB, account.userId, 'client', clientId, client), rowStatement(env.SYNC_DB, account.userId, 'registration', deviceId, registration)]);
  return jsonResponse({ ok: true, deviceInstallationId: deviceId, token }, { origin });
}

export async function handleFastWebSocketConnect(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || !url.pathname.startsWith(WS_PREFIX) || url.pathname === '/api/notify/ws/register' || url.pathname === '/api/notify/ws/unregister') return null;
  if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return null;
  const deviceId = normalizeDeviceInstallationId(decodeURIComponent(url.pathname.slice(WS_PREFIX.length).split('/')[0] || ''));
  if (!deviceId) return jsonResponse({ ok: false, message: '缺少 deviceInstallationId。' }, { status: 400, origin: readOrigin(request) });
  const tokenProtocol = String(request.headers.get('sec-websocket-protocol') || '').split(',').map((item) => item.trim()).find((item) => item.startsWith('jijin-token-')) || '';
  const token = tokenProtocol.slice('jijin-token-'.length).trim();
  if (!token) return jsonResponse({ ok: false, message: '缺少 token 子协议。' }, { status: 401, origin: readOrigin(request) });
  const row = await env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE} WHERE record_type = 'registration' AND record_id = ? LIMIT 1`).bind(deviceId).first();
  const registration = parse(row?.payload, null);
  if (!registration) return jsonResponse({ ok: false, message: '未找到设备注册记录。' }, { status: 404, origin: readOrigin(request) });
  if (text(registration.token, 512) !== token) return jsonResponse({ ok: false, message: 'token 与注册记录不一致。' }, { status: 401, origin: readOrigin(request) });
  const stub = env.WS_HUB.get(env.WS_HUB.idFromName(deviceId)); const headers = new Headers(request.headers); headers.set('x-device-installation-id', deviceId);
  return stub.fetch('https://ws-hub/connect', new Request(request, { headers }));
}
