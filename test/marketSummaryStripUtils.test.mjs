import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMarketSummaryStripTitle } from '../src/pages/markets/marketSummaryStripUtils.js';

test('resolveMarketSummaryStripTitle collapses market switch labels to A股', () => {
  assert.equal(resolveMarketSummaryStripTitle('US Markets'), 'A股');
  assert.equal(resolveMarketSummaryStripTitle('Asia Markets'), 'A股');
  assert.equal(resolveMarketSummaryStripTitle('A股行情'), 'A股行情');
  assert.equal(resolveMarketSummaryStripTitle(''), 'A股');
});
