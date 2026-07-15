import assert from 'node:assert/strict';
import test from 'node:test';

import { hasMeaningfulLocalData, mergeMigrationEnvelopes } from '../src/app/syncMigration.js';

test('old-device migration detects real business data but ignores empty values', () => {
  assert.equal(hasMeaningfulLocalData({ payload: { aiDcaTradeLedger: '[]', aiDcaWorkspacePrefs: '{}' } }), false);
  assert.equal(hasMeaningfulLocalData({ payload: { aiDcaTradeLedger: JSON.stringify([{ id: 'tx-1' }]) } }), true);
});

test('old-device migration deduplicates records and unions independent lists', () => {
  const merged = mergeMigrationEnvelopes(
    {
      version: 1,
      payload: {
        aiDcaTradeLedger: JSON.stringify([{ id: 'remote', price: 1 }, { id: 'same', price: 1 }]),
        markets: JSON.stringify({ us: ['AAPL'], cn: ['510300'] })
      }
    },
    {
      version: 1,
      payload: {
        aiDcaTradeLedger: JSON.stringify([{ id: 'local', price: 2 }, { id: 'same', price: 2 }]),
        markets: JSON.stringify({ us: ['MSFT'], cn: ['510300', '159919'] })
      }
    }
  );
  const ledger = JSON.parse(merged.payload.aiDcaTradeLedger);
  const markets = JSON.parse(merged.payload.markets);
  assert.deepEqual(ledger.map((row) => row.id), ['remote', 'same', 'local']);
  assert.equal(ledger.find((row) => row.id === 'same').price, 2);
  assert.deepEqual(markets.us, ['AAPL', 'MSFT']);
  assert.deepEqual(markets.cn, ['510300', '159919']);
});

test('old-device migration rebuilds legacy holdings state from the merged ledger', () => {
  const merged = mergeMigrationEnvelopes(
    {
      payload: {
        aiDcaFundHoldingsLedger: JSON.stringify({
          transactions: [{ id: 'buy-1', code: '510300', type: 'BUY', price: 2, shares: 10 }]
        })
      }
    },
    {
      payload: {
        aiDcaFundHoldingsLedger: JSON.stringify({
          transactions: [{ id: 'sell-1', code: '510300', type: 'SELL', price: 2.2, shares: 4 }]
        }),
        aiDcaFundHoldingsState: JSON.stringify({ rows: [{ id: 'stale', code: '510300', avgCost: 99, shares: 99 }] })
      }
    }
  );
  const state = JSON.parse(merged.payload.aiDcaFundHoldingsState);
  assert.equal(state.rows[0].code, '510300');
  assert.equal(state.rows[0].shares, 6);
  assert.equal(state.rows[0].avgCost, 2);
});
