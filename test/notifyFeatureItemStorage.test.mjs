import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAggregateFeatureData, splitFeatureItems } from '../workers/notify/src/notifyItemStorage.js';

test('notification collections are represented as feature item rows', () => {
  const settings = {
    clients: {
      'account:alice:web': {
        clientId: 'account:alice:web',
        ownerUserId: 'alice',
        payload: {
          plans: [{ id: 'plan-1' }, { id: 'plan-2' }],
          dca: { id: 'dca-active' },
          dcaList: [{ id: 'dca-1' }],
          marketAlerts: [{ id: 'market-1' }],
          holdingAlerts: [{ id: 'holding-1' }]
        }
      }
    }
  };
  const rows = splitFeatureItems(settings);
  assert.deepEqual(rows.map((row) => `${row.feature}:${row.itemId}`).sort(), [
    'dca:active',
    'dca-list:dca-1',
    'holding-alerts:holding-1',
    'market-alerts:market-1',
    'plans:plan-1',
    'plans:plan-2'
  ]);
  const cleared = clearAggregateFeatureData(settings);
  assert.deepEqual(cleared.clients['account:alice:web'].payload.plans, []);
  assert.equal(cleared.clients['account:alice:web'].payload.dca, null);
  assert.deepEqual(cleared.clients['account:alice:web'].payload.marketAlerts, []);
});
