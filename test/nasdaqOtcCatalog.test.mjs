import assert from 'node:assert/strict';
import test from 'node:test';

import { CN_OTC_WATCHLIST_PRESETS } from '../src/app/marketsWatchlistStorage.js';
import { NASDAQ_OTC_FUNDS } from '../src/app/nasdaqCatalog.js';
import {
  OTC_ALL_FUNDS,
  OTC_FUND_NAME_BY_CODE,
  OTC_NASDAQ_FUNDS,
} from '../workers/markets/src/otcFundList.js';

const expectedNewCodes = [
  '012751', '012752', '012753', '012871', '015518', '016452', '016453',
  '018043', '018044', '018968', '018969', '019175', '019441', '019442',
  '019738', '019739', '021773', '022525', '022664', '023422', '024237',
  '040047', '040048', '539001',
];

test('NASDAQ OTC catalog includes newly registered share classes and funds', () => {
  const frontendCodes = new Set(NASDAQ_OTC_FUNDS
    .filter((item) => item.index_key === 'nasdaq100')
    .map((item) => item.code));
  const workerCodes = new Set(OTC_NASDAQ_FUNDS);
  const watchlistCodes = new Set(CN_OTC_WATCHLIST_PRESETS.map((item) => item.symbol));

  assert.equal(frontendCodes.size, 60);
  assert.equal(workerCodes.size, 60);
  assert.deepEqual([...frontendCodes].sort(), [...workerCodes].sort());
  assert.deepEqual([...frontendCodes].sort(), [...watchlistCodes].filter((code) => frontendCodes.has(code)).sort());
  assert.deepEqual([...new Set(CN_OTC_WATCHLIST_PRESETS.map((item) => item.symbol))].sort(), [...OTC_ALL_FUNDS].sort());

  for (const code of expectedNewCodes) {
    assert.equal(frontendCodes.has(code), true, `frontend missing ${code}`);
    assert.equal(workerCodes.has(code), true, `worker missing ${code}`);
    assert.ok(OTC_FUND_NAME_BY_CODE[code], `worker name missing ${code}`);
  }
});
