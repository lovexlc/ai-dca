const TABLE = 'notify_user_records';
const MAX_ACK_HISTORY_PER_MESSAGE = 20;
const ALLOWED_ACK_STAGES = new Set(['received', 'displayed', 'opened', 'deduped', 'failed']);
function text(value = '', max = 240) { return String(value ?? '').trim().slice(0, max); }
function parse(value, fallback = {}) { try { const data = JSON.parse(String(value || '')); return data && typeof data === 'object' ? data : fallback; } catch { return fallback; } }
function normalizeAckStage(value = '') { const stage = text(value).toLowerCase(); return ALLOWED_ACK_STAGES.has(stage) ? stage : 'received'; }
function normalizeAckSource(value = '') { const source = text(value).toLowerCase(); return ['ws', 'fcm', 'http', 'local'].includes(source) ? source : 'unknown'; }
function normalizeIso(value = '') { const parsed = Date.parse(text(value)); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString(); }
function resolveMessageId(payload = {}) { const data = payload?.data && typeof payload.data === 'object' ? payload.data : {}; return text(payload.messageId || payload.eventId || payload.id || data.messageId || data.eventId || data.id, 240); }
function normalizeDeliveryAck(payload = {}, overrides = {}) {
  const messageId = resolveMessageId(payload); if (!messageId) throw new Error('ACK 缺少 messageId 或 eventId。');
  const at = normalizeIso(payload.at || payload.ts || payload.ackAt || payload.receivedAt || payload.displayedAt);
  return { messageId, eventId: text(payload.eventId || payload.data?.eventId || messageId, 240), stage: normalizeAckStage(payload.stage || payload.status || payload.ackStage), source: normalizeAckSource(overrides.source || payload.source || payload.channel), deviceInstallationId: text(overrides.deviceInstallationId || payload.deviceInstallationId || payload.installationId, 160), connectionId: text(overrides.connectionId || payload.connectionId, 160), detail: text(payload.detail || payload.error, 500), at };
}
function mergeAckRecord(current = {}, ack = {}) {
  const history = Array.isArray(current.history) ? current.history : [];
  return { messageId: ack.messageId, eventId: ack.eventId || current.eventId || ack.messageId, lastStage: ack.stage, lastSource: ack.source, lastAckAt: ack.at, updatedAt: ack.at, stages: { ...(current.stages || {}), [ack.stage]: ack.at }, history: [...history, ack].slice(-MAX_ACK_HISTORY_PER_MESSAGE) };
}
export function attachDeliveryAckToEvent(event = {}, deliveryAcks = {}) {
  if (!event || typeof event !== 'object') return event;
  const eventId = text(event.id || event.eventId || event.messageId, 240); const ack = deliveryAcks?.[eventId] || deliveryAcks?.[text(event.messageId, 240)] || null;
  return ack ? { ...event, messageId: event.messageId || ack.messageId || eventId, deliveryAck: ack } : event;
}
async function findRegistration(env, deviceId, token) {
  if (deviceId) return env.SYNC_DB.prepare(`SELECT owner_user_id, payload FROM ${TABLE} WHERE record_type = 'registration' AND record_id = ? LIMIT 1`).bind(deviceId).first();
  if (token) return env.SYNC_DB.prepare(`SELECT owner_user_id, payload FROM ${TABLE} WHERE record_type = 'registration' AND json_extract(payload, '$.token') = ? LIMIT 1`).bind(token).first();
  return null;
}
export async function recordDeliveryAck(env, payload = {}, options = {}) {
  if (!env?.SYNC_DB?.prepare || !env?.SYNC_DB?.batch) throw new Error('ACK 存储暂不可用。');
  const ack = normalizeDeliveryAck(payload, options); const token = text(payload.token || payload.registrationToken || options.token, 512);
  const row = await findRegistration(env, ack.deviceInstallationId, token); const registration = parse(row?.payload, null);
  if (options.requireToken && (!token || !registration || text(registration.token, 512) !== token)) throw new Error('ACK 鉴权失败：设备 ID 或 token 不匹配。');
  const pairedIds = Array.from(new Set((registration?.pairedClients || []).map((item) => text(item?.clientId, 120)).filter(Boolean)));
  const explicitClientId = text(payload.clientId || options.clientId, 120);
  const clientIds = explicitClientId ? pairedIds.filter((id) => id === explicitClientId) : pairedIds;
  if (!clientIds.length) return { ok: true, recorded: 0, messageId: ack.messageId, stage: ack.stage, reason: 'no-paired-client' };
  const owner = text(row?.owner_user_id, 96); const ids = clientIds.map((clientId) => `${clientId}::${ack.messageId}`);
  const reads = await env.SYNC_DB.batch(ids.map((id) => env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE} WHERE owner_user_id = ? AND record_type = 'delivery-ack' AND record_id = ?`).bind(owner, id)));
  const now = new Date().toISOString();
  const writes = clientIds.map((clientId, index) => {
    const currentPayload = parse(reads[index]?.results?.[0]?.payload, {}); const value = mergeAckRecord(currentPayload?.value || {}, { ...ack, clientId });
    return env.SYNC_DB.prepare(`INSERT INTO ${TABLE} (owner_user_id, record_type, record_id, payload, revision, created_at, updated_at) VALUES (?, 'delivery-ack', ?, ?, 1, ?, ?) ON CONFLICT(owner_user_id, record_type, record_id) DO UPDATE SET payload=excluded.payload, revision=${TABLE}.revision+1, updated_at=excluded.updated_at`).bind(owner, `${clientId}::${ack.messageId}`, JSON.stringify({ clientId, messageId: ack.messageId, updatedAt: ack.at, value }), now, now);
  });
  await env.SYNC_DB.batch(writes);
  return { ok: true, recorded: clientIds.length, clientIds, messageId: ack.messageId, stage: ack.stage, source: ack.source };
}
