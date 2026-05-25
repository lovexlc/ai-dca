import { expect, test } from '@playwright/test';
import {
  MOBILE_VIEWPORT,
  ensureNotifyConfigExpanded,
  expectNoCrash,
  expectNoHorizontalOverflow,
  mockAcceptanceNetwork,
  openMarketsCnEtfDetail,
  selectCnFundMetric,
  waitForWorkspace
} from './acceptance-helpers.js';

test.describe('workspace smoke', () => {
  test.beforeEach(async ({ page }) => {
    await mockAcceptanceNetwork(page);
  });

  test('markets CN ETF detail renders nav and premium charts', async ({ page }) => {
    await openMarketsCnEtfDetail(page);

    await page.getByRole('button', { name: '5天' }).click();
    await selectCnFundMetric(page, 'nav');

    await selectCnFundMetric(page, 'premium');
    await expect(page.getByText('估算溢价').first()).toBeVisible({ timeout: 10_000 });
    await expectNoCrash(page);
  });

  test('holdings page does not crash and opens new transaction panel', async ({ page }) => {
    await page.goto('./index.html?tab=holdings');

    await waitForWorkspace(page, '持仓总览');
    await expect(page.locator('body')).toContainText(/持仓|基金|收益|暂无/);
    await page.getByText(/录入第一笔交易|录入交易流水|新增单笔/).first().click();
    await expect(page.getByRole('dialog').filter({ hasText: '新增交易' })).toBeVisible({ timeout: 10_000 });
    await expectNoCrash(page);
  });

  test('strategy guide supports strategyGuide link fallback, guide jump, and mobile overflow guard', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('./index.html?tab=strategyGuide');

    await waitForWorkspace(page, '美股策略助手');
    await expect(page.getByText('策略指南').first()).toBeVisible();
    await page.getByText(/金字塔加仓法|个股投资策略|操作纪律/).first().click();
    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 10_000 });
    await expectNoHorizontalOverflow(page);
    await expectNoCrash(page);
  });

  test('notify config tabs accept pasted iOS and Android links', async ({ page }) => {
    await page.goto('./index.html?tab=notify');

    await waitForWorkspace(page, '通知设置');
    await ensureNotifyConfigExpanded(page);

    await page.getByRole('tab', { name: 'Android' }).click();
    const androidInput = page.getByPlaceholder(/android-|完整测试 URL/).first();
    await androidInput.fill('https://example.com/test?device=android-e2e-smoke-123456');
    await expect(androidInput).toHaveValue(/android-e2e-smoke-123456|example\.com/);

    await page.getByRole('tab', { name: 'iOS' }).click();
    const iosInput = page.locator('input').last();
    await iosInput.fill('https://api.day.app/e2e-device-key/Smoke');
    await expect(iosInput).toHaveValue(/api\.day\.app|e2e-device-key/);
    await expectNoCrash(page);
  });

  test('account menu opens login dialog and shows status copy', async ({ page }) => {
    await page.goto('./index.html?tab=strategy');

    await waitForWorkspace(page, '美股策略助手');
    await page.getByRole('button', { name: /登录账户|账户：/ }).click();
    await expect(page.getByRole('dialog').filter({ hasText: /账户登录|注册账户|状态|未登录/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('body')).toContainText(/账户登录|登录|状态|未登录/);
    await expectNoCrash(page);
  });
});
