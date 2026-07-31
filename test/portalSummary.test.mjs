import assert from 'node:assert/strict';
import test from 'node:test';

import notifyWorker from '../workers/notify/src/index.js';
import {
  SWITCH_NOTIFIED_TOTAL_KEY,
  listPublicSwitchStrategyCollections,
  readSwitchNotifiedTotal,
  recordSwitchNotificationDelivery,
  switchNotificationMarkerKey
} from '../workers/notify/src/switchStrategySummary.js';
import { hashText } from '../workers/notify/src/clientSettings.js';
import { getShanghaiDayBounds, queryTodaySwitchSummary } from '../workers/sync/src/index.js';
import { fetchPortalSummary, normalizePortalSummary } from '../src/pages/portal/portalSummary.js';

function createMemoryKv(seed = {}) {
  const memory = new Map(Object.entries(seed));
  return {
    async get(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    async put(key, value) {
      memory.set(key, String(value));
    },
    async list({ prefix = '' } = {}) {
      return {
        keys: [...memory.keys()]
          .filter((key) => key.startsWith(prefix))
          .sort()
          .map((name) => ({ name })),
        list_complete: true,
        cursor: ''
      };
    }
  };
}

test('switch notification count is permanent and deduplicated by client and rule', async () => {
  const env = { NOTIFY_STATE: createMemoryKv() };

  assert.deepEqual(await recordSwitchNotificationDelivery(env, {
    clientId: 'web:one',
    ruleId: 'rule-a',
    deliveredAt: '2026-07-31T01:00:00.000Z'
  }), { counted: true, total: 1 });
  assert.deepEqual(await recordSwitchNotificationDelivery(env, {
    clientId: 'web:one',
    ruleId: 'rule-a',
    deliveredAt: '2026-07-31T02:00:00.000Z'
  }), { counted: false, total: 1 });
  assert.deepEqual(await recordSwitchNotificationDelivery(env, {
    clientId: 'web:one',
    ruleId: 'rule-b'
  }), { counted: true, total: 2 });

  assert.equal(await readSwitchNotifiedTotal(env), 2);
  assert.equal(await env.NOTIFY_STATE.get(SWITCH_NOTIFIED_TOTAL_KEY), '2');
  assert.ok(await env.NOTIFY_STATE.get(switchNotificationMarkerKey('web:one', 'rule-a')));
});

test('public switch summary counts rules across switch config keys', async () => {
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'switch:config:web:one': JSON.stringify({ rules: [{ id: 'a' }, { id: 'b' }] }),
      'switch:config:web:two': JSON.stringify({ rules: [{ id: 'c' }] }),
      'switch:notified:total': '7'
    })
  };
  const response = await notifyWorker.fetch(new Request('https://test.freebacktrack.tech/api/notify/switch/summary'), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.scope, 'public');
  assert.equal(body.configuredStrategyCount, 3);
  assert.equal(body.notifiedStrategyCount, 7);
  assert.match(body.generatedAt, /^202/);
});

test('public switch collections merge linked accounts and omit anonymous and sensitive data', async () => {
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify({
        clients: {
          'web:alice-one': { clientId: 'web:alice-one', accountUsername: 'alice' },
          'web:alice-two': { clientId: 'web:alice-two', accountUsername: 'alice' },
          'web:anonymous': { clientId: 'web:anonymous', accountUsername: '' }
        }
      }),
      'switch:config:web:alice-one': JSON.stringify({
        updatedAt: '2026-07-31T01:00:00.000Z',
        rules: [{
          id: 'alice-rule-1',
          name: '纳指切换',
          holdingFundCode: '513100',
          holdingFundName: '纳指ETF',
          holdingQuantity: 1000,
          holdingNotional: 123456,
          candidateFundCodes: ['159941']
        }]
      }),
      'switch:config:web:alice-two': JSON.stringify({
        rules: [{ id: 'alice-rule-2', name: '标普切换', holdingFundCode: '513500', candidateFundCodes: ['159612'] }]
      }),
      'switch:config:web:anonymous': JSON.stringify({ rules: [{ id: 'anonymous-rule' }] })
    })
  };

  const collections = await listPublicSwitchStrategyCollections(env);
  assert.equal(collections.length, 1);
  assert.equal(collections[0].strategyCount, 2);
  assert.equal(collections[0].rules.length, 2);
  const serialized = JSON.stringify(collections);
  assert.doesNotMatch(serialized, /alice|anonymous|web:/);
  assert.doesNotMatch(serialized, /holdingQuantity|holdingNotional/);
});

