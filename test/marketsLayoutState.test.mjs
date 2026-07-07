import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MARKETS_FULL_TABLE_MODE,
  getInitialMarketsFullTableMode
} from '../src/pages/markets/marketLayoutState.js';

test('Markets defaults to full-table mode on first open', () => {
  assert.equal(DEFAULT_MARKETS_FULL_TABLE_MODE, true);
  assert.equal(getInitialMarketsFullTableMode(), true);
});
