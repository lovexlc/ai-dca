import { expect, test } from '@playwright/test';
import { selectCnFundMetric } from './acceptance-helpers.js';

const QUOTE_513100 = {
  symbol: '513100',
  shortCode: '513100',
  name: '纳指ETF国泰',
  price: 2.168,
  previousClose: 2.174,
  change: -0.006,
  changePercent: -0.28,
  exchange: '上交所',
  currency: 'CNY',
  market: 'cn',
  latestNav: 1.996,
  latestNavDate: '2026-06-23',
  valueType: 'fund-metrics',
};

function epochSec(date, time = '15:00:00') {
  return Math.floor(Date.parse(`${date}T${time}+08:00`) / 1000);
}

function makePriceCandles() {
  const dates = [
    '2026-06-16',
    '2026-06-17',
    '2026-06-18',
    '2026-06-19',
    '2026-06-22',
    '2026-06-23',
    '2026-06-24',
  ];
  return dates.map((date, index) => {
    const c = Number((2.12 + index * 0.008).toFixed(4));
    return { t: epochSec(date), o: c - 0.006, h: c + 0.01, l: c - 0.012, c, date };
  });
}

function makeIntradayCandles() {
  return [
    { t: epochSec('2026-06-24', '09:30:00'), o: 2.15, h: 2.16, l: 2.14, c: 2.15 },
    { t: epochSec('2026-06-24', '15:00:00'), o: 2.16, h: 2.18, l: 2.15, c: 2.168 },
  ];
}

function makeNavItems() {
  const dates = [
    '2026-01-02',
    '2026-02-03',
    '2026-03-03',
    '2026-04-01',
    '2026-05-06',
    '2026-06-16',
    '2026-06-23',
  ];
  return dates.map((date, index) => ({ date, nav: Number((1.82 + index * 0.03).toFixed(4)) }));
}

async function mockMarkets(page) {
  await page.addInitScript(() => {
    window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
    window.localStorage.setItem('markets:watchlist:v1', JSON.stringify({
      cn: ['513100'],
      us: [],
      activeListId: 'default',
      defaultsVersion: 6,
      lists: [{
        id: 'default',
        name: '默认-场内基金',
        type: 'cn_etf',
        cn: ['513100'],
        us: [],
        createdAt: '2026-06-24T00:00:00.000Z',
        updatedAt: '2026-06-24T00:00:00.000Z',
      }],
    }));
  });

  await page.route('**/api/markets/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/indices')) {
      return route.fulfill({ json: { indexes: [QUOTE_513100], generatedAt: '2026-06-24T06:00:00.000Z' } });
    }
    if (path.endsWith('/quotes')) {
      return route.fulfill({ json: { quotes: { 513100: QUOTE_513100 } } });
    }
    if (path.endsWith('/quote/513100')) {
      return route.fulfill({ json: QUOTE_513100 });
    }
    if (path.includes('/kline/513100')) {
      const tf = url.searchParams.get('tf');
      return route.fulfill({ json: { candles: tf === '5m' ? makeIntradayCandles() : makePriceCandles() } });
    }
    if (path.endsWith('/fund-metrics')) {
      return route.fulfill({
        json: {
          items: [{ ...QUOTE_513100, code: '513100', ok: true, latestNav: 1.996, latestNavDate: '2026-06-23' }],
          successCount: 1,
          failureCount: 0,
          generatedAt: '2026-06-24T06:00:00.000Z',
        },
      });
    }
    if (path.endsWith('/news')) return route.fulfill({ json: { items: [] } });
    if (path.endsWith('/earnings')) return route.fulfill({ json: { items: [] } });
    if (path.endsWith('/movers')) return route.fulfill({ json: { movers: [] } });
    if (path.endsWith('/summary')) return route.fulfill({ json: { themes: [], generatedAt: '' } });
    if (path.endsWith('/sectors')) return route.fulfill({ json: { sectors: [] } });
    if (path.endsWith('/search')) return route.fulfill({ json: { results: [QUOTE_513100] } });
    return route.fulfill({ json: {} });
  });

  await page.route('**/api/holdings/nav-history**', async (route) => {
    return route.fulfill({
      json: {
        ok: true,
        code: '513100',
        items: makeNavItems(),
        generatedAt: '2026-06-24T06:00:00.000Z',
      },
    });
  });

  await page.route('**/api/fund-fee**', async (route) => route.fulfill({ json: { items: [], successCount: 0, failureCount: 0 } }));
  await page.route('**/api/fund-limit**', async (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/notify/**', async (route) => route.fulfill({ json: { ok: true, events: [] } }));
}

test('CN ETF nav range uses nav history instead of short price kline timeline', async ({ page }) => {
  await mockMarkets(page);

  await page.goto('/index.html?tab=markets&symbol=513100&cnFundParam=nav');
  const row513100 = page.locator('tr').filter({ hasText: '513100', visible: true }).first();
  if (await row513100.isVisible().catch(() => false)) {
    await row513100.click();
  } else {
    await expect(page.getByRole('heading', { name: /纳指.*ETF/ })).toBeVisible({ timeout: 20_000 });
  }

  await selectCnFundMetric(page, 'nav');
  await page.getByRole('tab', { name: '6 个月' }).click();
  await expect(page.locator('.recharts-wrapper svg')).toBeVisible({ timeout: 20_000 });
  await expect.poll(
    () => page.evaluate(() => Array.from(
      document.querySelectorAll('.recharts-wrapper svg text')
    ).map((node) => node.textContent.trim()).filter((text) => /^\d{2}\/\d{1,2}\/\d{1,2}$/.test(text))),
    { timeout: 10_000 }
  ).toEqual(expect.arrayContaining([expect.stringMatching(/26\/0?1|26\/0?2|26\/0?3/)]));
});
