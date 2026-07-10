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


test('search normalizes JJ venue marker without exposing it as the symbol', () => {
  const rows = normalizeSearchResults([{
    symbol: 'JJ539001',
    code: '539001',
    name: '建信纳指数据广场',
    market: 'cn',
    exchange: '场外基金',
    assetType: 'otc_fund',
    fundKind: 'otc'
  }], 'cn', '539001');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, '539001');
  assert.equal(rows[0].fundVenue, 'otc');
  assert.equal(rows[0].assetType, 'otc_fund');
});

test('search keeps exchange and OTC LOF candidates separate by venue', () => {
  const rows = normalizeSearchResults([
    { symbol: 'SZ161130', code: '161130', name: '纳斯达克100LOF', assetType: 'exchange_fund', fundKind: 'exchange' },
    { symbol: 'JJ161130', code: '161130', name: '易方达纳斯达克100ETF联接(QDII-LOF)A人民币', assetType: 'otc_fund', fundKind: 'otc' }
  ], 'cn', '161130');

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.fundVenue), ['exchange', 'otc']);
});
