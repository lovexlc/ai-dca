const SETTINGS_KEY = 'notify:settings';
const MAX_ACKS_PER_CLIENT = 200;
const MAX_ACK_HISTORY_PER_MESSAGE = 20;
const ALLOWED_ACK_STAGES = new Set(['received', 'displayed', 'opened', 'deduped', 'failed']);

function normalizeClientId(value = '') {
  return String(value || '').trim().slice(0, 120);
}

function normalizeDeviceInstallationId(value = '') {
  return String(value || '').trim().slice(0, 160);
}

function normalizeAckStage(value = '') {
  const stage = String(value || '').trim().toLowerCase();
  return ALLOWED_ACK_STAGES.has(stage) ? stage : 'received';
}

function normalizeAckSource(value = '') {
  const source = String(value || '').trim().toLowerCase();
  if (source === 'ws' || source === 'fcm' || source === 'http' || source === 'local') return source;
  return 'unknown';
}

function normalizeIso(value = '') {
  const raw = String(value || '').trim();
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function resolveMessageId(payload = {}) {
  const data = payload && typeof payload.data === 'object' && payload.data ? payload.data : {};
  return String(
    payload.messageId
    || payload.eventId
    || payload.id
    || data.messageId
    || data.eventId
    || data.id
    || ''
  ).trim().slice(0, 240);
}

function readJsonSafe(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (_error) { return fallback; }
}

async function readSettings(env) {
  if (!env || !env.NOTIFY_STATE) throw new Error('未配置 NOTIFY_STATE KV 绑定。');
  return readJsonSafe(await env.NOTIFY_STATE.get(SETTINGS_KEY), { clients: {}, gcmRegistrations: [] });
}

async function writeSettings(env, settings) {
  if (!env || !env.NOTIFY_STATE) throw new Error('未配置 NOTIFY_STATE KV 绑定。');
  await env.NOTIFY_STATE.put(SETTINGS_KEY, JSON.stringify(settings || {}));
}

function findRegistration(settings = {}, { deviceInstallationId = '', token = '' } = {}) {
  const normalizedDeviceInstallationId = normalizeDeviceInstallationId(deviceInstallationId);
  const normalizedToken = String(token || '').trim();
  const registrations = Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations : [];
  return registrations.find((registration) => {
    const regDeviceId = normalizeDeviceInstallationId(registration?.deviceInstallationId || registration?.id || '');
    const regToken = String(registration?.token || '').trim();
    if (normalizedDeviceInstallationId && regDeviceId !== normalizedDeviceInstallationId) return false;
    if (normalizedToken && regToken !== normalizedToken) return false;
    return Boolean(regDeviceId || regToken);
  }) || null;
}

function resolveClientIds(settings = {}, registration = null, explicitClientId = '') {
  const paired = Array.isArray(registration?.pairedClients) ? registration.pairedClients : [];
  const pairedIds = Array.from(new Set(paired.map((item) => normalizeClientId(item?.clientId)).filter(Boolean)))
    .filter((id) => settings.clients && settings.clients[id]);
  const clientId = normalizeClientId(explicitClientId);
  if (clientId) {
    return pairedIds.includes(clientId) ? [clientId] : [];
  }
  return pairedIds;
}

function normalizeDeliveryAck(payload = {}, overrides = {}) {
  const messageId = resolveMessageId(payload);
  if (!messageId) throw new Error('ACK 缺少 messageId 或 eventId。');
  const deviceInstallationId = normalizeDeviceInstallationId(
    overrides.deviceInstallationId || payload.deviceInstallationId || payload.installationId || ''
  );
  const source = normalizeAckSource(overrides.source || payload.source || payload.channel || 'unknown');
  const stage = normalizeAckStage(payload.stage || payload.status || payload.ackStage || 'received');
  const at = normalizeIso(payload.at || payload.ts || payload.ackAt || payload.receivedAt || payload.displayedAt || '');
  return {
    messageId,
    eventId: String(payload.eventId || payload.data?.eventId || messageId).trim().slice(0, 240),
    stage,
    source,
    deviceInstallationId,
    connectionId: String(overrides.connectionId || payload.connectionId || '').trim().slice(0, 160),
    detail: String(payload.detail || payload.error || '').trim().slice(0, 500),
    at
  };
}

function trimAckMap(acks = {}) {
  const entries = Object.entries(acks || {}).sort((left, right) => {
    const leftAt = Date.parse(String(left[1]?.updatedAt || left[1]?.lastAckAt || '')) || 0;
    const rightAt = Date.parse(String(right[1]?.updatedAt || right[1]?.lastAckAt || '')) || 0;
    return rightAt - leftAt;
  });
  return Object.fromEntries(entries.slice(0, MAX_ACKS_PER_CLIENT));
}

function mergeAckRecord(current = {}, ack = {}) {
  const history = Array.isArray(current.history) ? current.history : [];
  const nextHistory = [...history, ack].slice(-MAX_ACK_HISTORY_PER_MESSAGE);
  const stages = { ...(current.stages || {}) };
  stages[ack.stage] = ack.at;
  return {
    messageId: ack.messageId,
    eventId: ack.eventId || current.eventId || ack.messageId,
    lastStage: ack.stage,
    lastSource: ack.source,
    lastAckAt: ack.at,
    updatedAt: ack.at,
    stages,
    history: nextHistory
  };
}

export function attachDeliveryAckToEvent(event = {}, deliveryAcks = {}) {
  if (!event || typeof event !== 'object') return event;
  const eventId = String(event.id || event.eventId || event.messageId || '').trim();
  const ack = deliveryAcks?.[eventId] || deliveryAcks?.[String(event.messageId || '').trim()] || null;
  if (!ack) return event;
  return {
    ...event,
    messageId: event.messageId || ack.messageId || eventId,
    deliveryAck: ack
  };
}

export async function recordDeliveryAck(env, payload = {}, options = {}) {
  const ack = normalizeDeliveryAck(payload, options);
  const settings = await readSettings(env);
  const token = String(payload.token || payload.registrationToken || options.token || '').trim();
  const registration = findRegistration(settings, { deviceInstallationId: ack.deviceInstallationId, token });

  if (options.requireToken && (!token || !registration)) {
    throw new Error('ACK 鉴权失败：设备 ID 或 token 不匹配。');
  }

  const clientIds = resolveClientIds(settings, registration, payload.clientId || options.clientId || '');
  if (!clientIds.length) {
    return { ok: true, recorded: 0, messageId: ack.messageId, stage: ack.stage, reason: 'no-paired-client' };
  }

  const clients = { ...(settings.clients || {}) };
  for (const clientId of clientIds) {
    const client = clients[clientId] || { clientId, state: {} };
    const state = { ...(client.state || {}) };
    const deliveryAcks = { ...(state.deliveryAcks || {}) };
    deliveryAcks[ack.messageId] = mergeAckRecord(deliveryAcks[ack.messageId], { ...ack, clientId });
    state.deliveryAcks = trimAckMap(deliveryAcks);
    clients[clientId] = { ...client, state };
  }

  await writeSettings(env, { ...settings, clients });
  return { ok: true, recorded: clientIds.length, clientIds, messageId: ack.messageId, stage: ack.stage, source: ack.source };
}
