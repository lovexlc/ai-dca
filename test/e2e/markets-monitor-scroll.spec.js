import { expect, test } from '@playwright/test';
import { DESKTOP_VIEWPORT, MOBILE_VIEWPORT, mockAcceptanceNetwork } from './acceptance-helpers.js';

const MONITOR_SYMBOLS = Array.from({ length: 24 }, (_, index) => String(513100 + index).padStart(6, '0'));

async function seedMonitorList(page) {
  await page.addInitScript((symbols) => {
    window.localStorage.setItem('markets:watchlist:v1', JSON.stringify({
      lists: [{
        id: 'default',
        name: '默认-场内基金',
        type: 'cn_etf',
        us: [],
        cn: symbols,
      }],
      activeListId: 'default',
      defaultsVersion: 12,
    }));
  }, MONITOR_SYMBOLS);

  await page.route('**/api/markets/quotes*', async (route) => {
    const url = new URL(route.request().url());
    const requested = (url.searchParams.get('symbols') || '').split(',').filter(Boolean);
    const quotes = Object.fromEntries(requested.map((symbol, index) => [symbol, {
      symbol,
      shortCode: symbol,
      name: `测试基金 ${index + 1}`,
      price: Number((1 + index / 100).toFixed(4)),
      changePercent: index % 2 ? -1 : 1,
      market: 'cn',
      exchange: '上交所',
      currency: 'CNY',
    }]));
    await route.fulfill({ json: { quotes } });
  });
}

async function expectMonitorListScrollable(page) {
  const list = page.locator('.markets-monitor-list-scroll').filter({ visible: true }).first();
  await expect(list).toBeVisible({ timeout: 25_000 });

  const metrics = await list.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      viewportHeight: window.innerHeight,
      overflowY: getComputedStyle(element).overflowY,
      documentHeight: document.documentElement.scrollHeight,
    };
  });

  expect(metrics.overflowY).toMatch(/auto|scroll/);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.documentHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1);

  await list.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
}

test.describe('markets monitor list scrolling', () => {
  test.beforeEach(async ({ page }) => {
    await mockAcceptanceNetwork(page);
    await seedMonitorList(page);
  });

  test('mobile list scrolls inside the viewport', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('./index.html?tab=markets');
    await expectMonitorListScrollable(page);
  });

  test('desktop table scrolls inside the viewport', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('./index.html?tab=markets');
    await expectMonitorListScrollable(page);
  });
});
