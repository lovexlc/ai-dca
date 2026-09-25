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

function createAggregateFixture() {
  const statements = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            const statement = { sql, args };
            statements.push(statement);
            return statement;
          },
        };
      },
      async batch() {},
    },
  };
  return { env, statements };
}

test('daily analytics aggregate counts pv and switch runs per date', async () => {
  const { updateDailyAnalyticsAggregate } = await import('../src/index.js');
  const { env, statements } = createAggregateFixture();
  await updateDailyAnalyticsAggregate(env, [
    { type: 'page_view', date: '2026-09-25', userId: 'u1', visitorId: '' },
    { type: 'page_view', date: '2026-09-25', userId: '', visitorId: 'v1' },
    { type: 'page_engagement', date: '2026-09-25', userId: 'u1', visitorId: '' },
    { type: 'switch_worker_run', date: '2026-09-25', userId: '', visitorId: '' },
    { type: 'page_view', date: '2026-09-24', userId: 'u2', visitorId: '' },
  ]);
  const stats = statements.filter((s) => s.sql.includes('analytics_daily_stats'));
  assert.equal(stats.length, 2);
  const today = stats.find((s) => s.args[0] === '2026-09-25');
  assert.deepEqual(today.args, ['2026-09-25', 2, 1]);
  assert.match(today.sql, /pv = pv \+ excluded\.pv/);
  const users = statements.filter((s) => s.sql.includes('analytics_daily_users'));
  assert.equal(users.length, 3);
  const visitor = users.find((s) => s.args[1] === 'v1');
  assert.deepEqual(visitor.args, ['2026-09-25', 'v1', 1, 1, 0]);
  const engaged = users.find((s) => s.args[1] === 'u1');
  assert.deepEqual(engaged.args, ['2026-09-25', 'u1', 0, 1, 1]);
});

test('daily analytics aggregate merges flags with MAX on conflict', async () => {
  const { updateDailyAnalyticsAggregate } = await import('../src/index.js');
  const { env, statements } = createAggregateFixture();
  await updateDailyAnalyticsAggregate(env, [
    { type: 'page_view', date: '2026-09-25', userId: 'u1', visitorId: '' },
  ]);
  const userStmt = statements.find((s) => s.sql.includes('analytics_daily_users'));
  assert.match(userStmt.sql, /MAX\(has_page_view, excluded\.has_page_view\)/);
});

test('daily analytics aggregate skips events without identity', async () => {
  const { updateDailyAnalyticsAggregate } = await import('../src/index.js');
  const { env, statements } = createAggregateFixture();
  await updateDailyAnalyticsAggregate(env, [
    { type: 'page_view', date: '2026-09-25', userId: '', visitorId: '' },
  ]);
  assert.equal(statements.filter((s) => s.sql.includes('analytics_daily_users')).length, 0);
  assert.equal(statements.filter((s) => s.sql.includes('analytics_daily_stats')).length, 1);
});

test('daily analytics aggregate is a no-op for empty input', async () => {
  const { updateDailyAnalyticsAggregate } = await import('../src/index.js');
  const { env, statements } = createAggregateFixture();
  await updateDailyAnalyticsAggregate(env, []);
  assert.equal(statements.length, 0);
});
