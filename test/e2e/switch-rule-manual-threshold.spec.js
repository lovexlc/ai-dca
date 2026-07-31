import { expect, test } from '@playwright/test';

const MANUAL_RECOMMENDATION = {
  recommendationId: 'rec-manual-threshold',
  holdingFundCode: '513100',
  holdingFundName: '国泰纳斯达克100ETF',
  holdingQuantity: 1000,
  holdingNotional: 1200,
  candidateFundCodes: ['159632'],
  recommendedCandidate: {
    code: '159632',
    name: '纳指 ETF 159632',
    currentAdvantagePct: 2.1,
    switchable: true
  },
  highPremiumCodes: ['513100'],
  premiumClassSource: 'user',
  premiumClass: { 513100: 'H', 159632: 'L' },
  holdingSide: 'high',
  triggerOperator: 'gte',
  thresholdValue: 3,
  intraSellLowerPct: 1,
  intraBuyOtherPct: 3,
  classifiedAt: '2026-07-30T01:00:00.000Z',
  classificationStatus: 'fresh',
  classificationSource: 'worker-backtest',
  feeConfig: {
    mode: 'estimated_total',
    estimatedTotalFee: 20,
    sellCommissionRate: 0,
    buyCommissionRate: 0,
    minimumCommission: 0,
    otherFee: 0
  },
  backtest: {
    status: 'passed',
    selectionStatus: 'optimized',
    selectionReason: 'e2e',
    timeframe: '5m',
    triggerCount: 2,
    cycleCount: 1,
    winRatePct: 100,
    annualizedReturnPct: 4,
    totalReturnPct: 4,
    holdingReturnPct: 1,
    totalReturnImprovementPct: 3,
    maxDrawdownPct: -2,
    comparison: [],
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3,
    klineCoverage: { months: 12, from: '2025-07-01', to: '2026-07-30' }
  },
  candidatesResult: []
};

async function mockSwitchPage(page) {
  await page.addInitScript(() => {
    window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
    window.localStorage.clear();
    window.localStorage.setItem('aiDcaFundHoldingsLedger', JSON.stringify({
      source: 'react-fund-holdings-ledger',
      version: 2,
      transactions: [{
        id: 'tx-held-513100',
        code: '513100',
        name: '国泰纳斯达克100ETF',
        kind: 'exchange',
        type: 'BUY',
        date: '2026-05-01',
        price: 1.2,
        shares: 1000,
        note: ''
      }],
      snapshotsByCode: {},
      lastNavMeta: { status: 'idle', updatedAt: '', successCount: 0, failureCount: 0, errors: [] },
      switchChains: []
    }));
  });

  await page.route('**/api/notify/switch/config**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: { ok: true, config: route.request().postDataJSON(), clientId: 'e2e-client' } });
      return;
    }
    await route.fulfill({
      json: {
        ok: true,
        config: {
          enabled: false,
          activeRuleId: 'rule-1',
          rules: [{ id: 'rule-1', name: '默认规则', enabled: false, benchmarkCodes: [], enabledCodes: [] }]
        }
      }
    });
  });
  await page.route('**/api/notify/switch/snapshot**', async (route) => {
    await route.fulfill({ json: { ok: true, snapshot: null, config: null } });
  });
  await page.route('**/api/notify/switch/runs/latest**', async (route) => {
    await route.fulfill({ json: { ok: true, run: null, notificationStatus: 'disabled' } });
  });
  await page.route('**/api/notify/switch/recommend**', async (route) => {
    await route.fulfill({ json: { ok: true, cached: false, recommendation: MANUAL_RECOMMENDATION } });
  });
  await page.route('**/api/notify/switch/run**', async (route) => {
    await route.fulfill({ json: { ok: true, snapshot: null, summary: { triggered: 0, pushed: 0 } } });
  });
}

test('new switch plan saves a manually configured two-way threshold pair', async ({ page }) => {
  await mockSwitchPage(page);
  await page.goto('./index.html?tab=fundSwitch');

  await page.getByRole('button', { name: /添加新的切换方案/ }).click();
  await page.getByRole('button', { name: /下一步/ }).click();
  await expect(page.getByRole('button', { name: '自动推荐', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '手动配置', exact: true }).click();

  await page.getByLabel('H→L 切出阈值').fill('2.5');
  await page.getByLabel('L→H 切回阈值').fill('0.75');
  await expect(page.getByRole('button', { name: /匹配候选并使用手动阈值/ })).toBeEnabled();
  await page.getByRole('button', { name: /匹配候选并使用手动阈值/ }).click();

  await expect(page.getByRole('heading', { name: '已生成手动配置' })).toBeVisible();
  await expect(page.getByText('手动阈值：H→L 2.50% · L→H 0.75%')).toBeVisible();

  const saveRequestPromise = page.waitForRequest(
    (request) => request.url().includes('/api/notify/switch/config') && request.method() === 'POST'
  );
  await page.getByRole('button', { name: '使用手动配置', exact: true }).click();
  const saveRequest = await saveRequestPromise;
  const body = saveRequest.postDataJSON();
  const savedRule = body.rules.find((rule) => rule.holdingFundCode === '513100');

  expect(savedRule.thresholdMode).toBe('fixed');
  expect(savedRule.thresholdSource).toBe('manual');
  expect(savedRule.thresholdValue).toBe(2.5);
  expect(savedRule.runtimeConfig.intraBuyOtherPct).toBe(2.5);
  expect(savedRule.runtimeConfig.intraSellLowerPct).toBe(0.75);
});
