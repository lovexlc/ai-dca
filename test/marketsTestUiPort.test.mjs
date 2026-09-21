import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const experience = await readFile(new URL('../src/pages/MarketsExperience.jsx', import.meta.url), 'utf8');
const sidebar = await readFile(new URL('../src/pages/markets/MarketsSidebar.jsx', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/pages/markets/MarketsMainContent.jsx', import.meta.url), 'utf8');
const refreshTime = await readFile(new URL('../src/pages/markets/MarketRefreshTime.jsx', import.meta.url), 'utf8');
const sentiment = await readFile(new URL('../src/pages/markets/MarketSentimentStrip.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles/console.css', import.meta.url), 'utf8');

test('markets desktop presentation follows the test branch strip layout', () => {
  assert.match(experience, /markets-experience flex min-w-0 flex-col gap-4/);
  assert.match(sidebar, /markets-watch-strip flex min-w-0 flex-col/);
  assert.match(sidebar, /markets-watch-strip__rows/);
  assert.match(styles, /\.markets-watch-strip__row\s*\{[\s\S]*flex: 0 0 min\(280px, 30vw\)/);
});

test('markets presentation uses the scoped test branch palette', () => {
  assert.match(styles, /--market-accent: var\(--brand\)/);
  assert.match(styles, /--market-rise: #d8001b/);
  assert.match(styles, /--market-fall: #107d32/);
  assert.match(main, /bg-\[var\(--market-surface-muted\)\]/);
});

test('CN market data hooks remain in MarketsExperience', () => {
  assert.match(experience, /useMarketsWatchRefresh\(/);
  assert.match(experience, /useMarketSummaryStrip\(true\)/);
  assert.match(experience, /getNavHistoryForMarkets\(/);
  assert.doesNotMatch(experience, /useOtcD1ListQuery|useExchangeFundListQuery/);
});

test('market views expose the latest quote refresh time', () => {
  assert.match(refreshTime, /data-testid="market-refresh-time"/);
  assert.match(experience, /onRefreshComplete: handleWatchRefreshComplete/);
  assert.match(experience, /marketRefreshAt/);
  assert.match(sidebar, /<MarketRefreshTime/);
  assert.match(main, /fullTablePanel/);
});


test('standard markets include the migrated market sentiment strip', () => {
  assert.match(experience, /MarketSentimentStrip/);
  assert.match(sentiment, /多云见晴/);
  assert.match(sentiment, /F&G/);
  assert.match(sentiment, /VIX/);
  assert.match(sentiment, /晴雨比/);
  assert.match(sentiment, /研报/);
  assert.match(sentiment, /设置/);
  assert.doesNotMatch(experience, /MarketsBetaExperience|MarketsViewTabs|marketsView/);
});
