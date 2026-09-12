const SNAPSHOT_TABLE = 'notify_switch_snapshots';
const OUTBOX_TABLE = 'notify_switch_trigger_outbox';
const DELIVERY_TABLE = 'notify_delivery_attempts';
const schemaPromises = new WeakMap();
function nowIso() { return new Date().toISOString(); }
function text(value = '', max = 500) { return String(value ?? '').trim().slice(0, max); }
function json(value) { try { return JSON.stringify(value ?? {}); } catch { return '{}'; } }
function parse(value, fallback = null) { try { const result = JSON.parse(String(value || '')); return result && typeof result === 'object' ? result : fallback; } catch { return fallback; } }
async function hash(value) { const bytes = new TextEncoder().encode(String(value)); const digest = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
export async function ensureNotifyReliabilitySchema(env) {
  if (!env?.SYNC_DB?.prepare) throw new Error('SYNC_DB unavailable');
  const existing = schemaPromises.get(env.SYNC_DB); if (existing) return existing;
  const promise = (async () => {
    await env.SYNC_DB.prepare(`CREATE TABLE IF NOT EXISTS ${SNAPSHOT_TABLE} (snapshot_id TEXT PRIMARY KEY, source TEXT NOT NULL, computed_at TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)`).run();
    await env.SYNC_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notify_switch_snapshots_computed ON ${SNAPSHOT_TABLE} (computed_at DESC)`).run();
    await env.SYNC_DB.prepare(`CREATE TABLE IF NOT EXISTS ${OUTBOX_TABLE} (outbox_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, client_id TEXT NOT NULL, event_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, queued_at TEXT, updated_at TEXT NOT NULL, UNIQUE (snapshot_id, owner_user_id, client_id, event_id))`).run();
    await env.SYNC_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notify_switch_outbox_status ON ${OUTBOX_TABLE} (status, updated_at)`).run();
    await env.SYNC_DB.prepare(`CREATE TABLE IF NOT EXISTS ${DELIVERY_TABLE} (owner_user_id TEXT NOT NULL, event_id TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, result_payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_user_id, event_id, channel))`).run();
    await env.SYNC_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notify_delivery_attempts_event ON ${DELIVERY_TABLE} (owner_user_id, event_id)`).run();
  })().catch((error) => { schemaPromises.delete(env.SYNC_DB); throw error; });
  schemaPromises.set(env.SYNC_DB, promise); return promise;
}
export async function saveImmutableSwitchSnapshot(env, snapshot) {
  await ensureNotifyReliabilitySchema(env);
  const computedAt = text(snapshot?.computedAt, 80) || nowIso();
  const canonical = json({ computedAt, source: snapshot?.source, codes: snapshot?.codes, funds: snapshot?.funds, pairs: snapshot?.pairs });
  const snapshotId = `switch-${computedAt.replace(/[^0-9]/g, '').slice(0, 14)}-${await hash(canonical)}`;
  await env.SYNC_DB.prepare(`INSERT OR IGNORE INTO ${SNAPSHOT_TABLE} (snapshot_id, source, computed_at, payload, created_at) VALUES (?, ?, ?, ?, ?)`).bind(snapshotId, text(snapshot?.source, 120) || 'market-collector', computedAt, canonical, nowIso()).run();
  return snapshotId;
}
export async function loadSwitchSnapshot(env, snapshotId) {
  await ensureNotifyReliabilitySchema(env);
  const row = await env.SYNC_DB.prepare(`SELECT payload FROM ${SNAPSHOT_TABLE} WHERE snapshot_id=?`).bind(text(snapshotId, 160)).first();
  const value = parse(row?.payload, null); if (!value) throw new Error('switch snapshot not found');
  const pairsByKey = {}; for (const pair of value.pairs || []) if (pair?.pairKey) pairsByKey[pair.pairKey] = pair;
  return { ...value, snapshotId: text(snapshotId, 160), pairsByKey };
}
export async function enqueueTriggerOutbox(env, entry) {
  await ensureNotifyReliabilitySchema(env);
  const outboxId = `switch-outbox-${await hash(`${entry.snapshotId}|${entry.ownerUserId}|${entry.clientId}|${entry.notification.eventId}`)}`;
  const timestamp = nowIso(); const payload = json(entry.notification);
  const inserted = await env.SYNC_DB.prepare(`INSERT OR IGNORE INTO ${OUTBOX_TABLE} (outbox_id, snapshot_id, owner_user_id, client_id, event_id, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).bind(outboxId, entry.snapshotId, entry.ownerUserId, entry.clientId, entry.notification.eventId, payload, timestamp, timestamp).run();
  const row = await env.SYNC_DB.prepare(`SELECT status, payload FROM ${OUTBOX_TABLE} WHERE outbox_id=?`).bind(outboxId).first();
  if (row?.status === 'queued' || row?.status === 'delivered') return { outboxId, inserted: false, queued: false };
  await env.NOTIFY_JOBS.send({ id: `notify-deliver:${outboxId}`, type: 'notify-deliver', outboxId, snapshotId: entry.snapshotId, ownerUserId: entry.ownerUserId, clientId: entry.clientId, notification: parse(row?.payload, entry.notification), createdAt: timestamp });
  await env.SYNC_DB.prepare(`UPDATE ${OUTBOX_TABLE} SET status='queued', queued_at=?, updated_at=? WHERE outbox_id=? AND status='pending'`).bind(timestamp, timestamp, outboxId).run();
  return { outboxId, inserted: Number(inserted?.meta?.changes || 0) > 0, queued: true };
}
export async function markTriggerOutboxDelivered(env, outboxId) { if (!outboxId) return; await ensureNotifyReliabilitySchema(env); const now = nowIso(); await env.SYNC_DB.prepare(`UPDATE ${OUTBOX_TABLE} SET status='delivered', updated_at=? WHERE outbox_id=?`).bind(now, text(outboxId, 160)).run(); }
export async function reserveDeliveryAttempt(env, ownerUserId, eventId, channel) {
  await ensureNotifyReliabilitySchema(env); const now = nowIso(); const stale = new Date(Date.now() - 5 * 60_000).toISOString();
  const result = await env.SYNC_DB.prepare(`INSERT INTO ${DELIVERY_TABLE} (owner_user_id,event_id,channel,status,result_payload,created_at,updated_at) VALUES (?,?,?,'processing','{}',?,?) ON CONFLICT(owner_user_id,event_id,channel) DO UPDATE SET status='processing', updated_at=excluded.updated_at WHERE ${DELIVERY_TABLE}.status='processing' AND ${DELIVERY_TABLE}.updated_at < ?`).bind(ownerUserId, eventId, channel, now, now, stale).run();
  if (Number(result?.meta?.changes || 0) > 0) return { reserved: true, result: null };
  const row = await env.SYNC_DB.prepare(`SELECT status,result_payload FROM ${DELIVERY_TABLE} WHERE owner_user_id=? AND event_id=? AND channel=?`).bind(ownerUserId, eventId, channel).first();
  return { reserved: false, result: parse(row?.result_payload, { channel, status: row?.status || 'skipped', detail: '幂等命中，未重复发送' }) };
}
export async function finishDeliveryAttempt(env, ownerUserId, eventId, channel, result) { await ensureNotifyReliabilitySchema(env); const now = nowIso(); const status = text(result?.status, 32) || 'failed'; await env.SYNC_DB.prepare(`UPDATE ${DELIVERY_TABLE} SET status=?, result_payload=?, updated_at=? WHERE owner_user_id=? AND event_id=? AND channel=?`).bind(status, json(result), now, ownerUserId, eventId, channel).run(); }
