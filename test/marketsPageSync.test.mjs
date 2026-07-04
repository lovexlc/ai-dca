import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldRefreshMarketsHoldingsFromSyncEvent } from '../src/pages/markets/useMarketsPageSync.js';

function syncEvent(keys) {
  return { detail: { keys } };
}

test('Markets sync refreshes holdings when backup applies holdings or trade ledger keys', () => {
  assert.equal(shouldRefreshMarketsHoldingsFromSyncEvent(syncEvent(['aiDcaFundHoldingsLedger'])), true);
  assert.equal(shouldRefreshMarketsHoldingsFromSyncEvent(syncEvent(['aiDcaTradeLedger'])), true);
});

test('Markets sync ignores backup events unrelated to holdings chart markers', () => {
  assert.equal(shouldRefreshMarketsHoldingsFromSyncEvent(syncEvent(['markets:watchlist:v1'])), false);
  assert.equal(shouldRefreshMarketsHoldingsFromSyncEvent(syncEvent(['aiDcaPlanStore'])), false);
});

test('Markets sync refreshes holdings on broad sync events without explicit keys', () => {
  assert.equal(shouldRefreshMarketsHoldingsFromSyncEvent(syncEvent([])), true);
  assert.equal(shouldRefreshMarketsHoldingsFromSyncEvent({}), true);
});
