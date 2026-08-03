import assert from 'node:assert/strict';
import test from 'node:test';

import { pruneOldAnalyticsEvents, USER_EVENT_WHERE } from '../src/index.js';

function createCleanupFixture(changes) {
  const calls = [];
  const remaining = [...changes];
  const env = {
    DB: {
      prepare(sql) {
        const call = { sql, args: [] };
        calls.push(call);
        return {
          bind(...args) {
            call.args = args;
            return {
              async run() {
                return { meta: { changes: remaining.shift() ?? 0 } };
              },
            };
          },
        };
      },
    },
  };
  return { env, calls };
}

test('user analytics filter includes events without a background reason', () => {
  assert.match(USER_EVENT_WHERE, /COALESCE/);
  assert.match(USER_EVENT_WHERE, /<> 'switch-cron'/);
});

test('analytics cleanup drains multiple full batches in one run', async () => {
  const fixture = createCleanupFixture([5000, 5000, 123]);
  const result = await pruneOldAnalyticsEvents(
    fixture.env,
    Date.parse('2026-08-03T00:00:00.000Z'),
  );

  assert.deepEqual(result, {
    cutoff: '2026-07-04',
    deleted: 10123,
    batches: 3,
    hitBatchLimit: false,
  });
  assert.equal(fixture.calls.length, 3);
  assert.equal(fixture.calls[0].args[1], 5000);
});

test('analytics cleanup reports when the per-run batch limit is reached', async () => {
  const fixture = createCleanupFixture([5000, 5000, 5000]);
  const result = await pruneOldAnalyticsEvents(
    fixture.env,
    Date.parse('2026-08-03T00:00:00.000Z'),
    { maxBatches: 2 },
  );

  assert.deepEqual(result, {
    cutoff: '2026-07-04',
    deleted: 10000,
    batches: 2,
    hitBatchLimit: true,
  });
  assert.equal(fixture.calls.length, 2);
});

test('analytics cleanup does not flag a partial final batch as a limit hit', async () => {
  const fixture = createCleanupFixture([123]);
  const result = await pruneOldAnalyticsEvents(
    fixture.env,
    Date.parse('2026-08-03T00:00:00.000Z'),
    { maxBatches: 1 },
  );

  assert.equal(result.deleted, 123);
  assert.equal(result.batches, 1);
  assert.equal(result.hitBatchLimit, false);
});
