import { jsonResponse, readOrigin } from './notifyHttp.js';
import { VERIFIED_NOTIFY_USER_ID_HEADER, VERIFIED_NOTIFY_USERNAME_HEADER } from './notifyAccountAuth.js';
import { buildAccountClientId, normalizeNotifyUserId } from './clientSettings.js';

const RECORD_TABLE = 'notify_user_records';
const BINDING_TABLE = 'notify_channel_bindings';
const SUPPORTED_CHANNELS = new Set(['bark', 'serverchan3']);

function text(value = '', max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function readAccount(request) {
  const userId = normalizeNotifyUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER));
  const username = text(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER), 48).toLowerCase();
  if (!userId || !username) {
    const error = new Error('请先登录账户后配置通知。');
    error.status = 401;
    error.code = 'AUTH_REQUIRED';
    throw error;
  }
  return { userId, username, clientId: buildAccountClientId(userId) };
}

export function detectChannelDeletes(payload = {}) {
  const channels = [];
  if (Object.prototype.hasOwnProperty.call(payload, 'barkDeviceKey') && !text(payload.barkDeviceKey, 512)) {
    channels.push('bark');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'serverChan3')) {
    const config = payload.serverChan3 && typeof payload.serverChan3 === 'object' ? payload.serverChan3 : {};
    if (!text(config.uid) && !text(config.sendKey, 512)) channels.push('serverchan3');
  }
  return channels;
}

function readDeleteChannels(request, payload = null) {
  if (payload) return detectChannelDeletes(payload);
  const values = new URL(request.url).searchParams.getAll('channel')
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => SUPPORTED_CHANNELS.has(value));
  return Array.from(new Set(values));
}

export async function handleAccountChannelDelete(request, env, payload = null) {
  const startedAt = Date.now();
  const account = readAccount(request);
  const channels = readDeleteChannels(request, payload);
  if (!channels.length) {
    return jsonResponse({ error: '缺少要移除的通知渠道', code: 'CHANNEL_REQUIRED' }, {
      status: 400,
      origin: readOrigin(request)
    });
  }
  if (!env?.SYNC_DB?.prepare || !env?.SYNC_DB?.batch) {
    const error = new Error('通知账户存储暂不可用。');
    error.status = 503;
    error.code = 'AUTH_UNAVAILABLE';
    throw error;
  }

  const statements = [];
  for (const channel of channels) {
    const suffix = `::${channel}`;
    // owner_user_id 先缩小到当前账号，再清除 canonical 与历史 device client 的同渠道记录。
    statements.push(env.SYNC_DB.prepare(`DELETE FROM ${RECORD_TABLE}
      WHERE owner_user_id = ? AND record_type = 'client-channel'
        AND substr(record_id, -?) = ?`)
      .bind(account.userId, suffix.length, suffix));
    statements.push(env.SYNC_DB.prepare(`DELETE FROM ${BINDING_TABLE}
      WHERE owner_user_id = ? AND channel_type = ?`)
      .bind(account.userId, channel));
  }
  const writeStartedAt = Date.now();
  const results = await env.SYNC_DB.batch(statements);
  const writeMs = Date.now() - writeStartedAt;
  const deleted = results.reduce((sum, result) => sum + (Number(result?.meta?.changes) || 0), 0);
  const totalMs = Date.now() - startedAt;
  console.log('[notify-channel-delete-timing]', JSON.stringify({
    channels,
    statementCount: statements.length,
    deleted,
    writeMs,
    totalMs
  }));

  const response = jsonResponse({
    ok: true,
    deleted,
    channels,
    setup: {
      ...(channels.includes('bark') ? { barkDeviceKey: '' } : {}),
      ...(channels.includes('serverchan3') ? { serverChan3: { uid: '', sendKeyMasked: '', configured: false } } : {}),
      accountClientId: account.clientId,
      accountUsername: account.username
    }
  }, { origin: readOrigin(request) });
  const headers = new Headers(response.headers);
  headers.set('server-timing', `write;dur=${writeMs}, total;dur=${totalMs}`);
  return new Response(response.body, { status: response.status, headers });
}
