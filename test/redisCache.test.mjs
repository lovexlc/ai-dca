import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRedisJsonValues, redisKey } from '../workers/markets/src/redisCache.js';

test('redis key applies the configured prefix', () => {
  assert.equal(
    redisKey({ MARKETS_REDIS_PREFIX: 'custom:' }, 'quote:510300'),
    'custom:quote:510300'
  );
});

test('redis JSON parser maps values by requested key order', () => {
  const parsed = parseRedisJsonValues(
    ['quote:510300', 'quote:159915', 'quote:513100'],
    [
      JSON.stringify({ code: '510300', price: 4.8 }),
      null,
      JSON.stringify({ code: '513100', price: 2.1 })
    ]
  );

  assert.deepEqual(parsed, {
    'quote:510300': { code: '510300', price: 4.8 },
    'quote:513100': { code: '513100', price: 2.1 }
  });
});

test('redis JSON parser ignores malformed cache entries', () => {
  const parsed = parseRedisJsonValues(
    ['quote:510300', 'quote:159915'],
    ['{bad json', JSON.stringify({ code: '159915', price: 3.9 })]
  );

  assert.deepEqual(parsed, {
    'quote:159915': { code: '159915', price: 3.9 }
  });
});
