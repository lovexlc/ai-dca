import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const CN_SYMBOLS = ['513100', '513500', '159941'];
const US_SYMBOLS = ['QQQ', 'SPY'];

const NAMES = {
  '513100': '纳指ETF 国泰',
  '513500': '标普500ETF 博时',
  '159941': '纳指ETF 广发',
  '513300': '纳斯达克ETF 华夏',
  QQQ: 'Invesco QQQ Trust',
  SPY: 'SPDR S&P 500 ETF Trust',
};

function buildQuote(symbol) {
  const order = ['513100', '513500', '159941', '513300', 'QQQ', 'SPY'];
  const index = Math.max(0, order.indexOf(symbol));
  const changes = { '513100': 1.2, '513500': -0.8, '159941': 6.4, '513300': 2.4, QQQ: 0.7, SPY: -0.3 };
  const price = symbol === 'QQQ' ? 486.12 : symbol === 'SPY' ? 632.45 : Number((1.2 + index * 0.18).toFixed(3));
  const changePercent = changes[symbol] ?? 0;
  const previousClose = Number((price / (1 + changePercent / 100)).toFixed(4));
  const change = Number((price - previousClose).toFixed(4));
  return {
    symbol,
    code: symbol,
    name: NAMES[symbol] || symbol,
    market: /^[A-Z^]/.test(symbol) ? 'us' : 'cn',
    exchange: /^[A-Z^]/.test(symbol) ? 'NASDAQ' : '上交所',
    currency: /^[A-Z^]/.test(symbol) ? 'USD' : 'CNY',
    price,
    previousClose,
    change,
    changePercent,
    open: previousClose,
    high: Number((price * 1.01).toFixed(4)),
    low: Number((price * 0.99).toFixed(4)),
    volume: 1_000_000 + index * 100_000,
    turnover: 5_000_000 + index * 750_000,
    totalShares: 200_000_000 + index * 10_000_000,
    premiumPercent: index % 2 ? 1.8 : 0.6,
    historicalPercentile: 18 + index * 14,
    currentYearPercent: 8 + index * 2,
    return1w: 0.5 + index,
    return1m: 1.5 + index,
    return3m: 3.5 + index,
    return6m: 6.5 + index,
    return1y: 12.5 + index,
    returnBase: 22.5 + index,
    indexCategory: ['513500', 'SPY'].includes(symbol) ? '标普500' : '纳指100',
    highPoint: { high: Number((price * 1.2).toFixed(4)), highDate: '2026-06-01', source: 'daily-kline-365d' },
    closeHighPoint: { high: Number((price * 1.16).toFixed(4)), highDate: '2026-06-01', source: 'daily-close-kline-365d' },
    updatedAt: '2026-07-14T08:00:00.000Z',
    asOf: '2026-07-14T08:00:00.000Z',
    source: 'playwright-fixture',
  };
}

function buildCandles(symbol, count = 280) {
  const quote = buildQuote(symbol);
  const start = Math.floor(Date.UTC(2025, 8, 1) / 1000);
  return Array.from({ length: count }, (_, index) => {
    const close = Number((quote.price * (0.75 + index / (count * 4))).toFixed(4));
    return {
      t: start + index * 86400,
      date: new Date((start + index * 86400) * 1000).toISOString().slice(0, 10),
      o: Number((close * 0.997).toFixed(4)),
      h: Number((close * 1.008).toFixed(4)),
      l: Number((close * 0.992).toFixed(4)),
      c: close,
    };
  });
}

function buildNavItems(symbol, count = 280) {
  return buildCandles(symbol, count).map((candle) => ({ date: candle.date, nav: candle.c }));
}

