import { expect } from '@playwright/test';

export const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
export const MOBILE_VIEWPORT = { width: 390, height: 844 };

const MARKET_QUOTE_513100 = {
  symbol: '513100',
  shortCode: '513100',
  name: '纳指 ETF',
  price: 1.284,
  changePercent: 1.18,
  exchange: '上交所',
  currency: 'CNY',
  market: 'cn'
};

const MARKET_QUOTE_513500 = {
  symbol: '513500',
  shortCode: '513500',
  name: '标普 500 ETF',
  price: 1.112,
  changePercent: -0.22,
  exchange: '上交所',
  currency: 'CNY',
  market: 'cn'
};

function candles(base = 1.2, points = 36) {
  const start = Math.floor(Date.UTC(2026, 4, 18, 1, 30) / 1000);
  return Array.from({ length: points }, (_, index) => {
    const close = Number((base + index * 0.004 + (index % 3) * 0.002).toFixed(4));
    return {
      t: start + index * 30 * 60,
      o: Number((close - 0.003).toFixed(4)),
      h: Number((close + 0.006).toFixed(4)),
      l: Number((close - 0.007).toFixed(4)),
      c: close
    };
  });
}

function navItems(points = 36) {
  return Array.from({ length: points }, (_, index) => ({
    date: `2026-05-${String(index + 1).padStart(2, '0')}`,
    nav: Number((1.19 + index * 0.003).toFixed(4))
  }));
}

export async function mockAcceptanceNetwork(page) {
  await page.addInitScript(() => {
    window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
  });

  await page.route('**/api/markets/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.endsWith('/indices')) {
      return route.fulfill({ json: { indexes: [MARKET_QUOTE_513100, MARKET_QUOTE_513500], generatedAt: '2026-05-25T06:00:00.000Z' } });
    }
    if (path.endsWith('/quotes')) {
      return route.fulfill({ json: { quotes: { 513100: MARKET_QUOTE_513100, 513500: MARKET_QUOTE_513500 } } });
    }
    if (path.endsWith('/quote/QQQ')) {
      return route.fulfill({ json: { symbol: 'QQQ', name: 'Invesco QQQ Trust', price: 486.12, changePercent: 0.8 } });
    }
    if (path.endsWith('/quote/513100')) {
      return route.fulfill({ json: MARKET_QUOTE_513100 });
    }
    if (path.includes('/kline/513100')) {
      return route.fulfill({ json: { candles: candles(1.22, 36) } });
    }
    if (path.includes('/kline/513500')) {
      return route.fulfill({ json: { candles: candles(1.08, 36) } });
    }
    if (path.endsWith('/search')) {
      return route.fulfill({ json: { results: [MARKET_QUOTE_513100] } });
    }
    if (path.endsWith('/news')) return route.fulfill({ json: { news: [] } });
    if (path.endsWith('/earnings')) return route.fulfill({ json: { earnings: [] } });
    if (path.endsWith('/movers')) return route.fulfill({ json: { movers: [MARKET_QUOTE_513100, MARKET_QUOTE_513500] } });
    if (path.endsWith('/summary')) return route.fulfill({ json: { themes: [], generatedAt: '2026-05-25T06:00:00.000Z' } });
    if (path.endsWith('/sectors')) return route.fulfill({ json: { sectors: [] } });
    if (path.endsWith('/health')) return route.fulfill({ json: { ok: true } });

    return route.fulfill({ json: {} });
  });

  await page.route('**/api/holdings/nav-history**', async (route) => {
    await route.fulfill({ json: { ok: true, code: '513100', items: navItems(36) } });
  });

  await page.route(/\/api\/holdings\/nav(?:\?|$)/, async (route) => {
    await route.fulfill({
      json: {
        items: [{ code: '513100', name: '纳指 ETF', latestNav: 1.2534, latestNavDate: '2026-05-22' }],
        successCount: 1,
        failureCount: 0
      }
    });
  });

  await page.route('**/api/notify/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/status')) {
      return route.fulfill({ json: { configured: { bark: false, webWs: false }, setup: { barkDeviceKey: '', webWsCurrentClientRegistrations: [] } } });
    }
    if (url.pathname.endsWith('/events')) return route.fulfill({ json: { events: [] } });
    if (url.pathname.endsWith('/holdings-rule')) return route.fulfill({ json: { enabled: false, digest: null } });
    return route.fulfill({ json: { ok: true } });
  });
}

export async function waitForWorkspace(page, label) {
  await expect(visibleText(page, label)).toBeVisible({ timeout: 20_000 });
}

export function visibleText(page, text) {
  return page.getByText(text).filter({ visible: true }).first();
}

export function visibleChart(page) {
  return page.locator('.recharts-wrapper svg, [role="application"]').filter({ visible: true }).first();
}

export async function expectNoCrash(page) {
  await expect(page.locator('body')).not.toContainText(/Cannot access|Unhandled Runtime Error|TypeError|ReferenceError/);
}

export async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => Math.ceil(document.documentElement.scrollWidth - window.innerWidth));
  expect(overflow).toBeLessThanOrEqual(1);
}

export async function openMarketsCnEtfDetail(page) {
  await page.goto('./index.html?tab=markets');
  await waitForWorkspace(page, '行情中心');
  const cnMarketButton = page.getByRole('button', { name: /A\s*股/ });
  if (await cnMarketButton.isVisible().catch(() => false)) {
    await cnMarketButton.click();
  } else {
    await expect(page.getByText('A 股监控列表').filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
  }
  const cnEtfRow = page.locator('tr').filter({ hasText: '513100', visible: true }).first();
  await expect(cnEtfRow).toBeVisible({ timeout: 20_000 });
  await cnEtfRow.click();
  await expect(page.getByRole('heading', { name: /纳指.*ETF/ })).toBeVisible({ timeout: 20_000 });
}

export async function selectCnFundMetric(page, value) {
  const paramSelect = page.getByLabel('A股基金图表参数').first();
  if (await paramSelect.isVisible().catch(() => false)) {
    await paramSelect.selectOption(value);
  } else {
    const metricLabel = value === 'nav' ? '净值' : value === 'premium' ? '溢价' : '价格';
    const metricButton = page.getByRole('button', { name: /^(价格|净值|溢价)$/ }).first();
    await expect(metricButton).toBeVisible({ timeout: 10_000 });
    if ((await metricButton.innerText()).trim() !== metricLabel) {
      await metricButton.click();
      await page.getByRole('button', { name: new RegExp(`^${metricLabel}(\\s|$)`) }).last().click();
    }
  }
  await expect(page.locator('[aria-label="页面加载中"]')).toHaveCount(0, { timeout: 10_000 });
  const loadingText = value === 'nav' ? '正在获取净值' : value === 'premium' ? '正在计算溢价' : '';
  if (loadingText) {
    await expect(page.getByText(loadingText)).toHaveCount(0, { timeout: 10_000 });
  }
  await expect(visibleChart(page)).toBeVisible({ timeout: 10_000 });
}

export async function selectChartRange(page, label) {
  await page.getByRole('tab', { name: label }).click();
}

export async function ensureNotifyConfigExpanded(page) {
  const expand = page.getByRole('button', { name: '展开通知接入配置' });
  if (await expand.isVisible().catch(() => false)) {
    await expand.click();
  }
  await expect(page.getByRole('tablist', { name: '通知平台' })).toBeVisible({ timeout: 10_000 });
}
