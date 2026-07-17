import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTransactionConflictRows,
  getTransactionConflictCounts,
  resolveTransactionConflicts
} from '../src/app/holdingsTransactionConflict.js';

const local = JSON.stringify({ transactions: [
  { id: 'same', code: '000001', date: '2026-01-01', amount: 10 },
  { id: 'changed', code: '000002', date: '2026-01-02', amount: 20 },
  { id: 'local', code: '000003', date: '2026-01-03', amount: 30 }
] });
const remote = JSON.stringify({ transactions: [
  { id: 'same', code: '000001', date: '2026-01-01', amount: 10 },
  { id: 'changed', code: '000002', date: '2026-01-02', amount: 25 },
  { id: 'remote', code: '000004', date: '2026-01-04', amount: 40 }
] });

test('只列出实际冲突并保留交易摘要', () => {
  const rows = buildTransactionConflictRows(local, remote);
  assert.deepEqual(getTransactionConflictCounts(rows), { changed: 1, 'local-only': 1, 'remote-only': 1 });
  assert.equal(rows.find((row) => row.id === 'changed').localSummary.amount, 20);
  assert.equal(rows.find((row) => row.id === 'remote').remoteSummary.code, '000004');
});

test('按逐条选择合并或放弃交易', () => {
  const merged = JSON.parse(resolveTransactionConflicts(local, remote, { changed: 'merge', local: 'merge' }));
  assert.deepEqual(merged.transactions.map((item) => item.id), ['same', 'changed', 'remote', 'local']);
  assert.equal(merged.transactions.find((item) => item.id === 'changed').amount, 20);

  const abandoned = JSON.parse(resolveTransactionConflicts(local, remote, { changed: 'abandon', local: 'abandon' }));
  assert.deepEqual(abandoned.transactions.map((item) => item.id), ['same', 'changed', 'remote']);
  assert.equal(abandoned.transactions.find((item) => item.id === 'changed').amount, 25);
});
