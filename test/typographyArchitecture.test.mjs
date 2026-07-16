import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { renderNAVChart } from '../workers/markets-agent/container/skills/fund-backtest/lib/chart.js';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
const normalizeFamily = (value) => value.replace(/["']/g, '').replace(/\s+/g, '').toLowerCase();

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true })) {
    const relativePath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...sourceFiles(relativePath));
    else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) files.push(relativePath);
  }
  return files;
}

test('typography tokens have one canonical source and load after legacy styles', () => {
  const app = read('src/styles/app.css');
  const tokens = read('src/styles/tokens.css');
  const typography = read('src/styles/typography.css');

  assert.equal(tokens.match(/--app-font-ui\s*:/g)?.length, 1);
  assert.equal(tokens.match(/--app-font-code\s*:/g)?.length, 1);
  assert.match(tokens, /--app-font-sans:\s*var\(--app-font-ui\)/);
  assert.match(tokens, /--app-font-mono:\s*var\(--app-font-code\)/);
  assert.ok(app.indexOf('@import "./typography.css"') > app.indexOf('@import "./console.css"'));
  assert.match(app, /--font-sans:\s*var\(--app-font-ui\)/);
  assert.match(app, /--font-mono:\s*var\(--app-font-code\)/);
  assert.match(typography, /\.type-data[\s\S]*font-variant-numeric:\s*lining-nums tabular-nums/);
  assert.match(typography, /\.type-code[\s\S]*font-family:\s*var\(--app-font-code\)/);
});

test('production styles do not restore global font overrides or dead font stacks', () => {
  const app = read('src/styles/app.css');
  const productionCss = [
    app,
    read('src/styles/tokens.css'),
    read('src/styles/typography.css'),
    read('src/styles/topbar.css'),
    read('src/styles/console.css')
  ].join('\n');

  assert.doesNotMatch(app, /#root\s+\*[^{]*\{[^}]*font-family/s);
  assert.doesNotMatch(productionCss, /\[style\*=["']font-family/);
  assert.doesNotMatch(productionCss, /font-family\s*:[^;}]*!important/);
  assert.doesNotMatch(productionCss, /\bInter\b|SF Pro (?:Text|Display)/);
  assert.doesNotMatch(productionCss, /font-weight\s*:\s*(?:550|650|750|760|780)\b/);
  assert.match(productionCss, /--market-font-family:\s*var\(--app-font-ui\)/);
});

test('business source uses explicit Data and Code roles instead of font-mono', () => {
  const offenders = sourceFiles('src')
    .filter((file) => /\bfont-mono\b/.test(read(file)));

  assert.deepEqual(offenders, []);
});

test('standalone NAV SVG declares the shared system stack once at its root', () => {
  const tokenFamily = read('src/styles/tokens.css').match(/--app-font-ui:\s*([^;]+);/)?.[1];
  const svg = renderNAVChart(
    ['2026-07-14', '2026-07-15'],
    { '513100': [1, 1.01], QQQ: [2, 1.98] }
  );

  assert.match(svg, /^<svg[^>]+font-family="system-ui,/);
  assert.equal(svg.match(/font-family=/g)?.length, 1);
  assert.doesNotMatch(svg, /ui-sans-serif/);
  assert.equal(normalizeFamily(svg.match(/font-family="([^"]+)"/)?.[1] || ''), normalizeFamily(tokenFamily || ''));
});

test('design mockups use the same UI family order as production', () => {
  const tokenFamily = read('src/styles/tokens.css').match(/--app-font-ui:\s*([^;]+);/)?.[1] || '';
  const mockups = [
    'docs/mockups/income/income-detail-layout-demos.html',
    'docs/mockups/income/income-hero-demos.html',
    'docs/mockups/hero-v6.7/index.html'
  ];

  for (const file of mockups) {
    const mockupFamily = read(file).match(/font-family:\s*([^;}]+)[;}]/)?.[1] || '';
    assert.equal(normalizeFamily(mockupFamily), normalizeFamily(tokenFamily), file);
  }
});

test('desktop market and holdings tables share the compact data role', () => {
  const typography = read('src/styles/typography.css');
  const marketTable = read('src/pages/markets/MarketListTable.jsx');
  const holdingsTable = read('src/pages/holdings/AggregateHoldingsTableSection.jsx');

  assert.match(marketTable, /tableClassName="market-data-table/);
  assert.match(holdingsTable, /tableClassName="holdings-data-table/);
  assert.match(typography, /table\.market-data-table[\s\S]*font-size:\s*var\(--app-type-table-body-size\)/);
  assert.match(typography, /table\.holdings-data-table[\s\S]*font-size:\s*var\(--app-type-table-body-size\)/);
  assert.match(typography, /table\.holdings-data-table thead th[\s\S]*text-transform:\s*uppercase/);
});
