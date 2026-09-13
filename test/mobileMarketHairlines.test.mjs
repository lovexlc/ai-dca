import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const panel = await readFile(new URL('../src/pages/markets/MarketsFullTablePanel.jsx', import.meta.url), 'utf8');
const row = await readFile(new URL('../src/pages/markets/MobileFundRow.jsx', import.meta.url), 'utf8');
const consoleStyles = await readFile(new URL('../src/styles/console.css', import.meta.url), 'utf8');

test('mobile market panel defines test-style semantic hairlines', () => {
  assert.match(consoleStyles, /--market-border: var\(--a-200\)/);
  assert.match(consoleStyles, /--market-border-strong: var\(--a-400\)/);
  assert.match(consoleStyles, /--market-surface: var\(--bg-100\)/);
  assert.doesNotMatch(panel, /style=\{\{[\s\S]*--market-border/);
});

test('mobile fund rows use the scoped market surface', () => {
  assert.match(row, /border-\[var\(--market-border\)\] bg-\[var\(--market-surface\)\]/);
  assert.doesNotMatch(row, /border-\[var\(--market-border\)\] bg-white/);
});
