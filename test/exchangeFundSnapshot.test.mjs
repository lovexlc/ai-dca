import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterExchangeFundRows,
  isExchangeFundCode,
  normalizeExchangeFundItem,
  normalizeExchangeFundOrderBy,
  sortExchangeFundRows,
} from '../workers/markets/src/exchangeFundSnapshot.js';

test('exchange snapshot accepts ETF/LOF codes and strips K-line payloads', () => {
  const item = normalizeExchangeFundItem({
    code: '161128',
    name: '标普信息科技 LOF',
    price: 1.234,
    premium_rate: 0.018,
    drawdownPercentile: 75,
    highPoint: { high: 1.5, highDate: '2025-01-01', source: 'daily-kline-365d' },
    closeHighPoint: { high: 1.4, highDate: '2025-01-02', source: 'daily-close-kline-365d' },
    candles: [{ t: 1, c: 1.2 }],
  });

  assert.equal(isExchangeFundCode('sh161128'), true);
  assert.equal(item.symbol, '161128');
  assert.equal(item.premiumPercent, 0.018);
  assert.equal(item.highPoint.high, 1.5);
  assert.equal(item.highDrawdown, (1.234 - 1.5) / 1.5);
  assert.equal(item.closeHighDrawdown, (1.234 - 1.4) / 1.4);
  assert.equal(item.drawdownPercentile, 75);
  assert.equal('candles' in item, false);
});
test('exchange snapshot canonicalizes sort aliases and keeps missing numbers last', () => {
  assert.deepEqual(
    normalizeExchangeFundOrderBy([{ field: 'premium', dir: 'desc' }, { field: 'code', dir: 'asc' }]),
    [
      { field: 'premiumPercent', dir: 'desc' },
      { field: 'symbol', dir: 'asc' },
    ],
  );

  const rows = [
    { code: '159501', price: null, premiumPercent: null },
    { code: '513100', price: 1.2, premiumPercent: 2 },
    { code: '159509', price: 1.1, premiumPercent: 5 },
  ];
  assert.deepEqual(
    sortExchangeFundRows(rows, [{ field: 'premium', dir: 'desc' }]).map((row) => row.code),
    ['159509', '513100', '159501'],
  );
  assert.deepEqual(
    sortExchangeFundRows(rows, [{ field: 'price', dir: 'asc' }], ['sh513100']).map((row) => row.code),
    ['159509', '513100', '159501'],
  );
});

test('exchange snapshot upgrades legacy Tencent fallback turnover from 万元 to CNY once', () => {
  const legacy = normalizeExchangeFundItem({
    code: '513100',
    price: 2.074,
    turnover: 28584,
    amount: 28584,
    source: 'tencent-quote',
    fallback: 'tencent-price',
  });
  const current = normalizeExchangeFundItem({
    code: '513100',
    price: 2.041,
    turnover: 223409044.98,
    amount: 223409044.98,
    turnoverUnit: 'CNY',
    source: 'tencent-quote',
    fallback: 'tencent-price',
  });

  assert.equal(legacy.turnover, 285840000);
  assert.equal(legacy.amount, 285840000);
  assert.equal(current.turnover, 223409044.98);
  assert.equal(current.amount, 223409044.98);
  assert.equal(current.turnoverUnit, 'CNY');
});

test('exchange snapshot clears drawdown percentile when drawdown depth is missing', () => {
  const item = normalizeExchangeFundItem({
    code: '513100',
    price: 2.041,
    drawdownPercentile: 95.42,
  });

  assert.equal(item.closeHighDrawdown, null);
  assert.equal(item.drawdownPercentile, null);
});

test('exchange snapshot filters only requested symbols, holdings, and query text', () => {
  const rows = [
    { code: '159501', name: '纳指 ETF' },
    { code: '513100', name: '标普 ETF' },
  ];
  assert.deepEqual(
    filterExchangeFundRows(rows, { symbols: ['sh159501'], query: '纳指' }).map((row) => row.code),
    ['159501'],
  );
  assert.deepEqual(
    filterExchangeFundRows(rows, { heldSymbols: ['513100'], heldOnly: true }).map((row) => row.code),
    ['513100'],
  );
});
