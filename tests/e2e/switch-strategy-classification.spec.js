import { expect, test } from '@playwright/test';

const ETF_CODES = [
  '159513',
  '159509',
  '159941',
  '513100',
  '159696',
  '159632',
  '513390',
  '513300',
  '159501',
  '513870',
  '159660',
  '513110',
  '159659',
  '161128'
];

async function seedSwitchPage(page, { withHolding = true } = {}) {
  await page.addInitScript(({ withHolding }) => {
    window.localStorage.clear();
    window.localStorage.setItem('aiDcaFundHoldingsLedger', JSON.stringify({
      source: 'react-fund-holdings-ledger',
      version: 2,
      transactions: withHolding ? [{
        id: 'tx-held-513100',
        code: '513100',
        name: '国泰纳斯达克100ETF',
        kind: 'exchange',
        type: 'BUY',
        date: '2026-05-01',
        price: 1.2,
        shares: 1000,
        note: ''
      }] : [],
      snapshotsByCode: {},
      lastNavMeta: { status: 'idle', updatedAt: '', successCount: 0, failureCount: 0, errors: [] },
      switchChains: []
    }));
    window.localStorage.setItem('aiDcaSwitchStrategyPrefs', JSON.stringify({
      enabled: false,
      activeRuleId: 'rule-1',
      rules: [{
        id: 'rule-1',
        name: '默认规则',
        enabled: true,
        benchmarkCodes: ['513100'],
        enabledCodes: [],
        premiumClass: {},
        arbTargetPct: 2,
        intraSellLowerPct: 1,
        intraBuyOtherPct: 3,
        otcPremiumThresholdPct: 8,
        otcMinIntraPremiumLow: 1,
        otcMinIntraPremiumHigh: 2
      }]
    }));
  }, { withHolding });
}

async function mockSwitchNetwork(page) {
  await page.route('https://tools.freebacktrack.tech/api/markets/fund-metrics**', async (route) => {
    const request = route.request();
    const body = request.method() === 'POST' ? request.postDataJSON() : {};
    const codes = Array.isArray(body?.codes) && body.codes.length ? body.codes : ETF_CODES;
    await route.fulfill({
      json: {
        items: codes.map((code, index) => ({
          ok: true,
          code,
          name: code === '513100' ? '国泰纳斯达克100ETF' : `纳指 ETF ${code}`,
          price: Number((1.1 + index * 0.01).toFixed(4)),
          latestNav: Number((1.08 + index * 0.01).toFixed(4)),
          latestNavDate: '2026-06-08',
          premiumPercent: index % 2 === 0 ? 1.2 : -0.8,
          asOf: '2026-06-09T01:00:00.000Z'
        })),
        successCount: codes.length,
        failureCount: 0,
        generatedAt: '2026-06-09T01:00:00.000Z'
      }
    });
  });

  await page.route('**/api/notify/switch/config**', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true, config: body, clientId: 'e2e-client' } });
    }
    return route.fulfill({ json: { ok: true, config: null } });
  });

  await page.route('**/api/notify/switch/snapshot**', async (route) => {
    await route.fulfill({ json: { ok: true, snapshot: null, config: null } });
  });

  await page.route('**/api/notify/switch/run**', async (route) => {
    await route.fulfill({ json: { ok: true, snapshot: null, summary: { triggered: 0, pushed: 0 } } });
  });
}

test('all nasdaq ETF chips can be classified by H and L click buttons', async ({ page }) => {
  await seedSwitchPage(page);
  await mockSwitchNetwork(page);
  await page.goto('./index.html?tab=fundSwitch');

  await expect(page.getByText('所有纳指 ETF（未分类）')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('将 159513 设为 H 组')).toBeVisible({ timeout: 20_000 });

  await page.getByLabel('将 159513 设为 H 组').click();
  await expect(page.getByText('高溢价组 H').locator('..').locator('..')).toContainText('159513');

  await page.getByLabel('将 159509 设为 L 组').click();
  await expect(page.getByText('低溢价组 L').locator('..').locator('..')).toContainText('159509');
});

test('classified ETF can be selected as a simulated benchmark when no holdings exist', async ({ page }) => {
  await seedSwitchPage(page, { withHolding: false });
  await mockSwitchNetwork(page);
  await page.goto('./index.html?tab=fundSwitch');

  await expect(page.getByText('所有纳指 ETF（未分类）')).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('将 159513 设为 H 组').click();
  await expect(page.getByText('高溢价组 H').locator('..').locator('..')).toContainText('159513');

  await page.getByLabel('将 159513 设为基准').click();
  await expect(page.getByText('高溢价组 H').locator('..').locator('..')).toContainText('基准');
  await expect(page.getByText(/模拟基准：159513/)).toBeVisible({ timeout: 10_000 });
});

test('classified unheld ETF can be selected as a rule benchmark when holdings exist', async ({ page }) => {
  await seedSwitchPage(page, { withHolding: true });
  await mockSwitchNetwork(page);
  await page.goto('./index.html?tab=fundSwitch');

  await expect(page.getByText('所有纳指 ETF（未分类）')).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('将 159513 设为 H 组').click();
  await expect(page.getByText('高溢价组 H').locator('..').locator('..')).toContainText('159513');

  await page.getByLabel('将 159513 设为基准').click();
  await expect(page.getByText('高溢价组 H').locator('..').locator('..')).toContainText('基准');
  await expect(page.getByText(/基准\/模拟基准：159513/)).toBeVisible({ timeout: 10_000 });
});
