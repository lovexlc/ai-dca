import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildAutoSwitchChains,
  buildQuickSwitchTransactions,
  isQuickSwitchRecordValid
} from '../src/pages/fundSwitchRecordUtils.js';

const QUICK_RECORD = {
  date: '2026-07-14',
  sellCode: '513100',
  sellName: '持仓基金',
  sellPrice: '1.5',
  sellShares: '100',
  buyCode: '159501',
  buyName: '候选基金',
  buyPrice: '1.2',
  buyShares: '125',
  note: '测试切换'
};

test('quick switch record requires two different six-digit fund codes', () => {
  assert.equal(isQuickSwitchRecordValid(QUICK_RECORD), true);
  assert.equal(isQuickSwitchRecordValid({ ...QUICK_RECORD, buyCode: '513100' }), false);
  assert.equal(isQuickSwitchRecordValid({ ...QUICK_RECORD, buyCode: 'abc' }), false);
  assert.equal(isQuickSwitchRecordValid({ ...QUICK_RECORD, sellShares: 0 }), false);
});

test('quick switch transactions cross-link to the counterpart transaction id', () => {
  const [sellTx, buyTx] = buildQuickSwitchTransactions(QUICK_RECORD, {
    baseId: 'switch-test',
    now: '2026-07-14T03:00:00.000Z'
  });

  assert.equal(sellTx.id, 'switch-test-sell');
  assert.equal(buyTx.id, 'switch-test-buy');
  assert.equal(sellTx.switchPairId, buyTx.id);
  assert.equal(buyTx.switchPairId, sellTx.id);
});

test('quick record appears as an automatic switch chain', () => {
  const initialBuy = {
    id: 'initial-buy',
    type: 'BUY',
    code: '513100',
    name: '持仓基金',
    date: '2026-01-02',
    price: 1,
    shares: 100
  };
  const pair = buildQuickSwitchTransactions(QUICK_RECORD, {
    baseId: 'switch-test',
    now: '2026-07-14T03:00:00.000Z'
  });
  const chains = buildAutoSwitchChains([initialBuy, ...pair]);

  assert.equal(chains.length, 1);
  assert.equal(chains[0].name, '513100 → 159501');
  assert.deepEqual(chains[0].legs, [
    { buyTxId: 'initial-buy', sellTxId: 'switch-test-sell' },
    { buyTxId: 'switch-test-buy', sellTxId: '' }
  ]);
});

test('legacy quick-record base ids are not mistaken for transaction ids', () => {
  const brokenBaseId = 'switch-test';
  const chains = buildAutoSwitchChains([{
    id: 'initial-buy', type: 'BUY', code: '513100', date: '2026-01-02', price: 1, shares: 100
  }, {
    id: `${brokenBaseId}-sell`, type: 'SELL', code: '513100', date: '2026-07-14', price: 1.5, shares: 100, switchPairId: brokenBaseId
  }, {
    id: `${brokenBaseId}-buy`, type: 'BUY', code: '159501', date: '2026-07-14', price: 1.2, shares: 125, switchPairId: brokenBaseId
  }]);

  assert.deepEqual(chains, []);
});