async function installMarketsFixture(page, { native = false, captureNavigation = false, cnSymbols = CN_SYMBOLS, usSymbols = US_SYMBOLS, quoteDelayMs = 0 } = {}) {
  const state = { quoteBatches: [], heavyRequests: [], searches: [], refreshCount: 0 };

  await page.addInitScript(({ nativeApp, blockWorkspaceNavigation, cnSymbols, usSymbols }) => {
    window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
    if (nativeApp) {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    }
    if (blockWorkspaceNavigation) {
      window.__marketNavigationEvents = [];
      window.addEventListener('workspace:navigate', (event) => {
        window.__marketNavigationEvents.push(event.detail);
        event.stopImmediatePropagation();
      }, true);
    }
    const now = '2026-07-14T08:00:00.000Z';
    window.localStorage.setItem('markets:watchlist:v1', JSON.stringify({
      defaultsVersion: 9,
      activeListId: 'default',
      lists: [
        { id: 'default', name: '场内基金', type: 'cn_etf', cn: cnSymbols, us: usSymbols, createdAt: now, updatedAt: now },
        { id: 'default-otc', name: '场外基金', type: 'cn_otc', cn: ['000834', '270042'], us: [], createdAt: now, updatedAt: now },
      ],
    }));
    window.localStorage.removeItem('markets:groups:v1');
    window.localStorage.setItem('aiDcaMarketAlerts', JSON.stringify([{
      id: 'market-alert:513500:gain',
      type: 'market-alert',
      symbol: '513500',
      name: '标普500ETF 博时',
      alertType: 'gain',
      threshold: 3,
      enabled: true,
    }]));
    window.localStorage.setItem('aiDcaConversionPromptState_v1', JSON.stringify({ lastShownAt: Date.now() }));
  }, { nativeApp: native, blockWorkspaceNavigation: captureNavigation, cnSymbols, usSymbols });

  await page.route('https://qt.gtimg.cn/**', (route) => route.abort());
  await page.route('**/api/markets/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/quotes')) {
      let symbols = String(url.searchParams.get('symbols') || '').split(',').map((item) => item.trim()).filter(Boolean);
      if (!symbols.length) {
        try {
          const body = route.request().postDataJSON();
          symbols = (body.symbols || body.codes || []).map(String);
        } catch {
          symbols = [];
        }
      }
      state.quoteBatches.push(symbols);
      state.refreshCount += 1;
      if (quoteDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, quoteDelayMs));
      return route.fulfill({ json: { quotes: Object.fromEntries(symbols.map((symbol) => [symbol, buildQuote(symbol)])), generatedAt: '2026-07-14T08:00:00.000Z' } });
    }
    if (path.includes('/quote/')) {
      const symbol = decodeURIComponent(path.split('/quote/')[1] || '').toUpperCase();
      return route.fulfill({ json: buildQuote(symbol) });
    }
    if (path.includes('/kline/')) {
      const symbol = decodeURIComponent(path.split('/kline/')[1] || '').toUpperCase();
      return route.fulfill({ json: { candles: buildCandles(symbol) } });
    }
    if (path.endsWith('/search')) {
      const query = String(url.searchParams.get('q') || url.searchParams.get('query') || '').trim();
      state.searches.push(query);
      const candidates = query.toUpperCase().includes('QQQ')
        ? [buildQuote('QQQ')]
        : [buildQuote('513300'), buildQuote('513500')];
      return route.fulfill({ json: { results: candidates } });
    }
    if (path.endsWith('/fund-metrics')) {
      let codes = [];
      try { codes = route.request().postDataJSON()?.codes || []; } catch { codes = []; }
      return route.fulfill({ json: { items: codes.map((code) => ({ ...buildQuote(String(code)), latestNav: buildQuote(String(code)).price, latestNavDate: '2026-07-14' })), successCount: codes.length, failureCount: 0 } });
    }
    if (path.endsWith('/indices')) return route.fulfill({ json: { indexes: [buildQuote('QQQ'), buildQuote('SPY')] } });
    if (path.endsWith('/movers')) return route.fulfill({ json: { movers: [buildQuote('QQQ'), buildQuote('SPY')] } });
    if (path.endsWith('/summary')) return route.fulfill({ json: { themes: [], generatedAt: '2026-07-14T08:00:00.000Z' } });
    if (path.endsWith('/sectors')) return route.fulfill({ json: { sectors: [] } });
    if (path.endsWith('/news')) return route.fulfill({ json: { news: [] } });
    if (path.endsWith('/earnings')) return route.fulfill({ json: { earnings: [] } });
    if (path.endsWith('/financials')) return route.fulfill({ json: { annual: [], quarterly: [] } });
    if (path.endsWith('/xueqiu-fund')) return route.fulfill({ json: { data: null } });
    if (path.endsWith('/health')) return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: {} });
  });

  await page.route('**/api/holdings/nav-history**', async (route) => {
    const url = new URL(route.request().url());
    const symbol = String(url.searchParams.get('code') || '513100');
    return route.fulfill({ json: { ok: true, code: symbol, items: buildNavItems(symbol), generatedAt: '2026-07-14T08:00:00.000Z' } });
  });
  await page.route(/\/api\/holdings\/nav(?:\?|$)/, async (route) => route.fulfill({ json: { items: [], successCount: 0, failureCount: 0 } }));
  await page.route('**/api/fund-fee**', async (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/fund-limit**', async (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/notify/**', async (route) => route.fulfill({ json: { ok: true, configured: {}, setup: {}, events: [] } }));

  page.on('request', (request) => {
    if (/\/kline\/|nav-history|\/financials|xueqiu/i.test(request.url())) state.heavyRequests.push(request.url());
  });
  return state;
}

