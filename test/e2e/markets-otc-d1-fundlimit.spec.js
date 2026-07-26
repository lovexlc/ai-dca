/**
 * D1-backed OTC quotes: list shows fundLimit from /quotes and skips OCR /api/fund-limit.
 */
import { expect, test } from '@playwright/test';
import { waitForWorkspace } from './acceptance-helpers.js';

const OTC_000834 = {
  symbol: '000834',
  shortCode: '000834',
  code: '000834',
  name: '大成纳斯达克100ETF联接(QDII)A',
  price: 6.1081,
  latestNav: 6.1081,
  latestNavDate: '2026-07-23',
  changePercent: -1.9,
  exchange: '场外基金',
  currency: 'CNY',
  market: 'cn',
  assetType: 'otc_fund',
  source: 'd1',
  fundLimit: {
    code: '000834',
    buyStatus: 'limit_large',
    buyStatusText: '调整大额申购',
    minPurchase: 10,
    maxPurchasePerDay: 100,
    limitChannel: 'app',
    redeemStatus: 'open',
    fixedInvest: true,
  },
};

const OTC_270042 = {
  symbol: '270042',
  shortCode: '270042',
  code: '270042',
  name: '广发纳斯达克100ETF联接(QDII)A',
  price: 2.15,
  latestNav: 2.15,
  latestNavDate: '2026-07-23',
  changePercent: 0.5,
  exchange: '场外基金',
  currency: 'CNY',
  market: 'cn',
  assetType: 'otc_fund',
  source: 'd1',
  fundLimit: {
    code: '270042',
    buyStatus: 'open',
    buyStatusText: '开放申购',
    minPurchase: 1,
    maxPurchasePerDay: 0,
    limitChannel: '',
    redeemStatus: 'open',
  },
};

function seedOtcWatchlist() {
  // defaultsVersion must be >= WATCHLIST_OTC_DEFAULTS_VERSION (12) so normalize
  // does not merge the full 81-fund OTC default list over our two fixtures.
  return {
    lists: [
      {
        id: 'default',
        name: '默认-场内基金',
        type: 'cn_etf',
        us: [],
        cn: ['513100'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'default-otc',
        name: '默认-场外基金',
        type: 'cn_otc',
        us: [],
        cn: ['000834', '270042'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    activeListId: 'default-otc',
    defaultsVersion: 12,
  };
}

async function mockMarketsForD1Otc(page, { includeFundLimitOnQuotes = true } = {}) {
  const networkState = {
    fundLimitHits: [],
    quotesHits: 0,
    listRowsHits: 0,
  };

  await page.addInitScript(() => {
    window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
  });

  await page.route('**/api/markets/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.endsWith('/health')) {
      return route.fulfill({
        json: {
          ok: true,
          hasDb: true,
          otcReadFromD1: true,
        },
      });
    }

    if (path.endsWith('/quotes')) {
      networkState.quotesHits += 1;
      const q834 = includeFundLimitOnQuotes
        ? OTC_000834
        : { ...OTC_000834, fundLimit: undefined };
      const q270 = includeFundLimitOnQuotes
        ? OTC_270042
        : { ...OTC_270042, fundLimit: undefined };
      return route.fulfill({
        json: {
          quotes: {
            '000834': q834,
            '270042': q270,
          },
          meta: { otcSource: includeFundLimitOnQuotes ? 'd1' : 'kv' },
        },
      });
    }

    if (path.endsWith('/list-rows')) {
      networkState.listRowsHits += 1;
      let body = {};
      try {
        body = route.request().postDataJSON() || {};
      } catch {
        body = {};
      }
      const symbols = Array.isArray(body.symbols) ? body.symbols : ['000834', '270042'];
      const byCode = {
        '000834': includeFundLimitOnQuotes ? OTC_000834 : { ...OTC_000834, fundLimit: undefined },
        '270042': includeFundLimitOnQuotes ? OTC_270042 : { ...OTC_270042, fundLimit: undefined },
      };
      const rows = symbols.map((raw) => {
        const code = String(raw || '').replace(/\D/g, '').slice(-6);
        const q = byCode[code] || { symbol: code, code };
        return {
          symbol: code,
          code,
          name: q.name || code,
          price: q.latestNav ?? q.price,
          changePercent: q.changePercent,
          fundLimit: q.fundLimit || null,
          source: q.source || 'd1',
        };
      });
      return route.fulfill({
        json: { rows, total: rows.length, source: includeFundLimitOnQuotes ? 'd1' : 'kv' },
      });
    }

    if (path.endsWith('/fund-metrics')) {
      let body = {};
      try {
        body = route.request().postDataJSON() || {};
      } catch {
        body = {};
      }
      const codes = Array.isArray(body?.codes) ? body.codes : [];
      return route.fulfill({
        json: {
          items: codes.map((raw) => {
            const code = String(raw || '').replace(/\D/g, '').slice(-6);
            const snap = code === '270042' ? OTC_270042 : OTC_000834;
            return {
              code,
              ok: true,
              latestNav: snap.latestNav,
              latestNavDate: snap.latestNavDate,
              price: snap.price,
            };
          }),
          successCount: codes.length,
          failureCount: 0,
        },
      });
    }

    if (path.endsWith('/indices')) {
      return route.fulfill({ json: { indexes: [], generatedAt: '2026-07-26T00:00:00.000Z' } });
    }
    if (path.endsWith('/movers')) return route.fulfill({ json: { movers: [] } });
    if (path.endsWith('/summary')) return route.fulfill({ json: { themes: [] } });
    if (path.endsWith('/sectors')) return route.fulfill({ json: { sectors: [] } });
    if (path.endsWith('/news')) return route.fulfill({ json: { news: [] } });
    if (path.endsWith('/earnings')) return route.fulfill({ json: { earnings: [] } });
    if (path.endsWith('/search')) {
      return route.fulfill({
        json: {
          results: [
            {
              symbol: '000834',
              code: '000834',
              name: OTC_000834.name,
              market: 'cn',
              exchange: '场外基金',
              assetType: 'otc_fund',
            },
          ],
        },
      });
    }
    if (path.includes('/kline/')) return route.fulfill({ json: { candles: [] } });
    if (path.includes('/quote/')) {
      const code = path.split('/').pop();
      const q = code === '270042' ? OTC_270042 : OTC_000834;
      return route.fulfill({ json: includeFundLimitOnQuotes ? q : { ...q, fundLimit: undefined } });
    }

    return route.fulfill({ json: {} });
  });

  await page.route('**/api/fund-limit**', async (route) => {
    const url = route.request().url();
    networkState.fundLimitHits.push({
      method: route.request().method(),
      url,
    });
    return route.fulfill({
      json: {
        code: '000834',
        buyStatus: 'open',
        maxPurchasePerDay: 99999,
        buyStatusText: 'FROM_OCR_SHOULD_NOT_SHOW',
      },
    });
  });

  await page.route('**/api/fund-fee**', async (route) => {
    return route.fulfill({ json: { items: [] } });
  });

  await page.route('**/api/holdings/**', async (route) => {
    return route.fulfill({ json: { ok: true, items: [] } });
  });

  await page.route('**/api/notify/**', async (route) => {
    return route.fulfill({ json: { ok: true, configured: {}, setup: {}, events: [] } });
  });

  return networkState;
}

async function seedMarketsStorage(page) {
  await page.addInitScript((watchlist) => {
    window.localStorage.setItem('markets:watchlist:v1', JSON.stringify(watchlist));
    // Keep limit column visible (tanstack: false = hidden).
    window.localStorage.setItem('markets:columnVisibility', JSON.stringify({ limit: true }));
    window.localStorage.removeItem('markets:tableViewState:v1');
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith('markets:tableViewState:') || key.startsWith('markets:tableViewPresets:'))) {
        window.localStorage.removeItem(key);
      }
    }
  }, seedOtcWatchlist());
}

