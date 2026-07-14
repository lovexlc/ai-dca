import { expect, test } from '@playwright/test';

const ETF_CODES = [
  '159513', '159509', '159941', '513100', '159696', '159632',
  '513390', '513300', '159501', '513870', '159660', '513110',
  '159659', '161128', '513500', '513650', '159612', '159655'
];

function buildConfig({ benchmarkClass = 'H', candidateClass = 'L' } = {}) {
  return {
    enabled: false,
    activeRuleId: 'rule-1',
    rules: [{
      id: 'rule-1',
      name: '默认规则',
      enabled: true,
      benchmarkCodes: ['513100'],
      enabledCodes: ['159501'],
      premiumClass: { '513100': benchmarkClass, '159501': candidateClass },
      arbTargetPct: 2,
      intraSellLowerPct: 1,
      intraBuyOtherPct: 3,
      otcPremiumThresholdPct: 99,
      otcMinIntraPremiumLow: 1,
      otcMinIntraPremiumHigh: 2
    }]
  };
}

function buildSnapshot({ benchmarkClass = 'H', candidateClass = 'L', benchmarkPremium = 5, candidatePremium = 1, triggered = true } = {}) {
  const gap = benchmarkClass === 'H'
    ? benchmarkPremium - candidatePremium
    : candidatePremium - benchmarkPremium;
  const kind = benchmarkClass === 'H' ? 'B' : 'A';
  const threshold = kind === 'B' ? 3 : 1;
  return {
    computedAt: '2026-07-14T02:30:00.000Z',
    ruleId: 'rule-1',
    ruleName: '默认规则',
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3,
    premiumClass: { '513100': benchmarkClass, '159501': candidateClass },
    byBenchmark: [{
      benchmarkCode: '513100',
      benchmarkName: '持仓基金',
      benchmarkClass,
      benchmarkPrice: 2.2,
      benchmarkNav: 2,
      benchmarkPremiumPct: benchmarkPremium,
      benchmarkHighPoint: null,
      benchmarkHistoricalPercentile: null,
      benchmarkTurnover: null,
      candidates: [{
        code: '159501',
        name: '候选基金',
        candClass: candidateClass,
        price: 1,
        nav: 1,
        premiumPct: candidatePremium,
        spreadVsBenchmarkPct: benchmarkPremium - candidatePremium,
        highPoint: null,
        historicalPercentile: null,
        turnover: null
      }]
    }],
    signals: triggered ? [{
      kind,
      from: '513100',
      fromName: '持仓基金',
      to: '159501',
      toName: '候选基金',
      gapPct: gap,
      threshold,
      description: `规则 ${kind} 测试信号`
    }] : [],
    triggers: []
  };
}

async function seedSwitchCenter(page, config) {
  await page.addInitScript((seedConfig) => {
    window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
    window.localStorage.clear();
    window.localStorage.setItem('aiDcaFundHoldingsLedger', JSON.stringify({
      source: 'react-fund-holdings-ledger',
      version: 2,
      transactions: [{
        id: 'initial-buy-513100',
        code: '513100',
        name: '持仓基金',
        kind: 'exchange',
        type: 'BUY',
        date: '2026-01-02',
        price: 1,
        shares: 100,
        note: ''
      }],
      snapshotsByCode: {},
      lastNavMeta: { status: 'idle', updatedAt: '', successCount: 0, failureCount: 0, errors: [] },
      switchChains: []
    }));
    window.localStorage.setItem('aiDcaSwitchStrategyPrefs', JSON.stringify(seedConfig));
    window.localStorage.setItem('aiDcaSwitchStrategyWorkerConfig', JSON.stringify(seedConfig));
  }, config);
}

async function mockSwitchCenter(page, config, snapshot, premiums = {}) {
  let currentConfig = config;
  await page.route('**/api/notify/switch/config**', async (route) => {
    if (route.request().method() === 'POST') currentConfig = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, config: currentConfig, clientId: 'e2e-client' } });
  });
  await page.route('**/api/notify/switch/snapshot**', async (route) => {
    await route.fulfill({ json: { ok: true, config: currentConfig, snapshot } });
  });
  await page.route('**/api/notify/switch/run**', async (route) => {
    await route.fulfill({ json: { ok: true, snapshot, summary: { triggered: snapshot.signals.length, pushed: 0 } } });
  });
  await page.route('**/api/markets/fund-metrics**', async (route) => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    const codes = Array.isArray(body?.codes) && body.codes.length ? body.codes : ETF_CODES;
    await route.fulfill({
      json: {
        items: codes.map((code, index) => {
          const premiumPercent = premiums[code] ?? (code === '513100' ? snapshot.byBenchmark[0].benchmarkPremiumPct : code === '159501' ? snapshot.byBenchmark[0].candidates[0].premiumPct : 2);
          return {
            ok: true,
            code,
            name: code === '513100' ? '持仓基金' : code === '159501' ? '候选基金' : `基金 ${code}`,
            price: code === '513100' ? 2.2 : code === '159501' ? 1 : Number((1 + index * 0.01).toFixed(4)),
            latestNav: code === '513100' ? 2 : 1,
            latestNavDate: '2026-07-13',
            premiumPercent,
            asOf: '2026-07-14T02:30:00.000Z'
          };
        }),
        successCount: codes.length,
        failureCount: 0,
        generatedAt: '2026-07-14T02:30:00.000Z'
      }
    });
  });
}

