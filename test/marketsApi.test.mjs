import { test } from 'node:test';
import assert from 'node:assert/strict';

import { __internals } from '../src/app/marketsApi.js';

test('market kline inflight key separates full-session intraday requests', () => {
  const latest = __internals.klineInflightKey('513100', {
    timeframe: '5m',
    market: 'cn',
  });
  const fullSession = __internals.klineInflightKey('513100', {
    timeframe: '5m',
    market: 'cn',
    session: 'all',
  });

  assert.notEqual(latest, fullSession);
  assert.equal(fullSession, '513100|cn|5m||0|all');
});
