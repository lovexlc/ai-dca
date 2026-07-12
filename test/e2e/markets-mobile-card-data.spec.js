import { expect, test } from '@playwright/test';

function buildQuote(symbol, index) {
  const price = Number((1.86 + index * 0.017).toFixed(3));
  const change = Number(((index % 3 === 0 ? -1 : 1) * (0.003 + index * 0.0002)).toFixed(3));
  const changePercent = Number(((change / (price - change)) * 100).toFixed(2));
  return {
    symbol,
    code: symbol,
    name: `测试基金 ${symbol}`,
    market: 'cn',
    price,
    previousClose: Number((price - change).toFixed(3)),
    change,
    changePercent,
    high: Number((price * 1.012).toFixed(3)),
    low: Number((price * 0.991).toFixed(3)),
    premiumPercent: Number((1.1 + index * 0.07).toFixed(2)),
    currentYearPercent: Number((8.2 + index * 0.31).toFixed(2)),
    highPoint: { high: Number((price * 1.18).toFixed(3)), highDate: '2026-06-03', source: 'daily-kline-365d' },
    closeHighPoint: { high: Number((price * 1.14).toFixed(3)), highDate: '2026-06-01', source: 'daily-close-kline-365d' },
    latestNavDate: '2026-07-09',
    asOf: '2026-07-10T07:00:00.000Z',
    source: 'playwright-fixture',
  };
}

test.describe('mobile market card data', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('requests visible symbols and fills every card with quote content', async ({ page }) => {
    const quoteBatches = [];
    const detailRequests = [];

    await page.route('https://qt.gtimg.cn/**', (route) => route.abort());
    await page.route('**/api/markets/quotes?**', async (route) => {
      const url = new URL(route.request().url());
      const symbols = String(url.searchParams.get('symbols') || '').split(',').map((symbol) => symbol.trim()).filter(Boolean);
      quoteBatches.push(symbols);
      const quotes = Object.fromEntries(symbols.map((symbol, index) => [symbol, buildQuote(symbol, index)]));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quotes, generatedAt: '2026-07-12T12:00:00.000Z' }) });
    });
    page.on('request', (request) => {
      if (/\/kline\/|nav-history|financials|xueqiu/i.test(request.url())) detailRequests.push(request.url());
    });

    await page.goto('/markets');

    const cards = page.locator('.market-mobile-card');
    await expect(cards.first()).toBeVisible();
    await expect(cards.first().locator('.market-mobile-card__price')).not.toHaveText('—', { timeout: 10_000 });
    await expect(cards.first().locator('.market-mobile-card__change b').first()).not.toHaveText('—');
    await expect(cards.first().locator('.market-mobile-card__change b').nth(1)).not.toHaveText('—');

    await expect.poll(async () => {
      const prices = await page.locator('.market-mobile-card__price').allTextContents();
      return prices.length > 0 && prices.every((value) => value.trim() && value.trim() !== '—');
    }, { timeout: 12_000 }).toBe(true);

    expect(quoteBatches.length).toBeGreaterThan(0);
    expect(quoteBatches[0].length).toBeGreaterThan(0);
    expect(quoteBatches[0].length).toBeLessThanOrEqual(12);
    expect(quoteBatches[0].length).toBeLessThan(await cards.count());
    expect(detailRequests).toEqual([]);

    await page.getByRole('button', { name: '自定义卡片内容' }).click();
    const tableFields = page.locator('.market-card-custom-sheet__table-fields');
    await tableFields.locator('summary').click();
    const highDrawdownRow = tableFields.locator('.market-column-list__row').filter({ hasText: '日高下跌' });
    await highDrawdownRow.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: '完成' }).click();
    await page.getByRole('tab', { name: '表格' }).click();
    await expect(page.locator('.market-mobile-table-view__header')).toContainText('日高下跌');
    await expect(page.locator('.market-mobile-table-view [data-market-symbol]').first()).toContainText(/\d/);

    await expect(page.getByRole('button', { name: /首页|返回|置顶/ })).toHaveCount(0);
  });
});
