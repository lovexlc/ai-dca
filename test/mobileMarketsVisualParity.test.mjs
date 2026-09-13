import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const main = await readFile(new URL('../src/pages/markets/MarketsMainContent.jsx', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/pages/markets/MarketsFullTablePanel.jsx', import.meta.url), 'utf8');

test('mobile full-table mode hides the market summary strip', () => {
  assert.doesNotMatch(main, /MarketSummaryStrip/);
  assert.match(main, /<Sheet open onOpenChange=/);
  assert.match(main, /style=\{\{ width: '100vw', maxWidth: '100vw' \}\}/);
});

test('mobile fund list restores test branch outer spacing', () => {
  assert.match(panel, /data-mobile-market-layout="test-parity"/);
  assert.match(panel, /className="flex h-full min-h-0 flex-col overflow-hidden lg:hidden"/);
  assert.doesNotMatch(panel, /className="mx-4 mt-4/);
  assert.match(panel, /data-market-data-source="fund-collector-local"/);
});
