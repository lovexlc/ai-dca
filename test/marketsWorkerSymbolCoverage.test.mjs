import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SWITCH_STRATEGY_ETFS } from '../src/app/nasdaqCatalog.js';
import { CN_ETF_WATCHLIST_DEFAULTS } from '../workers/markets/src/defaults.js';
import { TRACKING_SYMBOLS } from '../workers/markets/src/klineBatchSaver.js';
import { classifySymbol } from '../workers/markets/src/symbols.js';

const switchEtfCodes = SWITCH_STRATEGY_ETFS.map((item) => item.code);

test('worker CN ETF defaults cover switch strategy ETFs', () => {
  const defaults = new Set(CN_ETF_WATCHLIST_DEFAULTS);
  const missing = switchEtfCodes.filter((code) => !defaults.has(code));
  assert.deepEqual(missing, []);
});

test('worker kline batch symbols cover switch strategy ETFs', () => {
  const tracking = new Set(TRACKING_SYMBOLS.cn);
  const missing = switchEtfCodes.filter((code) => !tracking.has(code));
  assert.deepEqual(missing, []);
});

test('worker normalizes the saved Nasdaq 100 plan alias to Yahoo NDX', () => {
  assert.deepEqual(classifySymbol('nas-daq100'), { market: 'us', code: '^NDX' });
  assert.deepEqual(classifySymbol('QQQ'), { market: 'us', code: 'QQQ' });
  assert.deepEqual(classifySymbol('VOO'), { market: 'us', code: 'VOO' });
});
