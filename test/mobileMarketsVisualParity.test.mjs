import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const main = await readFile(new URL('../src/pages/markets/MarketsMainContent.jsx', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/pages/markets/MarketsFullTablePanel.jsx', import.meta.url), 'utf8');
const surface = await readFile(new URL('../src/pages/markets/MarketSentimentPageSurface.jsx', import.meta.url), 'utf8');
const experience = await readFile(new URL('../src/pages/MarketsExperience.jsx', import.meta.url), 'utf8');
const mobileList = await readFile(new URL('../src/pages/markets/MobileFundList.jsx', import.meta.url), 'utf8');
const sentimentStrip = await readFile(new URL('../src/pages/markets/MarketSentimentStrip.jsx', import.meta.url), 'utf8');
const consoleCss = await readFile(new URL('../src/styles/console.css', import.meta.url), 'utf8');

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

test('market sentiment surface propagates definite height for inner list scroll', () => {
  // 回归：surface 根与内容区必须是确定高度，否则 h-full 链断裂，
  // body 被 markets-full-table-active 锁死后移动端列表完全划不动。
  assert.match(surface, /fillHeight = false/);
  assert.match(surface, /relative h-full min-h-\[calc\(100vh-var\(--brand-bar-h,48px\)\)\]/);
  assert.match(surface, /fillHeight && 'flex h-full min-h-0 flex-col'/);
  assert.match(experience, /<MarketSentimentPageSurface padBottom=\{false\} fillHeight>/);
  assert.match(experience, /isFullTableOnly\s*\?\s*"flex-1 min-h-0 overflow-hidden pb-0"/);
});

test('mobile list progressively collapses header with scroll distance', () => {
  // 滚动距离驱动渐进收起：从第一屏开始按滚动比例收起，无阈值突变
  assert.match(mobileList, /onScroll=\{handleListScroll\}/);
  assert.match(mobileList, /--collapse-p/);
  assert.match(mobileList, /--collapse-h/);
  assert.match(mobileList, /COLLAPSE_RANGE/);
  assert.match(mobileList, /<div className="market-collapsible">/);
  assert.match(sentimentStrip, /<div className="market-collapsible">/);
  assert.match(consoleCss, /\.market-collapsible/);
  assert.match(consoleCss, /--collapse-p/);
  // A股监控列表卡片（sticky 表头）整体位于收起区内，下滑时一并隐藏
  const collapsibleIdx = mobileList.indexOf('<div className="market-collapsible">');
  const headerIdx = mobileList.indexOf('sticky top-0 z-20 space-y-2');
  assert.ok(collapsibleIdx !== -1 && collapsibleIdx < headerIdx, '列表头卡片应在 market-collapsible 内');
});