test.describe('mobile switch center', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('counts candidates separately and hides combinations below the rule threshold', async ({ page }) => {
    const config = buildConfig();
    const snapshot = buildSnapshot({ benchmarkPremium: 9.39, candidatePremium: 9.77, triggered: false });
    await seedSwitchCenter(page, config);
    await mockSwitchCenter(page, config, snapshot, { '513100': 9.39, '159501': 9.77 });

    await page.goto('./index.html?tab=fundSwitch');

    await expect(page.getByText('当前没有命中规则的场内切换机会')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('场内共 1 组候选')).toBeVisible();
    await expect(page.getByText('暂无符合规则的切换机会')).toBeVisible();
    await expect(page.locator('.mobile-switch-best-badge')).toHaveCount(0);
  });

  test('renders rule A as sell low and buy high', async ({ page }) => {
    const config = buildConfig({ benchmarkClass: 'L', candidateClass: 'H' });
    const snapshot = buildSnapshot({ benchmarkClass: 'L', candidateClass: 'H', benchmarkPremium: 1, candidatePremium: 1.5 });
    await seedSwitchCenter(page, config);
    await mockSwitchCenter(page, config, snapshot, { '513100': 1, '159501': 1.5 });

    await page.goto('./index.html?tab=fundSwitch');

    await expect(page.getByText('低溢价 L（卖出）')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('高溢价 H（买入）')).toBeVisible();
    await expect(page.getByText(/规则 A · H-L ≤ 1\.00%/).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('quick record creates a visible switch record and missing metrics stay blank', async ({ page }) => {
    const config = buildConfig();
    const snapshot = buildSnapshot();
    await seedSwitchCenter(page, config);
    await mockSwitchCenter(page, config, snapshot, { '513100': 5, '159501': 1 });

    await page.goto('./index.html?tab=fundSwitch');

    const opportunity = page.getByRole('button', { name: '查看 513100 切换至 159501 的方案' });
    await expect(opportunity).toBeVisible({ timeout: 20_000 });
    await expect(opportunity).toContainText('日高下跌 —');
    await expect(opportunity).toContainText('成交额 —');
    await opportunity.click();
    await expect(page.getByRole('button', { name: '启用自动监控' })).toBeVisible();
    await expect(page.getByText('设置提醒')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '分享方案' })).toHaveCount(0);
    await page.getByRole('button', { name: '快速记录' }).click();

    const modal = page.locator('div.fixed.inset-0').filter({ hasText: '登记一次场内 / 场外切换' });
    await expect(modal).toBeVisible();
    await modal.locator('input[type="number"]').nth(1).fill('100');
    await modal.locator('input[type="number"]').nth(3).fill('125');
    await modal.getByRole('button', { name: '保存切换记录' }).click();
    await expect(modal).toBeHidden();

    await page.getByRole('button', { name: '返回推荐切换机会' }).click();
    await page.getByRole('button', { name: '返回机会概览' }).click();
    await page.getByRole('tab', { name: '切换记录' }).click();
    await expect(page.locator('.fund-switch-mobile-content')).toHaveCount(0);
    await expect(page.getByText('513100 → 159501').first()).toBeVisible({ timeout: 20_000 });

    const transactions = await page.evaluate(() => JSON.parse(localStorage.getItem('aiDcaFundHoldingsLedger') || '{}').transactions || []);
    const sell = transactions.find((tx) => tx.id?.endsWith('-sell'));
    const buy = transactions.find((tx) => tx.id?.endsWith('-buy'));
    expect(sell.switchPairId).toBe(buy.id);
    expect(buy.switchPairId).toBe(sell.id);
  });
});

test('desktop quick record opens its modal and the page title uses current terminology', async ({ page }) => {
  const config = buildConfig();
  const snapshot = buildSnapshot();
  await seedSwitchCenter(page, config);
  await mockSwitchCenter(page, config, snapshot, { '513100': 5, '159501': 1 });

  await page.goto('./index.html?tab=fundSwitch');

  await expect(page).toHaveTitle('切换中心');
  await expect(page.getByText('套利目标')).toHaveCount(0);
  await page.locator('button').filter({ hasText: 'H 持仓 1 只' }).click();
  await page.getByRole('button', { name: '快速记录' }).click();
  await expect(page.getByText('登记一次场内 / 场外切换')).toBeVisible();
});
