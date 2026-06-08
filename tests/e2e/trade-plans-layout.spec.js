import { expect, test } from '@playwright/test';
import { MOBILE_VIEWPORT, expectNoHorizontalOverflow, mockAcceptanceNetwork, waitForWorkspace } from './acceptance-helpers.js';

const LONG_PLAN = {
  source: 'react-plan',
  version: 2,
  id: 'trade-plan-layout-long-513100',
  name: '513100 · 国泰纳斯达克100ETF 6档固定回撤 (首-10% 步-5%)',
  symbol: '513100',
  totalBudget: 24000,
  cashReservePct: 0,
  basePrice: 2.266,
  riskControlPrice: 1.7,
  selectedStrategy: 'peak-drawdown',
  isConfigured: true,
  frequency: '每周',
  layerWeights: [10, 12, 15, 18, 20, 25],
  triggerDrops: [10, 15, 20, 25, 30, 35],
  assetType: 'index',
  strategyParams: {
    customDrawdown: {
      enabled: true,
      levels: 6,
      firstDrop: 10,
      stepDrop: 5
    }
  },
  investableCapital: 24000,
  reserveCapital: 0,
  averageCost: 1.688,
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:00.000Z'
};

async function seedLongTradePlan(page) {
  await page.addInitScript((plan) => {
    window.localStorage.clear();
    const store = {
      source: 'react-plan-store',
      version: 1,
      activePlanId: plan.id,
      plans: [plan]
    };
    window.localStorage.setItem('aiDcaPlanStore', JSON.stringify(store));
    window.localStorage.setItem('aiDcaPlanState', JSON.stringify(plan));
  }, LONG_PLAN);
}

test.describe('trade plans layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockAcceptanceNetwork(page);
  });

  test('long plan content stays inside mobile viewport', async ({ page }) => {
    await seedLongTradePlan(page);
    await page.goto('./index.html?tab=tradePlans');
    await waitForWorkspace(page, '交易计划');

    await expect(page.getByRole('tab', { name: /全部 · 1/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('513100 国泰纳斯达克100ETF 6档固定回撤 (首-10% 步-5%)')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: '展开层级' }).click();
    await expect(page.getByText('当前监控', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
