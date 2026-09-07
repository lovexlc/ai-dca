import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const panel = await readFile(new URL('../src/pages/markets/MarketsFullTablePanel.jsx', import.meta.url), 'utf8');
const loader = await readFile(new URL('../src/pages/markets/listHistoryCacheLoader.js', import.meta.url), 'utf8');

test('mobile full-table mode requests return and percentile metrics', () => {
  assert.match(panel, /historicalPercentile: true/);
  assert.match(panel, /return1m: true/);
  assert.match(panel, /return3m: true/);
  assert.match(panel, /return1y: true/);
  assert.match(panel, /onColumnVisibilityStateChange\?\.\(/);
});

test('history loader falls back to fund_collector kline data', () => {
  assert.match(loader, /import \{ fetchKline \} from '\.\/marketsApiLoader\.js'/);
  assert.match(loader, /fetchKlineFn\(symbol, \{/);
  assert.match(loader, /timeframe: '1d'/);
  assert.match(loader, /market: 'cn'/);
});
