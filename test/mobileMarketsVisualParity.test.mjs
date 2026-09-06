import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const main = await readFile(new URL('../src/pages/markets/MarketsMainContent.jsx', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/pages/markets/MarketsFullTablePanel.jsx', import.meta.url), 'utf8');

test('mobile full-table mode hides the market summary strip', () => {
  assert.match(main, /const showMarketSummary = !selectedQuote && !\(isMobile && showFullTable\)/);
  assert.match(main, /\{showMarketSummary \? marketSummary : null\}/);
});

test('mobile fund list restores test branch outer spacing', () => {
  assert.match(panel, /data-mobile-market-layout="test-parity"/);
  assert.match(panel, /className="mx-4 mt-4 flex h-\[calc\(100%-1rem\)\]/);
  assert.match(panel, /data-market-data-source="fund-collector-local"/);
});
