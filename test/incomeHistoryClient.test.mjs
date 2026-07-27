import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __internals,
  findIncomeHistoryMissingDates,
} from '../src/app/income/incomeHistoryClient.js';

test('场内日线收盘价转换为上海日期并限定在收益区间', () => {
  const items = __internals.normalizePriceHistory([
    { t: Date.parse('2026-07-01T16:00:00.000Z') / 1000, c: '2.363' },
    { t: Date.parse('2026-07-03T16:00:00.000Z') / 1000, c: 2.4 },
    { t: Date.parse('2026-07-02T16:00:00.000Z') / 1000, c: 0 },
    { t: Date.parse('2026-07-02T16:00:00.000Z') / 1000, c: 'bad' },
  ], '2026-07-01', '2026-07-02');

  assert.deepEqual(items, [
    { date: '2026-07-02', nav: 2.363 },
  ]);
});

test('收益计算识别缺少日期的有效持仓交易', () => {
  const missing = findIncomeHistoryMissingDates([
    { code: '017091', shares: 100, date: '' },
    { code: '021778', shares: 100, date: 'not-a-date' },
    { code: '000001', shares: 0, date: '' },
    { code: '', shares: 100, date: '' },
    { code: '000002', shares: 100, date: '2026-07-01' },
  ]);

  assert.deepEqual(missing.map((tx) => tx.code), ['017091', '021778']);
});

test('513100 按场内代码分类，使用价格历史口径', () => {
  const meta = __internals.codeMetaByCode([
    { code: '513100', name: '纳指ETF' },
  ]);

  assert.equal(meta.get('513100')?.kind, 'exchange');
});
