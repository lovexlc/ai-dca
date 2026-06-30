import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSearchResults } from '../src/pages/markets/marketsCatalog.js';

test('LOF search keeps both exchange and OTC candidates for the same code', () => {
  const rows = normalizeSearchResults([], 'cn', '161130');
  const matches = rows.filter((row) => row.symbol === '161130');

  assert.equal(matches.length, 2);
  assert.ok(matches.some((row) => row.assetType === 'exchange_fund' && row.exchange === '深交所'));
  assert.ok(matches.some((row) => row.assetType === 'otc_fund' && row.exchange === '场外基金'));
});
