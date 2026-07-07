import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MARKETS_FULL_TABLE_MODE,
  DEFAULT_MARKETS_WATCH_LIST_EXPANDED,
  getInitialMarketsFullTableMode,
  getInitialMarketsWatchListExpanded
} from '../src/pages/markets/marketLayoutState.js';

test('Markets defaults to expanded full-screen list on first open', () => {
  assert.equal(DEFAULT_MARKETS_FULL_TABLE_MODE, true);
  assert.equal(DEFAULT_MARKETS_WATCH_LIST_EXPANDED, true);
  assert.equal(getInitialMarketsFullTableMode(), true);
  assert.equal(getInitialMarketsWatchListExpanded(), true);
});
