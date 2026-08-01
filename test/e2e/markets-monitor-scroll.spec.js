import { expect, test } from '@playwright/test';
import { DESKTOP_VIEWPORT, MOBILE_VIEWPORT, mockAcceptanceNetwork } from './acceptance-helpers.js';

const MONITOR_SYMBOLS = Array.from({ length: 24 }, (_, index) => String(513100 + index).padStart(6, '0'));
const MONITOR_INDEX_NAMES = [
  '纳指 ETF',
  '标普 500 ETF',
  '美股 50 ETF',
  '恒生科技 ETF',
  '恒生指数 ETF',
  '中概互联 ETF',
  '日经 ETF',
  '黄金 ETF',
  '原油 ETF',
  '测试基金',
];

async function seedMonitorList(page, { distinctIndexNames = false } = {}) {
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
      name: `${distinctIndexNames ? MONITOR_INDEX_NAMES[index % MONITOR_INDEX_NAMES.length] : '测试基金'} ${index + 1}`,
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

  test('mobile app navigation sheet scrolls inside the viewport', async ({ page }) => {
    await page.setViewportSize({ ...MOBILE_VIEWPORT, height: 480 });
    await page.goto('./index.html?tab=markets');
    await page.getByRole('button', { name: '打开导航' }).click();

    const sheet = page.locator('.sheet-content').filter({ visible: true }).first();
    await expect(sheet).toBeVisible();
    const metrics = await sheet.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(metrics.overflowY).toMatch(/auto|scroll/);
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

    await sheet.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect.poll(() => sheet.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });

  test('market column filter options scroll inside the filter menu', async ({ page }) => {
    await seedMonitorList(page, { distinctIndexNames: true });
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('./index.html?tab=markets');

    const indexTrigger = page.getByRole('button', { name: '指数' }).filter({ visible: true }).first();
    await expect(indexTrigger).toBeVisible({ timeout: 25_000 });
    await indexTrigger.click();

    const menu = page.locator('[data-slot="dropdown-menu-content"]').filter({ visible: true }).last();
    await menu.getByRole('button', { name: '过滤' }).click();
    const options = menu.locator('.data-table-filter-options');
    await expect(options).toBeVisible();

    const metrics = await options.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(metrics.overflowY).toMatch(/auto|scroll/);
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

    await options.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect.poll(() => options.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });
});