async function openMarketsList(page) {
  await page.goto('/markets');
  await expect(page.getByText('行情中心').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
}

test.describe('markets desktop interactions', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('market table owns vertical scrolling inside its surface', async ({ page }) => {
    test.setTimeout(90_000);
    const symbols = Array.from({ length: 19 }, (_, index) => String(513100 + index));
    await installMarketsFixture(page, { cnSymbols: symbols });
    await openMarketsList(page);

    const table = page.locator('.market-desktop-panel [data-slot="table"]').first();
    const tableScroll = table.locator('xpath=../..');
    await expect(table.locator('tbody tr').first()).toBeVisible();

    const initialMetrics = await tableScroll.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
      pageScrollHeight: document.documentElement.scrollHeight,
      pageClientHeight: document.documentElement.clientHeight,
    }));
    expect(initialMetrics.overflowY).toMatch(/auto|scroll/);
    expect(initialMetrics.scrollHeight).toBeGreaterThan(initialMetrics.clientHeight);
    expect(initialMetrics.pageScrollHeight).toBeLessThanOrEqual(initialMetrics.pageClientHeight + 1);

    await tableScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => tableScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });

  test('desktop sorting is provided by table headers', async ({ page }) => {
    await installMarketsFixture(page);
    await openMarketsList(page);
    await expect(page.locator('.market-desktop-toolbar__actions button[title="排序"]')).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: '最新价' })).toBeVisible();
  });

  test('desktop column settings match the active view', async ({ page }) => {
    test.setTimeout(90_000);
    await installMarketsFixture(page);
    await openMarketsList(page);

    await page.getByRole('button', { name: '列设置' }).click();
    const tableDialog = page.getByRole('dialog', { name: '列设置' });
    await expect(tableDialog.getByText('当前为表格视图，请使用表格显示字段')).toBeVisible();
    await expect(tableDialog.getByRole('heading', { name: '显示指标' })).toHaveCount(0);
    await expect(tableDialog.locator('.market-column-list__row').filter({ hasText: '溢价率' }).locator('input[type="checkbox"]')).toBeChecked();
    await expect(tableDialog.locator('.market-column-list__row').filter({ hasText: '历史水位' }).locator('input[type="checkbox"]')).toBeChecked();
    await expect(tableDialog.locator('.market-column-list__row').filter({ hasText: '成交额' }).locator('input[type="checkbox"]')).toBeChecked();
    await tableDialog.getByRole('button', { name: '完成' }).click();

    await page.getByRole('button', { name: '卡片', exact: true }).click();
    await page.getByRole('button', { name: '列设置' }).click();
    const cardDialog = page.getByRole('dialog', { name: '列设置' });
    await expect(cardDialog.getByRole('heading', { name: '卡片指标', exact: true })).toBeVisible();
    await cardDialog.getByRole('button', { name: '近3月', exact: true }).click();
    await cardDialog.getByRole('button', { name: '完成' }).click();

    await expect(page.locator('.market-desktop-card-list .market-mobile-card__metrics').first()).toContainText('近3月');
  });

  test('repairs incomplete saved columns before opening the settings sheet', async ({ page }) => {
    await installMarketsFixture(page);
    await page.addInitScript(() => {
      localStorage.setItem('markets:groups:v1', JSON.stringify({
        groups: [{ id: 'cn-etf', name: '场内基金', market: 'cn', sourceListId: 'default', isSystem: true, desktopView: 'table', columns: ['kind'], columnOrder: ['kind'] }],
        activeGroupId: 'cn-etf',
      }));
    });
    await openMarketsList(page);

    await expect(page.getByRole('columnheader', { name: '代码' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '最新价' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('markets:groups:v1')).groups.find((group) => group.id === 'cn-etf').columns)).toEqual(expect.arrayContaining(['kind', 'symbol', 'name', 'price', 'changePercent', 'change', 'updatedAt']));

    await page.getByRole('button', { name: '列设置' }).click();
    const dialog = page.getByRole('dialog', { name: '列设置' });
    const priceField = dialog.locator('.market-column-list__row').filter({ hasText: '最新价 / 净值' }).locator('input[type="checkbox"]');
    await expect(priceField).toBeChecked();
    await expect(priceField).toBeDisabled();
  });

  test('all list controls have visible, persistent effects', async ({ page, context }) => {
    test.setTimeout(90_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const state = await installMarketsFixture(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openMarketsList(page);

    await expect(page.getByTestId('market-row-513100')).toBeVisible();
    await expect.poll(() => state.quoteBatches.length).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    expect(state.heavyRequests).toEqual([]);

    await expect(page.getByRole('tab', { name: '美股行情' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '可转债' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '分级基金' })).toHaveCount(0);
    await expect(page.locator('.market-desktop-quick-row')).toHaveCount(0);
    await expect(page.getByTestId('market-row-513100')).toBeVisible();

    const refreshBefore = state.refreshCount;
    await page.locator('.market-desktop-toolbar__actions button[title="刷新数据"]').click();
    await expect.poll(() => state.refreshCount).toBeGreaterThan(refreshBefore);

    await page.locator('.market-desktop-toolbar__actions button[title="列设置"]').click();
    const columnDialog = page.getByRole('dialog', { name: '列设置' });
    const return1yRow = columnDialog.locator('.market-column-list__row').filter({ hasText: '近1年' });
    const groupsBeforeCancel = await page.evaluate(() => localStorage.getItem('markets:groups:v1'));
    await return1yRow.locator('input[type="checkbox"]').check();
    await return1yRow.getByLabel('近1年列宽').fill('144');
    await columnDialog.getByRole('button', { name: '取消' }).click();
    expect(await page.evaluate(() => localStorage.getItem('markets:groups:v1'))).toBe(groupsBeforeCancel);

    await page.locator('.market-desktop-toolbar__actions button[title="列设置"]').click();
    await page.getByRole('dialog', { name: '列设置' }).locator('.market-column-list__row').filter({ hasText: '近1年' }).locator('input[type="checkbox"]').check();
    await page.getByRole('dialog', { name: '列设置' }).getByRole('button', { name: '完成' }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('markets:groups:v1')).groups.find((group) => group.id === 'cn-etf').columns.includes('return1y'))).toBe(true);

    await page.locator('.market-desktop-toolbar__actions button[title="筛选"]').click();
    const filterDialog = page.getByRole('dialog', { name: '筛选条件' });
    await filterDialog.getByRole('button', { name: '> 5%' }).click();
    await expect(filterDialog.getByRole('button', { name: '查看结果（1）' })).toBeVisible();
    await filterDialog.getByRole('button', { name: '重置' }).click();
    await expect(filterDialog.getByRole('button', { name: '查看结果（3）' })).toBeVisible();
    await filterDialog.getByRole('button', { name: '标普500' }).click();
    await filterDialog.getByRole('button', { name: '查看结果（1）' }).click();
    await expect(page.locator('[data-testid^="market-row-"]')).toHaveCount(1);
    await page.getByRole('button', { name: '清空全部' }).click();
    await expect(page.locator('[data-testid^="market-row-"]')).toHaveCount(3);

    await page.getByRole('columnheader', { name: '今日涨跌幅' }).getByRole('button').click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('markets:groups:v1')).groups.find((group) => group.id === 'cn-etf').sorting[0])).toEqual({ id: 'changePercent', desc: false });

    const returnHeader = page.getByRole('columnheader', { name: '近1年', exact: true });
    await returnHeader.getByRole('button').click();
    await page.getByRole('button', { name: '隐藏列', exact: true }).click();
    await expect(page.getByRole('columnheader', { name: '近1年', exact: true })).toHaveCount(0);

    await expect(page.getByRole('columnheader', { name: '近1年', exact: true })).toHaveCount(0);

    await expect(page.locator('.market-desktop-table-controls')).toHaveCount(0);

    await page.getByRole('button', { name: '基金搜索' }).click();
    const searchInput = page.getByPlaceholder(/搜索基金代码/).filter({ visible: true });
    await searchInput.fill('513300');
    await expect(page.getByRole('button', { name: '加入自选' })).toBeVisible();
    await page.getByRole('button', { name: '加入自选' }).click();
    await expect(page.getByRole('button', { name: '已加入' })).toBeDisabled();
    await expect(page.getByRole('row', { name: /513300/ })).toBeVisible();
    await page.getByRole('button', { name: '关闭基金搜索' }).click();
    await expect(searchInput).toHaveCount(0);

    page.once('dialog', (dialog) => dialog.accept('测试分组'));
    await page.getByRole('button', { name: '新建行情分组' }).click();
    await expect(page.getByRole('tab', { name: '测试分组' })).toBeVisible();
    await page.getByRole('button', { name: '测试分组分组操作' }).click();
    page.once('dialog', (dialog) => dialog.accept('重命名分组'));
    await page.getByRole('dialog', { name: '测试分组分组操作' }).getByRole('button', { name: '重命名' }).click();
    await expect(page.getByRole('tab', { name: '重命名分组' })).toBeVisible();
    await page.getByRole('button', { name: '重命名分组分组操作' }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('dialog', { name: '重命名分组分组操作' }).getByRole('button', { name: '删除分组' }).click();
    await expect(page.getByRole('tab', { name: '重命名分组' })).toHaveCount(0);

    await page.locator('.market-desktop-toolbar__actions button[title="更多行情功能"]').click();
    await page.getByRole('dialog', { name: '更多行情功能' }).getByRole('button', { name: '只看提醒' }).click();
    await expect(page.locator('[data-testid^="market-row-"]')).toHaveCount(1);
    await page.getByRole('button', { name: '清空全部' }).click();

    const expectedShareUrl = page.url();
    await page.locator('.market-desktop-toolbar__actions button[title="更多行情功能"]').click();
    await page.getByRole('dialog', { name: '更多行情功能' }).getByRole('button', { name: '分享页面' }).click();
    await expect(page.getByText('页面链接已复制到剪贴板')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expectedShareUrl);

    await page.locator('.market-desktop-toolbar__actions button[title="更多行情功能"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('dialog', { name: '更多行情功能' }).getByRole('button', { name: '导出数据' }).click();
    const download = await downloadPromise;
    const csv = await readFile(await download.path(), 'utf8');
    expect(csv).toContain('513100');
    expect(csv).not.toContain('undefined');

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('数字颜色');
      await dialog.accept();
    });
    await page.locator('.market-desktop-toolbar__actions button[title="更多行情功能"]').click();
    await page.getByRole('dialog', { name: '更多行情功能' }).getByRole('button', { name: '指标说明' }).click();

    await page.getByRole('button', { name: '卡片' }).click();
    await expect(page.locator('.market-desktop-card-list .market-mobile-card').first()).toBeVisible();
    await page.getByRole('button', { name: '表格' }).click();
    await expect(page.getByTestId('market-row-513100')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('markets mobile and app interactions', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mobile list sheets and detail controls remain actionable', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const state = await installMarketsFixture(page, { captureNavigation: true });
    await openMarketsList(page);
    await expect(page.locator('.market-mobile-card')).toHaveCount(3);
    await page.waitForTimeout(300);
    expect(state.heavyRequests).toEqual([]);

    await page.getByRole('button', { name: '保存当前行情视图' }).click();
    await expect(page.getByText('筛选、排序和列设置已保存到本机')).toBeVisible();

    const refreshBefore = state.refreshCount;
    await page.getByRole('button', { name: '刷新行情' }).click();
    await expect.poll(() => state.refreshCount).toBeGreaterThan(refreshBefore);

    const mobileHeader = page.locator('.markets-mobile-page-header');
    await mobileHeader.getByRole('button', { name: '搜索基金' }).click();
    await page.getByPlaceholder(/搜索基金代码/).filter({ visible: true }).fill('513300');
    await expect(page.getByRole('button', { name: '加入自选' })).toBeVisible();
    await mobileHeader.getByRole('button', { name: '关闭基金搜索' }).click();

    await page.getByRole('button', { name: '筛选', exact: true }).click();
    const filterDialog = page.getByRole('dialog', { name: '筛选条件' });
    await filterDialog.getByRole('button', { name: '> 5%' }).click();
    await expect(filterDialog.getByRole('button', { name: '查看结果（1）' })).toBeVisible();
    await filterDialog.getByRole('button', { name: '查看结果（1）' }).click();
    await expect(page.locator('.market-mobile-card')).toHaveCount(1);
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    await page.getByRole('dialog', { name: '筛选条件' }).getByRole('button', { name: '重置' }).click();
    await page.getByRole('dialog', { name: '筛选条件' }).getByRole('button', { name: '查看结果（3）' }).click();
    await expect(page.locator('.market-mobile-card')).toHaveCount(3);

    await page.getByRole('button', { name: '排序', exact: true }).click();
    const sortDialog = page.getByRole('dialog', { name: '排序条件' });
    await expect(sortDialog.getByRole('button', { name: '管理费率' })).toBeDisabled();
    await expect(sortDialog.getByText('请先去列设置里面把对应列展示出来再排序')).toBeVisible();
    await sortDialog.getByRole('button', { name: '今日涨跌幅' }).click();
    await sortDialog.getByRole('button', { name: '升序' }).click();
    await sortDialog.getByRole('button', { name: '应用' }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('markets:groups:v1')).groups.find((group) => group.id === 'cn-etf').sorting[0])).toEqual({ id: 'changePercent', desc: false });

    await page.getByRole('button', { name: '自定义卡片内容' }).click();
    const cardDialog = page.getByRole('dialog', { name: '自定义卡片内容' });
    await cardDialog.locator('.market-card-custom-sheet__table-fields summary').click();
    await cardDialog.locator('.market-column-list__row').filter({ hasText: '近1年' }).locator('input[type="checkbox"]').check();
    await cardDialog.getByRole('button', { name: '取消' }).click();
    await page.getByRole('tab', { name: '表格' }).click();
    await expect(page.locator('.market-mobile-table-view__header')).not.toContainText('近1年');
    await page.getByRole('button', { name: '自定义卡片内容' }).click();
    await page.getByRole('dialog', { name: '自定义卡片内容' }).locator('.market-card-custom-sheet__table-fields summary').click();
    await page.getByRole('dialog', { name: '自定义卡片内容' }).locator('.market-column-list__row').filter({ hasText: '近1年' }).locator('input[type="checkbox"]').check();
    await page.getByRole('dialog', { name: '自定义卡片内容' }).getByRole('button', { name: '完成' }).click();
    await expect(page.locator('.market-mobile-table-view__header')).toContainText('近1年');

    await page.locator('[data-market-symbol="513100"]').click();
    await expect(page.getByRole('button', { name: '返回行情列表' })).toBeVisible();
    await expect.poll(() => state.heavyRequests.length).toBeGreaterThan(0);
    await expect(page.locator('.recharts-wrapper svg')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: '已添加' }).click();
    await expect(page.getByRole('button', { name: '添加自选' })).toBeVisible();
    await page.getByRole('button', { name: '添加自选' }).click();
    await expect(page.getByRole('button', { name: '已添加' })).toBeVisible();

    await page.getByRole('button', { name: '设置预警' }).click();
    await expect(page.getByRole('dialog').filter({ hasText: '设置市场预警' })).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();

    await page.getByRole('button', { name: '面积图', exact: true }).click();
    await page.getByRole('button', { name: /^点线图\s/ }).click();
    await expect(page.getByRole('button', { name: '点线图', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: /^指标/ }).click();
    await page.getByText('MA5', { exact: true }).last().click();
    await expect(page.getByRole('button', { name: '指标 · 1' })).toBeVisible();

    await page.getByRole('button', { name: '价格', exact: true }).click();
    await page.getByRole('button', { name: /^净值\s/ }).click();
    await expect(page.getByRole('button', { name: '净值', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '净值', exact: true }).first().click();
    await page.getByRole('button', { name: /^价格\s/ }).click();

    await page.getByRole('button', { name: /^对比$/ }).click();
    await page.getByPlaceholder('搜索股票代码...').fill('513500');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: '删除对比标的 513500' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '删除对比标的 513500' }).click();

    await page.getByRole('tab', { name: '自定义' }).click();
    await page.getByLabel('开始').fill('2026-01-01');
    await page.getByLabel('结束').fill('2026-06-30');
    await page.getByRole('button', { name: '应用自定义区间' }).click();
    await expect(page.getByRole('tab', { name: '自定义' })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: '回测' }).click();
    await expect(page.getByRole('dialog', { name: '策略回测' })).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '策略回测' })).toHaveCount(0);

    await page.getByRole('button', { name: '加入持仓' }).click();
    await page.getByRole('button', { name: '设置买入计划' }).click();
    await page.getByRole('button', { name: '定投' }).click();
    expect(await page.evaluate(() => window.__marketNavigationEvents)).toEqual([
      { tab: 'holdings', hash: '' },
      { tab: 'tradePlans', hash: '#new' },
      { tab: 'tradePlans', hash: '#dca-new' },
    ]);
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('aiDcaMarketActionDraft')).action)).toBe('dca-new');

    await page.getByRole('button', { name: '返回行情列表' }).click();
    await expect(page.locator('.market-mobile-table-view')).toBeVisible();
    const overflow = await page.evaluate(() => Math.ceil(document.documentElement.scrollWidth - window.innerWidth));
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('native app header exposes only supported actions and search works', async ({ page }) => {
    await installMarketsFixture(page, { native: true });
    await openMarketsList(page);
    await expect(page.getByRole('button', { name: '保存当前行情视图' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '刷新行情' })).toHaveCount(0);
    await page.getByRole('button', { name: '搜索基金' }).click();
    await page.getByPlaceholder(/搜索基金代码/).filter({ visible: true }).fill('513300');
    await expect(page.getByRole('button', { name: '加入自选' })).toBeVisible();
    await page.getByRole('button', { name: '关闭基金搜索' }).first().click();
    await expect(page.locator('.market-mobile-card')).toHaveCount(3);
  });
});
