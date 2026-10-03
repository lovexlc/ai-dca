import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb } from '../src/db.js';
import {
  enqueueEvent,
  claimPendingEvents,
  markEventDone,
  markEventFailed,
  markEventDead,
  outboxStats,
  MAX_RETRY_DELAY_MS,
} from '../src/outbox.js';
import { processOnce } from '../src/syncWorker.js';

describe('outbox: enqueue and claim', () => {
  let db;
  beforeEach(() => { db = openDb(':memory:'); });
  afterEach(() => closeDb(db));

  it('enqueues and claims due events atomically', () => {
    const id = enqueueEvent(db, 'user.register', { username: 'dudu' });
    assert.ok(id.startsWith('evt_'));

    const claimed = claimPendingEvents(db, 10);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].event_id, id);
    assert.deepEqual(claimed[0].payload, { username: 'dudu' });

    // Second claim finds nothing: already flipped to processing.
    assert.equal(claimPendingEvents(db, 10).length, 0);
    assert.deepEqual(outboxStats(db), { pending: 0, processing: 1, dead: 0 });
  });

  it('future events are not claimed', () => {
    const id = enqueueEvent(db, 'user.register', {});
    db.prepare('UPDATE sync_outbox SET next_attempt_at = ? WHERE event_id = ?')
      .run(new Date(Date.now() + 60000).toISOString(), id);
    assert.equal(claimPendingEvents(db, 10).length, 0);
  });

  it('markEventDone removes the event', () => {
    const id = enqueueEvent(db, 'user.register', {});
    const [claimed] = claimPendingEvents(db, 10);
    markEventDone(db, claimed.event_id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get().n, 0);
    assert.equal(id, claimed.event_id);
  });

  it('markEventFailed applies exponential backoff with cap', () => {
    const id = enqueueEvent(db, 'user.register', {});
    claimPendingEvents(db, 10);

    markEventFailed(db, id, 'boom');
    let row = db.prepare('SELECT retry_count, next_attempt_at, last_error, status FROM sync_outbox WHERE event_id = ?').get(id);
    assert.equal(row.retry_count, 1);
    assert.equal(row.status, 'pending');
    assert.equal(row.last_error, 'boom');
    const delay1 = Date.parse(row.next_attempt_at) - Date.now();
    // retry_count=1 -> 5000 * 2^1 = 10000ms ± 10% jitter
    assert.ok(delay1 >= 9000 * 0.95 && delay1 <= 11000 * 1.05, `delay1=${delay1}`);

    // Simulate many retries: delay must never exceed the 30min cap.
    for (let i = 0; i < 15; i++) {
      db.prepare("UPDATE sync_outbox SET status = 'pending', next_attempt_at = ? WHERE event_id = ?")
        .run(new Date().toISOString(), id);
      claimPendingEvents(db, 10);
      markEventFailed(db, id, 'boom');
    }
    row = db.prepare('SELECT retry_count, next_attempt_at FROM sync_outbox WHERE event_id = ?').get(id);
    assert.equal(row.retry_count, 16);
    const delayCapped = Date.parse(row.next_attempt_at) - Date.now();
    assert.ok(delayCapped <= MAX_RETRY_DELAY_MS * 1.15, `delayCapped=${delayCapped}`);
  });

  it('markEventDead moves the event out of the retry loop', () => {
    const id = enqueueEvent(db, 'user.register', {});
    claimPendingEvents(db, 10);
    markEventDead(db, id, 'permanent');
    assert.deepEqual(outboxStats(db), { pending: 0, processing: 0, dead: 1 });
    assert.equal(claimPendingEvents(db, 10).length, 0);
  });
});

describe('syncWorker: processOnce with mocked fetch', () => {
  let db;
  let realFetch;
  beforeEach(() => {
    db = openDb(':memory:');
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    closeDb(db);
  });

  function mockFetch(handler) {
    globalThis.fetch = async (...args) => handler(...args);
  }

  it('deletes events on 200', async () => {
    enqueueEvent(db, 'user.register', { username: 'dudu' });
    mockFetch(async () => new Response('{}', { status: 200 }));
    const result = await processOnce(db);
    assert.deepEqual(result, { processed: 1, failed: 0, dead: 0 });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get().n, 0);
  });

  it('retries on 500 and network errors', async () => {
    enqueueEvent(db, 'user.register', {});
    enqueueEvent(db, 'user.login', {});
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      if (calls === 1) return new Response('err', { status: 500 });
      throw new Error('socket hang up');
    });
    const result = await processOnce(db);
    assert.deepEqual(result, { processed: 2, failed: 2, dead: 0 });
    const rows = db.prepare('SELECT retry_count FROM sync_outbox').all();
    assert.ok(rows.every((r) => r.retry_count === 1));
  });

  it('dead-letters on 400', async () => {
    enqueueEvent(db, 'user.register', {});
    mockFetch(async () => new Response('bad request', { status: 400 }));
    const result = await processOnce(db);
    assert.deepEqual(result, { processed: 1, failed: 0, dead: 1 });
    assert.deepEqual(outboxStats(db), { pending: 0, processing: 0, dead: 1 });
  });

  it('respects 429 with Retry-After', async () => {
    enqueueEvent(db, 'user.register', {});
    mockFetch(async () => new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }));
    const before = Date.now();
    await processOnce(db);
    const row = db.prepare('SELECT next_attempt_at, retry_count FROM sync_outbox').get();
    assert.equal(row.retry_count, 1);
    const delay = Date.parse(row.next_attempt_at) - before;
    assert.ok(delay >= 115000, `429 delay=${delay}`);
  });

  it('sends bearer token and event payload', async () => {
    process.env.INTERNAL_SYNC_TOKEN = 'secret-token';
    enqueueEvent(db, 'user.register', { username: 'dudu' });
    let seen;
    mockFetch(async (url, init) => {
      seen = { url, init };
      return new Response('{}', { status: 200 });
    });
    await processOnce(db);
    assert.ok(String(seen.url).includes('/api/sync/internal/sync-auth'));
    assert.equal(seen.init.headers.Authorization, 'Bearer secret-token');
    const body = JSON.parse(seen.init.body);
    assert.equal(body.eventType, 'user.register');
    assert.equal(body.payload.username, 'dudu');
    assert.ok(body.eventId.startsWith('evt_'));
    delete process.env.INTERNAL_SYNC_TOKEN;
  });
});
