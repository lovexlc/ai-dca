const SNAPSHOT_TABLE = 'notify_switch_snapshots';
const OUTBOX_TABLE = 'notify_switch_trigger_outbox';
const DELIVERY_TABLE = 'notify_delivery_attempts';
const CLAIM_TABLE = 'notify_switch_trigger_claims';
const MAX_OUTBOX_RETRY_COUNT = 6;
const schemaPromises = new WeakMap();
function nowIso() { return new Date().toISOString(); }
function text(value = '', max = 500) { return String(value ?? '').trim().slice(0, max); }
function json(value) { try { return JSON.stringify(value ?? {}); } catch { return '{}'; } }
function parse(value, fallback = null) { try { const result = JSON.parse(String(value || '')); return result && typeof result === 'object' ? result : fallback; } catch { return fallback; } }
async function hash(value) { const bytes = new TextEncoder().encode(String(value)); const digest = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function ensureColumn(db, table, column, definition) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all();
  if ((info?.results || []).some((row) => String(row?.name || '') === column)) return;
  try { await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run(); }
  catch (error) { if (!String(error?.message || error).toLowerCase().includes('duplicate column')) throw error; }
}
export function isRetryableDeliveryStatus(status = '') { return ['failed', 'retryable_failed'].includes(text(status, 32)); }
export function isTerminalDeliveryStatus(status = '') { return ['delivered', 'queued', 'skipped', 'permanent_failed'].includes(text(status, 32)); }
export async function ensureNotifyReliabilitySchema(env) {
  if (!env?.SYNC_DB?.prepare) throw new Error('SYNC_DB unavailable');
  const existing = schemaPromises.get(env.SYNC_DB); if (existing) return existing;
  const promise = (async () => {
    await env.SYNC_DB.prepare(`CREATE TABLE IF NOT EXISTS ${SNAPSHOT_TABLE} (snapshot_id TEXT PRIMARY KEY, source TEXT NOT NULL, computed_at TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)`).run();
    await env.SYNC_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notify_switch_snapshots_computed ON ${SNAPSHOT_TABLE} (computed_at DESC)`).run();
    await env.SYNC_DB.prepare(`CREATE TABLE IF NOT EXISTS ${OUTBOX_TABLE} (outbox_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, client_id TEXT NOT NULL, event_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, queued_at TEXT, updated_at TEXT NOT NULL, UNIQUE (snapshot_id, owner_user_id, client_id, event_id))`).run();
    await ensureColumn(env.SYNC_DB, OUTBOX_TABLE, 'config_revision', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(env.SYNC_DB, OUTBOX_TABLE, 'rule_id', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env.SYNC_DB, OUTBOX_TABLE, 'pair_key', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env.SYNC_DB, OUTBOX_TABLE, 'trigger_date', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env.SYNC_DB, OUTBOX_TABLE, 'force_enabled', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(env.SYNC_DB, OUTBOX_TABLE, 'retry_count', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(env.SYNC_DB, OUTBOX_TABLE, 'last_error', "TEXT NOT NULL DEFAULT ''");
    await env.SYNC_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notify_switch_outbox_status ON ${OUTBOX_TABLE} (status, updated_at)`).run();
    await env.SYNC_DB.prepare(`CREATE TABLE IF NOT EXISTS ${DELIVERY_TABLE} (owner_user_id TEXT NOT NULL, event_id TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, result_payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_user_id, event_id, channel))`).run();
    await env.SYNC_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notify_delivery_attempts_event ON ${DELIVERY_TABLE} (owner_user_id, event_id)`).run();
    await env.SYNC_DB.prepare(`CREATE TABLE IF NOT EXISTS ${CLAIM_TABLE} (owner_user_id TEXT NOT NULL, client_id TEXT NOT NULL, rule_id TEXT NOT NULL, pair_key TEXT NOT NULL, trigger_kind TEXT NOT NULL, trigger_date TEXT NOT NULL, event_id TEXT NOT NULL, slot INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (owner_user_id, client_id, rule_id, pair_key, trigger_kind, trigger_date, slot), UNIQUE (owner_user_id, event_id))`).run();
    await env.SYNC_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notify_switch_claims_date ON ${CLAIM_TABLE} (owner_user_id, client_id, trigger_date)`).run();
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
export async function reserveDailyTriggerClaim(env, entry = {}) {
  await ensureNotifyReliabilitySchema(env);
  const ownerUserId = text(entry.ownerUserId, 96); const clientId = text(entry.clientId, 120); const ruleId = text(entry.ruleId, 96); const pairKey = text(entry.pairKey, 240); const triggerKind = text(entry.triggerKind, 32); const triggerDate = text(entry.triggerDate, 20); const eventId = text(entry.eventId, 240); const maxSlot = Math.max(1, Math.min(Number(entry.maxSlot) || 3, 20)); const startSlot = Math.max(1, Math.min(Number(entry.startSlot) || 1, maxSlot));
  if (!ownerUserId || !clientId || !ruleId || !pairKey || !triggerKind || !triggerDate || !eventId) throw new Error('switch trigger claim is incomplete');
  const existing = await env.SYNC_DB.prepare(`SELECT slot FROM ${CLAIM_TABLE} WHERE owner_user_id=? AND event_id=?`).bind(ownerUserId, eventId).first();
  if (existing?.slot) return { claimed: true, existing: true, slot: Number(existing.slot) };
  const timestamp = nowIso();
  const values = Array.from({ length: maxSlot - startSlot + 1 }, (_, index) => `(${startSlot + index})`).join(',');
  await env.SYNC_DB.prepare(`WITH slots(slot) AS (VALUES ${values}) INSERT OR IGNORE INTO ${CLAIM_TABLE} (owner_user_id, client_id, rule_id, pair_key, trigger_kind, trigger_date, event_id, slot, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, slots.slot, ? FROM slots WHERE NOT EXISTS (SELECT 1 FROM ${CLAIM_TABLE} c WHERE c.owner_user_id=? AND c.client_id=? AND c.rule_id=? AND c.pair_key=? AND c.trigger_kind=? AND c.trigger_date=? AND c.slot=slots.slot) ORDER BY slots.slot LIMIT 1`).bind(ownerUserId, clientId, ruleId, pairKey, triggerKind, triggerDate, eventId, timestamp, ownerUserId, clientId, ruleId, pairKey, triggerKind, triggerDate).run();
  const claimed = await env.SYNC_DB.prepare(`SELECT slot FROM ${CLAIM_TABLE} WHERE owner_user_id=? AND event_id=?`).bind(ownerUserId, eventId).first();
  return claimed?.slot ? { claimed: true, existing: false, slot: Number(claimed.slot) } : { claimed: false, existing: false, slot: 0 };
}
function deliveryJobFromOutbox(row) {
  return { id: `notify-deliver:${row.outbox_id}`, type: 'notify-deliver', outboxId: row.outbox_id, snapshotId: row.snapshot_id, ownerUserId: row.owner_user_id, clientId: row.client_id, notification: parse(row.payload, {}), configRevision: Number(row.config_revision) || 0, ruleId: text(row.rule_id, 96), pairKey: text(row.pair_key, 240), triggerDate: text(row.trigger_date, 20), forceEnabled: Number(row.force_enabled) === 1, createdAt: nowIso() };
}
export async function enqueueTriggerOutbox(env, entry) {
  await ensureNotifyReliabilitySchema(env);
  if (!env?.NOTIFY_JOBS?.send) throw new Error('NOTIFY_JOBS queue unavailable');
  const outboxId = `switch-outbox-${await hash(`${entry.snapshotId}|${entry.ownerUserId}|${entry.clientId}|${entry.notification.eventId}`)}`;
  const timestamp = nowIso(); const payload = json(entry.notification);
  const inserted = await env.SYNC_DB.prepare(`INSERT OR IGNORE INTO ${OUTBOX_TABLE} (outbox_id, snapshot_id, owner_user_id, client_id, event_id, payload, status, created_at, updated_at, config_revision, rule_id, pair_key, trigger_date, force_enabled) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`).bind(outboxId, entry.snapshotId, entry.ownerUserId, entry.clientId, entry.notification.eventId, payload, timestamp, timestamp, Number(entry.configRevision) || 0, text(entry.ruleId, 96), text(entry.pairKey, 240), text(entry.triggerDate, 20), entry.forceEnabled ? 1 : 0).run();
  const row = await env.SYNC_DB.prepare(`SELECT * FROM ${OUTBOX_TABLE} WHERE outbox_id=?`).bind(outboxId).first();
  if (!row) throw new Error('switch outbox row missing after insert');
  if (['queued', 'delivered', 'cancelled', 'failed'].includes(text(row.status, 32))) return { outboxId, inserted: false, queued: false, status: row.status };
  await env.NOTIFY_JOBS.send(deliveryJobFromOutbox(row));
  await env.SYNC_DB.prepare(`UPDATE ${OUTBOX_TABLE} SET status='queued', queued_at=?, updated_at=?, last_error='' WHERE outbox_id=? AND status='pending'`).bind(timestamp, timestamp, outboxId).run();
  return { outboxId, inserted: Number(inserted?.meta?.changes || 0) > 0, queued: true, status: 'queued' };
}
export async function markTriggerOutboxDelivered(env, outboxId) { if (!outboxId) return; await ensureNotifyReliabilitySchema(env); const now = nowIso(); await env.SYNC_DB.prepare(`UPDATE ${OUTBOX_TABLE} SET status='delivered', last_error='', updated_at=? WHERE outbox_id=?`).bind(now, text(outboxId, 160)).run(); }
export async function markTriggerOutboxCancelled(env, outboxId, reason = '') { if (!outboxId) return; await ensureNotifyReliabilitySchema(env); const now = nowIso(); await env.SYNC_DB.prepare(`UPDATE ${OUTBOX_TABLE} SET status='cancelled', last_error=?, updated_at=? WHERE outbox_id=?`).bind(text(reason, 1000), now, text(outboxId, 160)).run(); }
export async function markTriggerOutboxRetryable(env, outboxId, error = '') {
  if (!outboxId) return { terminal: false, retryCount: 0 };
  await ensureNotifyReliabilitySchema(env); const now = nowIso();
  await env.SYNC_DB.prepare(`UPDATE ${OUTBOX_TABLE} SET retry_count=retry_count+1, last_error=?, status=CASE WHEN retry_count+1 >= ? THEN 'failed' ELSE 'queued' END, updated_at=? WHERE outbox_id=? AND status NOT IN ('delivered','cancelled','failed')`).bind(text(error, 1000), MAX_OUTBOX_RETRY_COUNT, now, text(outboxId, 160)).run();
  const row = await env.SYNC_DB.prepare(`SELECT status,retry_count FROM ${OUTBOX_TABLE} WHERE outbox_id=?`).bind(text(outboxId, 160)).first();
  return { terminal: row?.status === 'failed', retryCount: Number(row?.retry_count) || 0, status: row?.status || '' };
}
export async function reserveDeliveryAttempt(env, ownerUserId, eventId, channel) {
  await ensureNotifyReliabilitySchema(env); const now = nowIso(); const stale = new Date(Date.now() - 5 * 60_000).toISOString();
  const result = await env.SYNC_DB.prepare(`INSERT INTO ${DELIVERY_TABLE} (owner_user_id,event_id,channel,status,result_payload,created_at,updated_at) VALUES (?,?,?,'processing','{}',?,?) ON CONFLICT(owner_user_id,event_id,channel) DO UPDATE SET status='processing', updated_at=excluded.updated_at WHERE ${DELIVERY_TABLE}.status IN ('failed','retryable_failed') OR (${DELIVERY_TABLE}.status='processing' AND ${DELIVERY_TABLE}.updated_at < ?)`).bind(ownerUserId, eventId, channel, now, now, stale).run();
  if (Number(result?.meta?.changes || 0) > 0) return { reserved: true, result: null };
  const row = await env.SYNC_DB.prepare(`SELECT status,result_payload FROM ${DELIVERY_TABLE} WHERE owner_user_id=? AND event_id=? AND channel=?`).bind(ownerUserId, eventId, channel).first();
  return { reserved: false, result: parse(row?.result_payload, { channel, status: row?.status || 'skipped', detail: '幂等命中，未重复发送' }) };
}
export async function finishDeliveryAttempt(env, ownerUserId, eventId, channel, result) { await ensureNotifyReliabilitySchema(env); const now = nowIso(); const rawStatus = text(result?.status, 32) || 'failed'; const status = rawStatus === 'failed' ? 'retryable_failed' : rawStatus; const stored = { ...(result || {}), status }; await env.SYNC_DB.prepare(`UPDATE ${DELIVERY_TABLE} SET status=?, result_payload=?, updated_at=? WHERE owner_user_id=? AND event_id=? AND channel=?`).bind(status, json(stored), now, ownerUserId, eventId, channel).run(); return stored; }
export async function requeueStaleTriggerOutbox(env, options = {}) {
  await ensureNotifyReliabilitySchema(env);
  if (!env?.NOTIFY_JOBS?.send) return { scanned: 0, requeued: 0, failed: 0 };
  const olderThanMs = Math.max(60_000, Number(options.olderThanMs) || 5 * 60_000); const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200)); const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const result = await env.SYNC_DB.prepare(`SELECT * FROM ${OUTBOX_TABLE} WHERE status IN ('pending','queued') AND updated_at < ? ORDER BY updated_at ASC LIMIT ?`).bind(cutoff, limit).all();
  let requeued = 0; let failed = 0;
  for (const row of result?.results || []) {
    if (Number(row.retry_count) >= MAX_OUTBOX_RETRY_COUNT) { await env.SYNC_DB.prepare(`UPDATE ${OUTBOX_TABLE} SET status='failed', updated_at=? WHERE outbox_id=?`).bind(nowIso(), row.outbox_id).run(); failed += 1; continue; }
    try {
      await env.NOTIFY_JOBS.send(deliveryJobFromOutbox(row));
      const timestamp = nowIso(); await env.SYNC_DB.prepare(`UPDATE ${OUTBOX_TABLE} SET status='queued', queued_at=?, updated_at=? WHERE outbox_id=? AND status IN ('pending','queued')`).bind(timestamp, timestamp, row.outbox_id).run(); requeued += 1;
    } catch (error) {
      await markTriggerOutboxRetryable(env, row.outbox_id, error instanceof Error ? error.message : String(error)); failed += 1;
    }
  }
  return { scanned: (result?.results || []).length, requeued, failed };
}
