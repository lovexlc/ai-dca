import assert from 'node:assert/strict';
import test from 'node:test';

import { CN_OTC_WATCHLIST_PRESETS } from '../src/app/marketsWatchlistStorage.js';
import { NASDAQ_OTC_FUNDS } from '../src/app/nasdaqCatalog.js';
import {
  OTC_ALL_FUNDS,
  OTC_FUND_NAME_BY_CODE,
  OTC_NASDAQ_FUNDS,
  OTC_SP500_FUNDS,
} from '../workers/markets/src/otcFundList.js';

const expectedNewNasdaqCodes = [
  '012751', '012752', '012753', '012871', '015518', '016452', '016453',
  '018043', '018044', '018968', '018969', '019175', '019441', '019442',
  '019738', '019739', '021773', '022525', '022664', '023422', '024237',
  '040047', '040048', '539001',
];

const expectedNewSp500Codes = [
  '003718', '012861', '013425', '013499', '017642', '017643', '018066', '161125',
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

  for (const code of expectedNewNasdaqCodes) {
    assert.equal(frontendCodes.has(code), true, `frontend missing ${code}`);
    assert.equal(workerCodes.has(code), true, `worker missing ${code}`);
    assert.ok(OTC_FUND_NAME_BY_CODE[code], `worker name missing ${code}`);
  }
});

test('SP500 OTC catalog is complete and codes are named correctly', () => {
  const frontendSp = NASDAQ_OTC_FUNDS.filter((item) => item.index_key === 'sp500');
  const frontendCodes = new Set(frontendSp.map((item) => item.code));
  const workerCodes = new Set(OTC_SP500_FUNDS);
  const watchlistCodes = new Set(CN_OTC_WATCHLIST_PRESETS.map((item) => item.symbol));

  assert.equal(frontendCodes.size, 21);
  assert.equal(workerCodes.size, 21);
  assert.deepEqual([...frontendCodes].sort(), [...workerCodes].sort());
  assert.deepEqual([...frontendCodes].sort(), [...watchlistCodes].filter((code) => frontendCodes.has(code)).sort());

  for (const code of expectedNewSp500Codes) {
    assert.equal(frontendCodes.has(code), true, `frontend missing ${code}`);
    assert.equal(workerCodes.has(code), true, `worker missing ${code}`);
    assert.ok(OTC_FUND_NAME_BY_CODE[code], `worker name missing ${code}`);
  }

  // 022523 is Tianhong D, not E Fund A; E Fund A is 161125.
  const byCode = Object.fromEntries(frontendSp.map((item) => [item.code, item]));
  assert.match(byCode['022523'].name, /天弘/);
  assert.match(byCode['161125'].name, /易方达/);
  assert.equal(OTC_FUND_NAME_BY_CODE['022523'], '天弘标普500发起(QDII-FOF)D');
  assert.equal(OTC_FUND_NAME_BY_CODE['161125'], '易方达标普500指数(QDII-LOF)A人民币');

  for (const item of frontendSp) {
    assert.equal(item.name, OTC_FUND_NAME_BY_CODE[item.code], `name mismatch ${item.code}`);
  }
  for (const preset of CN_OTC_WATCHLIST_PRESETS) {
    if (!frontendCodes.has(preset.symbol)) continue;
    assert.equal(preset.name, OTC_FUND_NAME_BY_CODE[preset.symbol], `watchlist name mismatch ${preset.symbol}`);
  }
});
