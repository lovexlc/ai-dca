import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMobileVisibleSymbols } from '../src/pages/markets/useMobileVisibleMarketSymbols.js';

test('mobile market requests keep DOM order and only include intersecting symbols', () => {
  assert.deepEqual(selectMobileVisibleSymbols({
    orderedSymbols: ['513870', '513390', '513300', '513110'],
    intersectingSymbols: ['513300', '513870'],
  }), ['513870', '513300']);
});

test('mobile market requests use a bounded first-screen fallback before observer entries arrive', () => {
  const orderedSymbols = Array.from({ length: 20 }, (_item, index) => String(513000 + index));
  assert.deepEqual(selectMobileVisibleSymbols({
    orderedSymbols,
    intersectingSymbols: [],
    fallbackCount: 5,
    limit: 8,
  }), orderedSymbols.slice(0, 5));
});

test('mobile market requests deduplicate symbols and enforce the request limit', () => {
  assert.deepEqual(selectMobileVisibleSymbols({
    orderedSymbols: ['513100', '513100', '159659', '513300'],
    intersectingSymbols: ['513100', '159659', '513300'],
    limit: 2,
  }), ['513100', '159659']);
});
