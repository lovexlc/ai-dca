import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSwitchRecords, buildSwitchRecordsCsv } from '../src/components/markets/backtestSwitchRecords.js';

test('buildSwitchRecords returns all complete sell-buy switch groups', () => {
  const trades = [
    { ts: 1, type: 'buy', code: '513100', price: 1.1 },
    { ts: 2, type: 'sell', code: '513100', price: 1.2, shares: 100 },
    { ts: 2, type: 'buy', code: '159501', price: 1.3, shares: 100 },
    { ts: 3, type: 'sell', code: '159501', price: 1.4, shares: 100 },
    { ts: 3, type: 'buy', code: '513100', price: 1.5, shares: 100 },
    { ts: 4, type: 'sell', code: '513100', price: 1.6, shares: 100 },
  ];
  const signals = [
    { ts: 2, rule: 'B', gapPct: 1.23 },
    { ts: 3, rule: 'A', gapPct: -0.56 },
  ];

  const records = buildSwitchRecords(trades, signals);

  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => [record.sell.code, record.buy.code, record.signal.rule]), [
    ['513100', '159501', 'B'],
    ['159501', '513100', 'A'],
  ]);
});

test('buildSwitchRecordsCsv exports switch rows with escaped text', () => {
  const csv = buildSwitchRecordsCsv([
    {
      ts: 2,
      signal: { datetime: '2026-07-08T15:00:00+08:00', rule: 'B', gapPct: 1.23456 },
      sell: { code: '513100', price: 1.2, shares: 100, amount: 120, fee: 0.01, netProceeds: 119.99, profit: 10 },
      buy: { code: '159501', price: 1.3, shares: 100, amount: 130, fee: 0.01, totalCost: 130.01 },
    }
  ], { formatDate: (value) => String(value).slice(0, 10) });

  assert.match(csv, /"日期","规则","H-L溢价差"/);
  assert.match(csv, /"2026-07-08","B","1.2346","513100"/);
  assert.match(csv, /"159501","1.300000","100.0000","130.00"/);
});
