import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOLDINGS_LEDGER_RESOURCE,
  canonicalTransactionRows,
  extractLegacyTransactions,
  normalizeTransactionRow,
  sortTransactionRows,
  transactionSerialized
} from '../src/transactions.js';

test('持仓交易行必须有稳定 id，并保留交易字段', () => {
  const row = normalizeTransactionRow({ code: '000001', type: 'BUY', shares: 10 }, 'tx-1');
  assert.deepEqual(row, { code: '000001', type: 'BUY', shares: 10, id: 'tx-1' });
  assert.equal(normalizeTransactionRow({ code: '000001' }, ''), null);
  assert.equal(normalizeTransactionRow([], 'tx-1'), null);
});

test('交易行序列按日期与 id 得到稳定 canonical 内容', () => {
  const rows = [
    { data: { id: 'b', date: '2026-02-01' } },
    { data: { id: 'a', date: '2026-01-01' } }
  ];
  assert.deepEqual(sortTransactionRows(rows).map((item) => item.data.id), ['a', 'b']);
  assert.equal(canonicalTransactionRows(rows), '[{"date":"2026-01-01","id":"a"},{"date":"2026-02-01","id":"b"}]');
});

test('单行 payload 有大小限制，旧 ledger 可提取 transactions', () => {
  const valid = transactionSerialized({ id: 'tx-1', code: '000001', type: 'BUY' });
  assert.equal(valid.ok, true);
  assert.equal(transactionSerialized({ id: 'tx-1', data: 'x'.repeat(70 * 1024) }).code, 'TRANSACTION_TOO_LARGE');
  assert.deepEqual(extractLegacyTransactions({ transactions: [{ id: 'tx-1' }], snapshotsByCode: { '000001': {} } }), [{ id: 'tx-1' }]);
  assert.deepEqual(extractLegacyTransactions([{ id: 'tx-2' }]), [{ id: 'tx-2' }]);
  assert.equal(HOLDINGS_LEDGER_RESOURCE, 'holdings/ledger');
});
