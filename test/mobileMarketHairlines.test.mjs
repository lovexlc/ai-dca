import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const panel = await readFile(new URL('../src/pages/markets/MarketsFullTablePanel.jsx', import.meta.url), 'utf8');
const row = await readFile(new URL('../src/pages/markets/MobileFundRow.jsx', import.meta.url), 'utf8');

test('mobile market panel defines test-style semantic hairlines', () => {
  assert.match(panel, /'--market-border': 'color-mix\(in srgb, var\(--foreground\) 9%, transparent\)'/);
  assert.match(panel, /'--market-border-strong': 'color-mix\(in srgb, var\(--foreground\) 14%, transparent\)'/);
  assert.match(panel, /'--market-surface': 'var\(--card\)'/);
});

test('mobile fund rows use the scoped market surface', () => {
  assert.match(row, /border-\[var\(--market-border\)\] bg-\[var\(--market-surface\)\]/);
  assert.doesNotMatch(row, /border-\[var\(--market-border\)\] bg-white/);
});
