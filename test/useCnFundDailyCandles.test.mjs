import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasKlineInflightForCacheKey } from '../src/pages/markets/useCnFundDailyCandles.js';

test('daily candle loader reuses inflight 1d requests with or without limit suffix', () => {
  assert.equal(hasKlineInflightForCacheKey(new Set(['513100|1d']), '513100|1d'), true);
  assert.equal(hasKlineInflightForCacheKey(new Set(['513100|1d|365']), '513100|1d'), true);
  assert.equal(hasKlineInflightForCacheKey(new Set(['513100|5m|default']), '513100|1d'), false);
  assert.equal(hasKlineInflightForCacheKey(new Set(['159501|1d|365']), '513100|1d'), false);
});
