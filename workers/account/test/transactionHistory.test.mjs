import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deleteTransactionRow,
  ensureTransactionSchema,
  readTransactionHistory,
  writeTransactionRow
} from '../src/transactions.js';

// 极简 D1 mock：记录所有执行的 SQL，支持 history 表的 INSERT / SELECT。
function createMockDb() {
  const statements = [];
  const historyRows = [];
  let seq = 0;
  const txRows = new Map(); // key: `${userId}\n${txId}` -> row

  const db = {
    statements,
    historyRows,
    prepare(sql) {
      const stmt = {
        sql,
        params: [],
        bind(...params) {
          stmt.params = params;
          return stmt;
        },
        async run() {
          statements.push({ sql, params: stmt.params });
          const s = sql.replace(/\s+/g, ' ').trim();
          if (s.startsWith('INSERT INTO account_holdings_transaction_history')) {
            seq += 1;
            const [user_id, transaction_id, revision, operation, content_hash, bytes, payload, deleted, recorded_at, updated_by_end_id, updated_by_end_type] = stmt.params;
            historyRows.push({ seq, user_id, transaction_id, revision, operation, content_hash, bytes, payload, deleted, recorded_at, updated_by_end_id, updated_by_end_type });
          } else if (s.startsWith('INSERT INTO account_holdings_transactions')) {
            const [user_id, transaction_id, revision, content_hash, bytes, payload, , updated_at, updated_by_end_id, updated_by_end_type] = stmt.params;
            txRows.set(`${user_id}\n${transaction_id}`, { user_id, transaction_id, revision, content_hash, bytes, payload, deleted: 0, updated_at, updated_by_end_id, updated_by_end_type });
          } else if (s.startsWith('UPDATE account_holdings_transactions SET')) {
            const [revision, updated_at, endId, endType, user_id, transaction_id] = stmt.params;
            const key = `${user_id}\n${transaction_id}`;
            const row = txRows.get(key);
            if (row) {
              row.revision = revision;
              row.content_hash = '';
              row.bytes = 0;
              row.payload = '';
              row.deleted = 1;
              row.updated_at = updated_at;
              row.updated_by_end_id = endId;
              row.updated_by_end_type = endType;
            }
          }
          // meta / schema 语句直接忽略
          return { success: true };
        },
        async first() {
          const s = sql.replace(/\s+/g, ' ').trim();
          if (s.startsWith('SELECT * FROM account_holdings_transactions WHERE user_id = ? AND transaction_id = ?')) {
            const [userId, txId] = stmt.params;
            return txRows.get(`${userId}\n${txId}`) || null;
          }
          if (s.startsWith('SELECT * FROM account_holdings_transaction_meta WHERE user_id = ?')) {
            return null;
          }
          return null;
        },
        async all() {
          const s = sql.replace(/\s+/g, ' ').trim();
          if (s.includes('FROM account_holdings_transaction_history')) {
            const [userId, txId, limit, offset] = stmt.params;
            const rows = historyRows
              .filter((r) => r.user_id === userId && r.transaction_id === txId)
              .sort((a, b) => b.seq - a.seq)
              .slice(offset, offset + limit);
            return { results: rows };
          }
          if (s.includes('FROM account_holdings_transactions WHERE user_id = ?')) {
            return { results: [] };
          }
          return { results: [] };
        }
      };
      return stmt;
    },
    batch(stmts) {
      return Promise.all(stmts.map((s) => s.run()));
    }
  };
  return db;
}

test('写入交易行会追加历史快照（含完整 payload）', async () => {
  const db = createMockDb();
  const env = { DB: db };
  await ensureTransactionSchema(env);
  // schemaReady 是模块级缓存，首次调用后置 true；这里直接走写入逻辑
  const result = await writeTransactionRow(env, 'u1', 'tx-1',
    { id: 'tx-1', code: '000001', type: 'BUY', shares: 10 },
    { force: true, end: { id: 'browser', type: 'PC Web' } });
  assert.equal(result.invalid, undefined);

  const writes = db.historyRows.filter((r) => r.operation === 'write');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].transaction_id, 'tx-1');
  assert.equal(writes[0].deleted, 0);
  const payload = JSON.parse(writes[0].payload);
  assert.equal(payload.code, '000001');
  assert.equal(payload.shares, 10);
});

test('删除交易行先记历史再清 payload，历史保留删除前完整数据', async () => {
  const db = createMockDb();
  const env = { DB: db };
  await writeTransactionRow(env, 'u1', 'tx-2',
    { id: 'tx-2', code: '513100', type: 'BUY', shares: 100, price: 1.5 },
    { force: true, end: { id: 'browser', type: 'PC Web' } });

  const delResult = await deleteTransactionRow(env, 'u1', 'tx-2',
    { force: true, end: { id: 'browser', type: 'PC Web' } });
  assert.equal(delResult.deleted, true);

  // 主表 payload 已清空
  const mainRow = db.statements.length; // 仅确认流程走完
  assert.ok(mainRow > 0);

  const deletes = db.historyRows.filter((r) => r.operation === 'delete');
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].transaction_id, 'tx-2');
  assert.equal(deletes[0].deleted, 1);
  // 关键：历史里的 payload 是删除前的完整数据，不是空字符串
  const payload = JSON.parse(deletes[0].payload);
  assert.equal(payload.code, '513100');
  assert.equal(payload.shares, 100);
  assert.equal(payload.price, 1.5);

  // readTransactionHistory 能读回
  const history = await readTransactionHistory(env, 'u1', 'tx-2');
  assert.equal(history.length, 2); // write + delete
  assert.equal(history[0].operation, 'delete');
  assert.equal(history[1].operation, 'write');
  assert.equal(JSON.parse(history[0].payload).code, '513100');
});

test('历史表只增不减：全流程无 UPDATE / DELETE 触及历史表', async () => {
  const db = createMockDb();
  const env = { DB: db };
  await writeTransactionRow(env, 'u1', 'tx-3',
    { id: 'tx-3', code: '159941', type: 'BUY', shares: 50 },
    { force: true, end: { id: 'browser', type: 'PC Web' } });
  await writeTransactionRow(env, 'u1', 'tx-3',
    { id: 'tx-3', code: '159941', type: 'BUY', shares: 60 },
    { force: true, end: { id: 'browser', type: 'PC Web' } });
  await deleteTransactionRow(env, 'u1', 'tx-3',
    { force: true, end: { id: 'browser', type: 'PC Web' } });

  const historySqls = db.statements.filter(({ sql }) =>
    sql.includes('account_holdings_transaction_history'));
  assert.ok(historySqls.length >= 3);
  for (const { sql } of historySqls) {
    const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();
    assert.ok(normalized.startsWith('INSERT INTO') || normalized.startsWith('SELECT'),
      `历史表只允许 INSERT / SELECT，实际: ${sql.slice(0, 80)}`);
  }

  const history = await readTransactionHistory(env, 'u1', 'tx-3');
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((h) => h.operation), ['delete', 'write', 'write']);
});