test('personal switch summary aggregates all clients already linked to the account', async () => {
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify({
        clients: {
          'web:one': { clientId: 'web:one', accountUsername: 'alice', clientSecretHash: await hashText('secret') },
          'web:two': { clientId: 'web:two', accountUsername: 'alice' },
          'web:other': { clientId: 'web:other', accountUsername: 'bob' }
        }
      }),
      'switch:config:web:one': JSON.stringify({ rules: [{ id: 'a' }] }),
      'switch:config:web:two': JSON.stringify({ rules: [{ id: 'b' }, { id: 'c' }] }),
      [switchNotificationMarkerKey('web:one', 'a')]: JSON.stringify({ clientId: 'web:one', ruleId: 'a' }),
      [switchNotificationMarkerKey('web:two', 'b')]: JSON.stringify({ clientId: 'web:two', ruleId: 'b' })
    })
  };
  const response = await notifyWorker.fetch(new Request('https://test.freebacktrack.tech/api/notify/switch/summary/personal?clientId=web%3Aone', {
    headers: {
      'x-notify-client-secret': 'secret',
      'x-notify-account-username': 'alice'
    }
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.scope, 'personal');
  assert.deepEqual(body.clientIds, ['web:one', 'web:two']);
  assert.equal(body.configuredStrategyCount, 3);
  assert.equal(body.notifiedStrategyCount, 2);
});

test('personal summary does not migrate an anonymous client into the logged-in account', async () => {
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify({
        clients: {
          'web:anonymous': {
            clientId: 'web:anonymous',
            accountUsername: '',
            clientSecretHash: await hashText('secret')
          }
        }
      }),
      'switch:config:web:anonymous': JSON.stringify({ rules: [{ id: 'anonymous-rule' }] })
    })
  };
  const response = await notifyWorker.fetch(new Request('https://test.freebacktrack.tech/api/notify/switch/summary/personal?clientId=web%3Aanonymous', {
    headers: {
      'x-notify-client-secret': 'secret',
      'x-notify-account-username': 'alice'
    }
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.clientIds, []);
  assert.equal(body.configuredStrategyCount, 0);
  const settings = JSON.parse(await env.NOTIFY_STATE.get('notify:settings'));
  assert.equal(settings.clients['web:anonymous'].accountUsername, '');
});

test('Shanghai day bounds convert to the correct UTC interval', () => {
  assert.deepEqual(getShanghaiDayBounds(Date.parse('2026-07-31T15:59:59.999Z')), {
    dateKey: '2026-07-31',
    startAt: '2026-07-30T16:00:00.000Z',
    endAt: '2026-07-31T16:00:00.000Z'
  });
});

test('today switch summary filters by created_at range instead of event_date', async () => {
  const calls = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...bindings) {
            calls.push({ sql: String(sql), bindings });
            return { first: async () => ({ triggerCount: 4, strategyCount: 2 }) };
          }
        };
      }
    }
  };
  const summary = await queryTodaySwitchSummary(env, {
    nowMs: Date.parse('2026-07-31T15:59:59.999Z')
  });

  assert.equal(summary.triggerCount, 4);
  assert.equal(summary.strategyCount, 2);
  assert.match(calls[0].sql, /created_at >= \?/);
  assert.match(calls[0].sql, /created_at < \?/);
  assert.doesNotMatch(calls[0].sql, /event_date >=/);
  assert.deepEqual(calls[0].bindings, [
    'switch_notification_triggered',
    '2026-07-30T16:00:00.000Z',
    '2026-07-31T16:00:00.000Z'
  ]);
});

test('portal summary normalizes unavailable metrics without inventing zeroes', () => {
  assert.deepEqual(normalizePortalSummary({
    notify: { configuredStrategyCount: '12', notifiedStrategyCount: 9 },
    sync: { todayTriggeredStrategyCount: '3', todayTriggerCount: '4' }
  }), {
    scope: 'public',
    configuredStrategyCount: 12,
    notifiedStrategyCount: 9,
    todayTriggeredStrategyCount: 3,
    todayTriggerCount: 4,
    generatedAt: ''
  });
  assert.equal(normalizePortalSummary({}).configuredStrategyCount, null);
});

test('portal summary preserves the healthy worker when the other summary endpoint is unavailable', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/notify/switch/summary')) {
      return new Response(JSON.stringify({ message: 'temporarily unavailable' }), { status: 503 });
    }
    return new Response(JSON.stringify({
      scope: 'public',
      todayTriggeredStrategyCount: 4,
      todayTriggerCount: 6
    }), { status: 200 });
  };
  try {
    const summary = await fetchPortalSummary({
      force: true,
      identity: { scope: 'public', key: 'partial-worker-test' }
    });
    assert.equal(summary.configuredStrategyCount, null);
    assert.equal(summary.todayTriggeredStrategyCount, 4);
    assert.equal(summary.todayTriggerCount, 6);
    assert.equal(summary.partial, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
