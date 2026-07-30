import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fundLimitKey, navHistoryKey, quoteKey } from '../workers/shared/src/keySchemas.js';

test('shared cache key schema keeps cross-worker key formats canonical', () => {
  assert.equal(quoteKey('sh513100'), 'quote:513100');
  assert.equal(quoteKey('513100'), 'quote:513100');
  assert.equal(navHistoryKey('sh159659', '2026-07'), 'navhist:v1:159659:2026-07');
  assert.equal(fundLimitKey(' 000834 '), 'limit:000834');
});
