import { randomId, nowIso, withTransaction } from './auth.js';

// Maximum delay between outbox retries: 30 minutes.
export const MAX_RETRY_DELAY_MS = 30 * 60 * 1000;
// Base delay for the first retry: 5 seconds, doubled per attempt.
export const BASE_RETRY_DELAY_MS = 5 * 1000;

function computeNextAttempt(retryCount) {
  const exponential = BASE_RETRY_DELAY_MS * 2 ** Math.min(retryCount, 12);
  const capped = Math.min(exponential, MAX_RETRY_DELAY_MS);
  // ±10% jitter to avoid thundering herds.
  const jitter = capped * (0.9 + Math.random() * 0.2);
  return new Date(Date.now() + Math.round(jitter)).toISOString();
}

export function enqueueEvent(db, eventType, payload) {
  const eventId = randomId('evt_');
  const now = nowIso();
  db.prepare(
    `INSERT INTO sync_outbox
       (event_id, event_type, payload, status, retry_count, next_attempt_at, created_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?)`
  ).run(eventId, eventType, JSON.stringify(payload ?? {}), now, now);
  return eventId;
}

/**
 * Atomically claim up to `limit` due events for processing.
 * Uses a single transaction: select due rows, flip them to 'processing'.
 * Returns the claimed rows with parsed payloads.
 */
export function claimPendingEvents(db, limit = 20) {
  const rows = withTransaction(db, () => {
    const due = db
      .prepare(
        `SELECT event_id, event_type, payload, retry_count, created_at
         FROM sync_outbox
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(nowIso(), limit);
    if (due.length === 0) return [];
    const mark = db.prepare(`UPDATE sync_outbox SET status = 'processing' WHERE event_id = ?`);
    for (const row of due) mark.run(row.event_id);
    return due;
  });
  return rows.map((row) => {
    let payload = {};
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = {};
    }
    return { ...row, payload };
  });
}

export function markEventDone(db, eventId) {
  db.prepare(`DELETE FROM sync_outbox WHERE event_id = ?`).run(eventId);
}

export function markEventFailed(db, eventId, error) {
  const row = db
    .prepare('SELECT retry_count FROM sync_outbox WHERE event_id = ?')
    .get(eventId);
  if (!row) return;
  const retryCount = row.retry_count + 1;
  db.prepare(
    `UPDATE sync_outbox
     SET status = 'pending', retry_count = ?, next_attempt_at = ?, last_error = ?
     WHERE event_id = ?`
  ).run(retryCount, computeNextAttempt(retryCount), String(error || '').slice(0, 500), eventId);
}

export function markEventDead(db, eventId, error) {
  db.prepare(
    `UPDATE sync_outbox SET status = 'dead', last_error = ? WHERE event_id = ?`
  ).run(String(error || '').slice(0, 500), eventId);
}

export function outboxStats(db) {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS n FROM sync_outbox GROUP BY status`)
    .all();
  const stats = { pending: 0, processing: 0, dead: 0 };
  for (const row of rows) {
    if (row.status in stats) stats[row.status] = row.n;
  }
  return stats;
}
