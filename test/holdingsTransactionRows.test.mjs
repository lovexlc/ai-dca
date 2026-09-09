import assert from 'node:assert/strict';
import test from 'node:test';

const values = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  },
  dispatchEvent: () => true
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};

const { migrateLegacyAggregateState, persistLedgerState, readLedgerState } = await import('../src/app/holdingsLedger.js');

test('持仓账本持久化只保存交易行，不保存 snapshotsByCode', () => {
  persistLedgerState({
    transactions: [{ id: 'tx-1', code: '000001', type: 'BUY', price: 1, shares: 10 }],
    snapshotsByCode: { '000001': { latestNav: 1.2 } },
    lastNavMeta: { status: 'ok' }
  });
  const raw = JSON.parse(values.get('aiDcaFundHoldingsLedger'));
  assert.deepEqual(raw.transactions.map((item) => item.id), ['tx-1']);
  assert.equal(Object.hasOwn(raw, 'snapshotsByCode'), false);
  assert.deepEqual(readLedgerState().snapshotsByCode, {});
});

test('旧 rows 只转换成合成 BUY 交易，快照不进入新账本', () => {
  values.clear();
  values.set('aiDcaFundHoldingsState', JSON.stringify({
    rows: [{ code: '000001', name: '测试基金', avgCost: 1.1, shares: 10 }],
    snapshotsByCode: { '000001': { latestNav: 1.2 } }
  }));
  const migrated = readLedgerState();
  assert.equal(migrated.transactions.length, 1);
  assert.equal(migrated.transactions[0].type, 'BUY');
  assert.deepEqual(migrated.snapshotsByCode, {});
  const raw = JSON.parse(values.get('aiDcaFundHoldingsLedger'));
  assert.equal(Object.hasOwn(raw, 'snapshotsByCode'), false);
  assert.equal(migrateLegacyAggregateState({ rows: [] }).transactions.length, 0);
});
