import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema } from '../src/index.js';

function createDb({ failFirstRun = false } = {}) {
  const stats = { prepareCalls: 0, runCalls: 0 };
  let failed = false;
  const DB = {
    prepare() {
      stats.prepareCalls += 1;
      return {
        async run() {
          stats.runCalls += 1;
          if (failFirstRun && !failed) {
            failed = true;
            throw new Error('transient D1 error');
          }
          return { meta: { changes: 0 } };
        }
      };
    }
  };
  return { DB, stats };
}

test('schema initialization is shared by concurrent requests and cached per D1 binding', async () => {
  const { DB, stats } = createDb();
  await Promise.all([ensureSchema({ DB }), ensureSchema({ DB }), ensureSchema({ DB })]);
  const initializedPrepareCalls = stats.prepareCalls;

  await ensureSchema({ DB });

  assert.equal(stats.prepareCalls, initializedPrepareCalls);
  assert.equal(stats.runCalls, initializedPrepareCalls);
  assert.ok(initializedPrepareCalls > 1);
});

test('failed schema initialization is removed from the cache and can retry', async () => {
  const { DB, stats } = createDb({ failFirstRun: true });

  await assert.rejects(ensureSchema({ DB }), /transient D1 error/);
  await ensureSchema({ DB });

  assert.ok(stats.prepareCalls > 1);
  assert.equal(stats.runCalls, stats.prepareCalls);
});
