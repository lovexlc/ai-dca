import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MARKETS_FULL_TABLE_MODE,
  DEFAULT_MARKETS_WATCH_LIST_EXPANDED,
  getInitialMarketsFullTableMode,
  getInitialMarketsWatchListExpanded,
  shouldRenderExpandedMarketListOverlay
} from '../src/pages/markets/marketLayoutState.js';

test('Markets defaults to a single full-table renderer on first open', () => {
  assert.equal(DEFAULT_MARKETS_FULL_TABLE_MODE, true);
  assert.equal(DEFAULT_MARKETS_WATCH_LIST_EXPANDED, false);
  assert.equal(getInitialMarketsFullTableMode(), true);
  assert.equal(getInitialMarketsWatchListExpanded(), false);
});

test('Markets expanded overlay never renders on top of full-table mode', () => {
  assert.equal(shouldRenderExpandedMarketListOverlay({ watchListExpanded: true, fullTableMode: true }), false);
  assert.equal(shouldRenderExpandedMarketListOverlay({ watchListExpanded: true, fullTableMode: false }), true);
  assert.equal(shouldRenderExpandedMarketListOverlay({ watchListExpanded: false, fullTableMode: true }), false);
});
