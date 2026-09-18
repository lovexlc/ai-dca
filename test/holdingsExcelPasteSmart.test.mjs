import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseExcelPaste } from '../src/app/holdingsLedgerPaste.js';
import {
  getTransactionErrors,
  isLikelyDateFundCode,
  normalizeFundCode,
  normalizeIsoDate
} from '../src/app/holdingsLedgerBasics.js';
import { normalizeLedgerState } from '../src/app/holdingsLedger.js';

test('无表头日期在前时按内容识别列', () => {
  const result = parseExcelPaste([
    '2026-9-1\t买入\t513100\t纳指ETF国泰\t2.3000\t1000\t2300',
    '2026/9/2\t卖出\t513100\t纳指ETF国泰\t2.4000\t500\t1200'
  ].join('\n'));

  assert.equal(result.headerDetected, false);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].draft.code, '513100');
  assert.equal(result.rows[0].draft.date, '2026-09-01');
  assert.equal(result.rows[0].draft.type, 'BUY');
  assert.equal(result.rows[0].draft.price, 2.3);
  assert.equal(result.rows[0].draft.shares, 1000);
  assert.equal(result.rows[0].draft.amount, 2300);
  assert.equal(result.rows[0].errors.date, undefined);
  assert.notEqual(result.rows[0].draft.code, '202691');
});

test('券商常见表头识别并支持金额反推场外份额', () => {
  const result = parseExcelPaste([
    '成交日期\t业务名称\t证券代码\t证券名称\t成交均价\t发生数量\t成交金额',
    '2026年9月1日\t申购\t000001\t测试基金\t1.2500\t\t1000'
  ].join('\n'));
  const row = result.rows[0];

  assert.equal(result.headerDetected, true);
  assert.equal(row.draft.date, '2026-09-01');
  assert.equal(row.draft.code, '000001');
  assert.equal(row.draft.type, 'BUY');
  assert.equal(row.draft.amount, 1000);
  assert.equal(row.draft.shares, 800);
  assert.deepEqual(row.errors, {});
});

test('日期输入不会归一化成基金代码', () => {
  assert.equal(normalizeFundCode('2026-9-1'), '');
  assert.equal(normalizeFundCode('2026/09/01'), '');
  assert.equal(normalizeFundCode('2026.09.01'), '');
  assert.equal(normalizeIsoDate('2026.09.01'), '2026-09-01');
  assert.equal(normalizeIsoDate('20260901'), '2026-09-01');
  assert.equal(
    getTransactionErrors({ code: '513100', type: 'BUY', date: '', price: 2, shares: 10 }).date,
    '交易日期必填，格式如 YYYY-MM-DD。'
  );
});

test('历史幽灵流水会在账本归一化时自愈清理', () => {
  const state = normalizeLedgerState({
    transactions: [
      { id: 'ghost-1', code: '202691', type: 'BUY', date: '', price: 1, shares: 1 },
      { id: 'ghost-2', code: '260901', type: 'BUY', date: '', price: 1, shares: 1 },
      { id: 'ok', code: '513100', type: 'BUY', date: '2026-09-01', price: 2, shares: 10 }
    ]
  });

  assert.deepEqual(state.transactions.map((tx) => tx.id), ['ok']);
  assert.equal(isLikelyDateFundCode('202691', ''), true);
});
