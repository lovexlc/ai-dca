import { openDb, closeDb } from './db.js';
import { claimPendingEvents, markEventDone, markEventFailed, markEventDead } from './outbox.js';

const POLL_INTERVAL_MS = 5000;
const CLAIM_LIMIT = 20;
const FETCH_TIMEOUT_MS = 15000;

function syncUrl() {
  return (
    process.env.SYNC_WORKER_URL ||
    'https://api.freebacktrack.tech/api/sync/internal/sync-auth'
  );
}

function internalToken() {
  return process.env.INTERNAL_SYNC_TOKEN || '';
}

function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(headerValue);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

async function postEvent(event) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(syncUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${internalToken()}`,
      },
      body: JSON.stringify({
        eventId: event.event_id,
        eventType: event.event_type,
        payload: event.payload,
      }),
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function processOnce(db) {
  const events = claimPendingEvents(db, CLAIM_LIMIT);
  if (events.length === 0) return { processed: 0, failed: 0, dead: 0 };

  let failed = 0;
  let dead = 0;
  for (const event of events) {
    try {
      const res = await postEvent(event);
      if (res.ok) {
        markEventDone(db, event.event_id);
        continue;
      }
      if (res.status === 429) {
        const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'));
        // Back off at least 60s on rate limit; markEventFailed applies its own schedule,
        // so push the event's next attempt forward explicitly here.
        markEventFailed(db, event.event_id, `rate limited (429)${retryAfter ? `, retry after ${Math.round(retryAfter / 1000)}s` : ''}`);
        if (retryAfter) {
          const row = db
            .prepare('SELECT next_attempt_at FROM sync_outbox WHERE event_id = ?')
            .get(event.event_id);
          if (row) {
            const pushed = new Date(Math.max(Date.parse(row.next_attempt_at), Date.now() + Math.max(retryAfter, 60000))).toISOString();
            db.prepare('UPDATE sync_outbox SET next_attempt_at = ? WHERE event_id = ?').run(pushed, event.event_id);
          }
        }
        failed += 1;
        continue;
      }
      if (res.status >= 500) {
        const text = await res.text().catch(() => '');
        markEventFailed(db, event.event_id, `worker ${res.status}: ${text.slice(0, 200)}`);
        failed += 1;
        continue;
      }
      // Other 4xx: permanent client error -> dead letter, no more retries.
      const text = await res.text().catch(() => '');
      markEventDead(db, event.event_id, `worker ${res.status}: ${text.slice(0, 200)}`);
      console.error(`[sync-worker] dead letter ${event.event_id} (${event.event_type}): worker ${res.status}`);
      dead += 1;
    } catch (err) {
      markEventFailed(db, event.event_id, err?.name === 'AbortError' ? 'timeout' : String(err?.message || err));
      failed += 1;
    }
  }
  return { processed: events.length, failed, dead };
}

export function startSyncWorker(db, { pollIntervalMs = POLL_INTERVAL_MS } = {}) {
  let stopped = false;
  let timer = null;
  let inFlight = null;

  const tick = async () => {
    if (stopped) return;
    try {
      inFlight = processOnce(db);
      await inFlight;
    } catch (err) {
      console.error('[sync-worker] batch error:', err?.message || err);
    } finally {
      inFlight = null;
      if (!stopped) timer = setTimeout(tick, pollIntervalMs);
    }
  };

  // Kick off immediately on start.
  timer = setTimeout(tick, 0);

  return {
    /** Wait for the currently running batch (if any) and stop scheduling new ones. */
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) await inFlight;
    },
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const db = openDb();
  const worker = startSyncWorker(db);
  console.log('[sync-worker] started, syncing to', syncUrl());
  const shutdown = async () => {
    console.log('[sync-worker] shutting down, finishing current batch');
    await worker.stop();
    closeDb(db);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
