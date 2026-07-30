import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPortalQuoteCache } from '../src/pages/portal/portalQuoteCache.js';

test('portal quote cache resolves code aliases and rejects empty writes', () => {
  let now = 1000;
  const cache = createPortalQuoteCache({ ttlMs: 100, now: () => now });
  const quote = { symbol: 'SH513100', code: '513100', price: 1.2, source: 'worker-quotes' };

  cache.setMany({ SH513100: quote, '': { price: 9 } });

  assert.equal(cache.get('513100'), quote);
  assert.equal(cache.get('SH513100', { source: 'worker-quotes' }), quote);
  assert.equal(cache.get('513100', { source: 'other-source' }), null);
  assert.equal(cache.get(''), null);
  assert.equal(cache.size, 2);
});

test('portal quote cache expires entries before the next request', () => {
  let now = 1000;
  const cache = createPortalQuoteCache({ ttlMs: 100, now: () => now });
  cache.setMany({ '513100': { code: '513100', price: 1.2 } });

  assert.ok(cache.get('513100'));
  now = 1101;
  assert.equal(cache.get('513100'), null);
});
