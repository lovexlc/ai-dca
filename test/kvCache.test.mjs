import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  kvCacheMGetJson,
  kvCacheMSetJson,
  marketsReadMode,
  shouldFetchLiveOnMiss
} from '../workers/markets/src/kvCache.js';

test('KV cache mode defaults to cache-first and supports cache-only', () => {
  assert.equal(marketsReadMode({}), 'cache-first');
  assert.equal(marketsReadMode({ MARKETS_DATA_READ_MODE: 'cache-only' }), 'cache-only');
  assert.equal(marketsReadMode({ MARKETS_DATA_READ_MODE: 'live' }), 'live');
  assert.equal(shouldFetchLiveOnMiss({ MARKETS_DATA_READ_MODE: 'cache-only' }), false);
});

test('KV cache batch get maps values by requested key', async () => {
  const store = new Map([
    ['quote:510300', { code: '510300', price: 4.8 }],
    ['quote:513100', { code: '513100', price: 2.1 }]
  ]);
  const env = {
    MARKETS_KV: {
      async get(keys) {
        assert.equal(Array.isArray(keys), true);
        return new Map(keys.map((key) => [key, store.get(key) ?? null]));
      }
    }
  };

  const parsed = await kvCacheMGetJson(env, ['quote:510300', 'quote:159915', 'quote:513100']);

  assert.deepEqual(parsed, {
    'quote:510300': { code: '510300', price: 4.8 },
    'quote:513100': { code: '513100', price: 2.1 }
  });
});

test('KV cache batch get parses string values defensively', async () => {
  const env = {
    MARKETS_KV: {
      async get(keys) {
        return new Map(keys.map((key) => [
          key,
          key === 'quote:510300' ? JSON.stringify({ code: '510300', price: 4.8 }) : null
        ]));
      }
    }
  };

  const parsed = await kvCacheMGetJson(env, ['quote:510300', 'quote:159915']);

  assert.deepEqual(parsed, {
    'quote:510300': { code: '510300', price: 4.8 }
  });
});

test('KV cache batch set writes JSON values with TTL', async () => {
  const writes = [];
  const env = {
    MARKETS_KV: {
      async put(key, value, opts) {
        writes.push({ key, value: JSON.parse(value), opts });
      }
    }
  };

  const ok = await kvCacheMSetJson(env, [
    { key: 'quote:510300', value: { code: '510300', price: 4.8 } },
    { key: 'quote:513100', value: { code: '513100', price: 2.1 } },
  ], { ttlSeconds: 120 });

  assert.equal(ok, true);
  assert.deepEqual(writes.map((item) => item.key).sort(), ['quote:510300', 'quote:513100']);
  assert.deepEqual(writes[0].opts, { expirationTtl: 120 });
});
