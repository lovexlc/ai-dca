import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOLDINGS_LEDGER_KEY,
  migrateLegacyTradeLedgerStorage,
  normalizeLegacyTrade,
  upgradeLegacyTradeLedgerEnvelope
} from '../src/app/holdingsLedgerMigration.js';
import { hasMeaningfulLocalData } from '../src/app/syncMigration.js';

function storageOf(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    dump() { return Object.fromEntries(values); }
  };
}

test('legacy trade shape converts symbol/side into the unified transaction shape', () => {
  const transaction = normalizeLegacyTrade({
    id: 'old-1',
    symbol: '510300',
    side: 'sell',
    shares: 12,
    price: 4.21,
    date: '2024/1/2',
    note: '旧流水'
  });
  assert.deepEqual(transaction, {
    id: 'old-1',
    code: '510300',
    name: '',
    kind: 'exchange',
    type: 'SELL',
    date: '2024-01-02',
    price: 4.21,
    shares: 12,
    amount: 50.52,
    costPrice: 0,
    switchPairId: '',
    note: '旧流水',
    tags: ['exchange']
  });
});

test('local legacy active and archive ledgers are merged before the old sync snapshot is built', () => {
  const storage = storageOf({
    aiDcaFundHoldingsLedger: JSON.stringify({
      transactions: [{
        id: 'migrated-old-summary',
        code: '510300',
        type: 'BUY',
        price: 99,
        shares: 99,
        note: '从旧持仓汇总迁入，请补录交易日期'
      }]
    }),
    aiDcaTradeLedger: JSON.stringify([{ id: 'buy-1', symbol: '510300', side: 'buy', shares: 10, price: 4 }]),
    aiDcaTradeLedgerArchive: JSON.stringify([{ id: 'sell-1', symbol: '510300', side: 'sell', shares: 2, price: 4.5 }])
  });

  const result = migrateLegacyTradeLedgerStorage(storage);
  const ledger = JSON.parse(storage.getItem(HOLDINGS_LEDGER_KEY));
  assert.equal(result.changed, true);
  assert.deepEqual(ledger.transactions.map((item) => item.id), ['buy-1', 'sell-1']);
  assert.equal(ledger.transactions.some((item) => item.id === 'migrated-old-summary'), false);
});

test('old encrypted snapshot payload is upgraded to one primary ledger and old keys are not restored', () => {
  const upgraded = upgradeLegacyTradeLedgerEnvelope({
    version: 1,
    payload: {
      aiDcaFundHoldingsLedger: JSON.stringify({
        transactions: [{
          id: 'summary',
          code: '000001',
          type: 'BUY',
          price: 10,
          shares: 100,
          note: '从旧持仓汇总迁入，请补录交易日期'
        }]
      }),
      aiDcaTradeLedger: JSON.stringify([{ id: 'detail', symbol: '000001', side: 'buy', shares: 5, price: 8 }]),
      aiDcaTradeLedgerArchive: JSON.stringify([])
    }
  });
  const ledger = JSON.parse(upgraded.payload.aiDcaFundHoldingsLedger);
  assert.deepEqual(ledger.transactions.map((item) => item.id), ['detail']);
  assert.equal('aiDcaTradeLedger' in upgraded.payload, false);
  assert.equal('aiDcaTradeLedgerArchive' in upgraded.payload, false);
  assert.equal(hasMeaningfulLocalData({
    payload: {
      aiDcaTradeLedger: JSON.stringify([{ id: 'detail', symbol: '000001', side: 'buy', shares: 5, price: 8 }])
    }
  }), true);
});