/** Desktop chips use 限大额/正常申购; mobile metrics use 限额 N元 / 开放申购. */
async function expectLimitUiFromQuotes(page) {
  const row834 = page.locator('[data-row-symbol="000834"]').filter({ visible: true }).first();
  await expect(row834).toBeVisible({ timeout: 20_000 });

  // Scroll horizontally so sticky/overflow tables reveal the limit column.
  await page.evaluate(() => {
    const row = document.querySelector('[data-row-symbol="000834"]');
    let el = row;
    while (el) {
      if (el.scrollWidth > el.clientWidth + 8) el.scrollLeft = el.scrollWidth;
      el = el.parentElement;
    }
  });

  await expect
    .poll(async () => {
      const text = ((await row834.innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
      const body = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
      const has834 =
        text.includes('限大额')
        || text.includes('限额 100')
        || text.includes('限额100')
        || /限额\s*100\s*元/.test(text);
      const has270 =
        body.includes('正常申购')
        || body.includes('开放申购');
      const hasAmount = body.includes('100') || text.includes('100');
      return { has834, has270, hasAmount, text: text.slice(0, 200) };
    }, { timeout: 20_000 })
    .toMatchObject({ has834: true, has270: true, hasAmount: true });

  // Must not surface OCR mock payload.
  await expect(page.getByText('FROM_OCR_SHOULD_NOT_SHOW')).toHaveCount(0);
}

test.describe('markets OTC D1 fundLimit on quotes', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('shows limit from quote.fundLimit and does not call OCR fund-limit', async ({ page }) => {
    const networkState = await mockMarketsForD1Otc(page, { includeFundLimitOnQuotes: true });
    await seedMarketsStorage(page);

    await page.goto('./index.html?tab=markets');
    await waitForWorkspace(page, '行情中心');

    await expectLimitUiFromQuotes(page);

    await page.waitForTimeout(1500);
    expect(networkState.fundLimitHits, 'OCR /api/fund-limit should be skipped when D1 fundLimit is on quotes')
      .toEqual([]);
    expect(networkState.quotesHits).toBeGreaterThan(0);
  });

  test('falls back to OCR fund-limit when quotes omit fundLimit', async ({ page }) => {
    const networkState = await mockMarketsForD1Otc(page, { includeFundLimitOnQuotes: false });
    await seedMarketsStorage(page);

    await page.goto('./index.html?tab=markets');
    await waitForWorkspace(page, '行情中心');

    await expect(page.locator('[data-row-symbol="000834"]').filter({ visible: true }).first())
      .toBeVisible({ timeout: 20_000 });

    await expect.poll(
      () => networkState.fundLimitHits.length,
      { timeout: 20_000, message: 'expected OCR fund-limit when quote has no fundLimit' },
    ).toBeGreaterThan(0);
  });
});
