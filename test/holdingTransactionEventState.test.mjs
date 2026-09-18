import test from 'node:test';
import assert from 'node:assert/strict';
import { areHoldingTransactionsEqual } from '../src/app/holdingTransactionEventState.js';

test('same persisted transactions do not trigger another ledger update', () => {
  const current = [{ id: 'tx-1', code: '513100', type: 'BUY', shares: 10 }];
  const persisted = current.map((item) => ({ ...item }));
  assert.equal(areHoldingTransactionsEqual(current, persisted), true);
});

test('changed persisted transactions are applied', () => {
  const current = [{ id: 'tx-1', code: '513100', shares: 10 }];
  const incoming = [{ id: 'tx-1', code: '513100', shares: 20 }];
  assert.equal(areHoldingTransactionsEqual(current, incoming), false);
});
