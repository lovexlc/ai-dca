import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runHoldingsNotificationsAll } from '../workers/notify/src/holdingsNotificationRoutes.js';
import { holdingsDedupKey, holdingsRuleKey } from '../workers/notify/src/holdingsNavSupport.js';

function createMemoryKv(seed = {}) {
  const memory = new Map(Object.entries(seed));

  return {
    async get(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    async put(key, value) {
      memory.set(key, String(value));
    },
    async list({ prefix = '', cursor = undefined } = {}) {
      void cursor;
      const keys = Array.from(memory.keys())
        .filter((name) => name.startsWith(prefix))
        .sort()
        .map((name) => ({ name }));
      return {
        keys,
        list_complete: true,
        cursor: undefined
      };
    },
    dump() {
      return memory;
    }
  };
}

function buildEnv() {
  const kv = createMemoryKv({
    [holdingsRuleKey('lovexl-web')]: JSON.stringify({
      enabled: true,
      clientLabel: 'lovexl',
      digest: {
        version: 1,
        exchange: [
          { code: '159001', weight: 0.6 },
          { code: '159002', weight: 0.4 }
        ],
        otc: []
      }
    }),
    'nav:159001': JSON.stringify({
      code: '159001',
      latestNav: 1.02,
      previousNav: 1,
      latestNavDate: '2026-06-05',
      ok: true
    }),
    'nav:159002': JSON.stringify({
      code: '159002',
      latestNav: 1.10,
      previousNav: 1,
      latestNavDate: '2026-06-06',
      ok: true
    })
  });
  return {
    kv,
    env: {
      NOTIFY_STATE: kv,
      NOTIFY_TIMEZONE: 'Asia/Shanghai'
    }
  };
}

test('runHoldingsNotificationsAll waits for complete data before fallback window', async () => {
  const { kv, env } = buildEnv();
  const calls = [];

  await runHoldingsNotificationsAll(env, '2026-06-05', 'holdings-scheduled-2030', {
    runClientDetection: async (_env, settings, _clientRecord, options) => {
      calls.push(options);
      return {
        settings,
        summary: {
          deliveredCount: 1,
          events: [{ channels: [{ channel: 'bark', status: 'delivered' }] }]
        }
      };
    }
  });

  assert.equal(calls.length, 0);
  assert.equal(kv.dump().has(holdingsDedupKey('lovexl-web', 'all', '2026-06-05')), false);
  assert.equal(kv.dump().has(holdingsDedupKey('lovexl-web', 'all-partial', '2026-06-05')), false);
});

test('runHoldingsNotificationsAll sends partial fallback without blocking lovexl account', async () => {
  const { kv, env } = buildEnv();
  const calls = [];

  await runHoldingsNotificationsAll(env, '2026-06-05', 'holdings-scheduled-2130', {
    runClientDetection: async (_env, settings, clientRecord, options) => {
      calls.push({ clientRecord, options });
      return {
        settings,
        summary: {
          deliveredCount: 1,
          events: [{ channels: [{ channel: 'bark', status: 'delivered' }] }]
        }
      };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].clientRecord.clientId, 'lovexl-web');
  assert.equal(calls[0].clientRecord.clientLabel, 'lovexl');
  assert.equal(calls[0].options.testPayload.eventId, 'holdings-all-partial-2026-06-05');
  assert.equal(calls[0].options.testPayload.ruleId, 'holdings-daily-all-partial');
  assert.match(calls[0].options.testPayload.title, /^\[持仓总览·部分\]/);
  assert.match(calls[0].options.testPayload.summary, /部分标的净值未更新/);

  assert.equal(kv.dump().has(holdingsDedupKey('lovexl-web', 'all', '2026-06-05')), false);
  assert.equal(kv.dump().has(holdingsDedupKey('lovexl-web', 'all-partial', '2026-06-05')), true);
});
