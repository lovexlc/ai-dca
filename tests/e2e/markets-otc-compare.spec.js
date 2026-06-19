import { expect, test } from '@playwright/test';
import { visibleChart, waitForWorkspace } from './acceptance-helpers.js';

const OTC_SNAPSHOTS = {
  '000834': {
    code: '000834',
    name: '大成纳斯达克100ETF联接(QDII)A',
    latestNav: 1.2456,
    latestNavDate: '2026-05-22',
    previousNav: 1.2321,
    previousNavDate: '2026-05-21',
    updatedAt: '2026-05-22T15:30:00+08:00'
  },
  '270042': {
    code: '270042',
    name: '广发纳斯达克100ETF联接(QDII)A',
    latestNav: 2.1456,
    latestNavDate: '2026-05-22',
    previousNav: 2.1111,
    previousNavDate: '2026-05-21',
    updatedAt: '2026-05-22T15:30:00+08:00'
  }
};

function navDate(index) {
  const date = new Date(Date.UTC(2026, 4, 1));
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function navItems(code) {
  const base = code === '270042' ? 2.04 : 1.18;
  return Array.from({ length: 36 }, (_, index) => ({
    date: navDate(index),
    nav: Number((base + index * 0.0035).toFixed(4))
  }));
}

async function mockOtcCompareNetwork(page) {
  const networkState = { navHistoryCodes: [] };

  await page.route('**/api/markets/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.endsWith('/fund-metrics')) {
      let body = {};
      try {
        body = route.request().postDataJSON();
      } catch (_error) {
        body = {};
      }
      const codes = Array.isArray(body?.codes) ? body.codes : [];
      return route.fulfill({
        json: {
          items: codes.map((rawCode) => {
            const code = String(rawCode || '').replace(/\D/g, '').slice(-6);
            return OTC_SNAPSHOTS[code] || { code, ok: false, error: 'not mocked' };
          }),
          successCount: codes.length,
          failureCount: 0
        }
      });
    }

    if (path.endsWith('/quotes')) return route.fulfill({ json: { quotes: {} } });
    if (path.includes('/kline/')) return route.fulfill({ json: { candles: [] } });
    if (path.endsWith('/search')) {
      return route.fulfill({
        json: {
          results: [
            { symbol: '270042', code: '270042', name: OTC_SNAPSHOTS['270042'].name, market: 'cn', exchange: '场外基金', assetType: 'otc_fund' }
          ]
        }
      });
    }
    if (path.endsWith('/indices')) return route.fulfill({ json: { indexes: [], generatedAt: '2026-05-22T08:00:00.000Z' } });
    if (path.endsWith('/movers')) return route.fulfill({ json: { movers: [] } });
    if (path.endsWith('/summary')) return route.fulfill({ json: { themes: [], generatedAt: '2026-05-22T08:00:00.000Z' } });
    if (path.endsWith('/sectors')) return route.fulfill({ json: { sectors: [] } });
    if (path.endsWith('/news')) return route.fulfill({ json: { news: [] } });
    if (path.endsWith('/earnings')) return route.fulfill({ json: { earnings: [] } });
    if (path.endsWith('/health')) return route.fulfill({ json: { ok: true } });

    return route.fulfill({ json: {} });
  });

  await page.route('**/api/holdings/nav-history**', async (route) => {
    const url = new URL(route.request().url());
    const code = String(url.searchParams.get('code') || '').replace(/\D/g, '').slice(-6);
    networkState.navHistoryCodes.push(code);
    return route.fulfill({
      json: {
        ok: true,
        code,
        items: navItems(code),
        generatedAt: '2026-05-22T08:00:00.000Z'
      }
    });
  });

  await page.route('**/api/fund-fee**', async (route) => {
    return route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/fund-limit**', async (route) => {
    return route.fulfill({ json: { ok: true, items: [] } });
  });
  await page.route('**/api/notify/**', async (route) => {
    return route.fulfill({ json: { ok: true, configured: {}, setup: {}, events: [] } });
  });

  return networkState;
}

test('OTC fund comparison uses NAV history when K-line data is unavailable', async ({ page }) => {
  const networkState = await mockOtcCompareNetwork(page);
  await page.addInitScript(() => {
    window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
    window.localStorage.setItem('markets:watchlist:v1', JSON.stringify({
      lists: [{
        id: 'default-otc',
        name: '默认-场外基金',
        type: 'cn_otc',
        us: [],
        cn: ['000834', '270042'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }],
      activeListId: 'default-otc',
      defaultsVersion: 5
    }));
  });

  await page.goto('./index.html?tab=markets');
  await waitForWorkspace(page, '行情中心');

  const mainFund = page.getByText('000834').filter({ visible: true }).first();
  await expect(mainFund).toBeVisible({ timeout: 20_000 });
  await mainFund.click();
  await expect(page.getByText(/大成纳斯达克100/).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(visibleChart(page)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /^对比$/ }).click();
  const compareInput = page.locator('input[placeholder="搜索股票代码..."]').filter({ visible: true }).first();
  await compareInput.fill('270042');
  await page.keyboard.press('Enter');

  await expect(page.getByText(/270042/).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => networkState.navHistoryCodes.filter((code) => code === '270042').length).toBeGreaterThan(0);
  await expect(page.getByText(/270042 无数据/)).toHaveCount(0, { timeout: 10_000 });
});
