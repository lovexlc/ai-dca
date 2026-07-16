import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMarketCsv, escapeMarketCsvValue } from '../src/pages/markets/marketExport.js';

test('market CSV escapes commas, quotes, and empty values without inserting undefined', () => {
  assert.equal(escapeMarketCsvValue('纳指, "增强"'), '"纳指, ""增强"""');
  assert.equal(escapeMarketCsvValue(null), '""');

  const csv = buildMarketCsv([{
    symbol: '513100',
    name: '纳指, "增强" ETF',
    indexCategory: '纳指100',
    price: 1.234,
    change: 0.012,
    changePercent: 0.98,
    premiumPercent: null,
    updatedAt: '2026-07-14T08:00:00.000Z',
  }]);

  assert.match(csv, /"513100","纳指, ""增强"" ETF"/);
  assert.doesNotMatch(csv, /undefined/);
  assert.equal(csv.split('\n').length, 2);
});

test('market update time uses quote time for exchange rows and NAV date for OTC rows', () => {
  const csv = buildMarketCsv([
    {
      symbol: '513100',
      name: '场内 ETF',
      kind: 'exchange',
      latestNavDate: '2026-07-14',
      asOf: '2026-07-16T03:00:00.000Z',
    },
    {
      symbol: '000834',
      name: '场外基金',
      kind: 'otc',
      latestNavDate: '2026-07-15',
      asOf: '2026-07-16T03:00:00.000Z',
    },
  ]);

  assert.match(csv, /"2026-07-16T03:00:00.000Z"/);
  assert.match(csv, /"2026-07-15"/);
});
