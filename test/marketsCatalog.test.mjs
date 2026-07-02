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

test('exchange fund search does not duplicate prefixed API result or add OTC fallback', () => {
  const rows = normalizeSearchResults([
    {
      symbol: 'sh513110',
      code: '513110',
      name: '纳指ETF华泰柏瑞',
      market: 'cn',
      exchange: '基金',
      assetType: 'exchange_fund',
    },
  ], 'cn', '513110');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, 'SH513110');
  assert.equal(rows[0].name, '纳指ETF华泰柏瑞');
  assert.equal(rows[0].assetType, 'exchange_fund');
});
