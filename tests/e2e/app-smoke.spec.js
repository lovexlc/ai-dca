import { expect, test } from '@playwright/test';

async function waitForWorkspace(page, label) {
  await expect(page.getByText(label).first()).toBeVisible({ timeout: 20_000 });
}

test.describe('workspace smoke', () => {
  test('loads strategy guide and primary tabs', async ({ page }) => {
    await page.goto('./index.html?tab=strategy');

    await waitForWorkspace(page, '美股策略助手');
    await expect(page.getByText('策略指南').first()).toBeVisible();
    await expect(page.getByText('持仓总览').first()).toBeVisible();
    await expect(page.getByText('交易计划').first()).toBeVisible();
    await expect(page.getByText('行情中心').first()).toBeVisible();
    await expect(page.getByText('通知').first()).toBeVisible();
  });

  test('loads holdings tab without a blank screen', async ({ page }) => {
    await page.goto('./index.html?tab=holdings');

    await waitForWorkspace(page, '持仓总览');
    await expect(page.locator('body')).toContainText(/持仓|基金|收益|暂无/);
    await expect(page.locator('main, body')).not.toContainText('Cannot access');
  });

  test('loads markets tab and keeps CN ETF nav selector usable', async ({ page }) => {
    await page.goto('./index.html?tab=markets');

    await waitForWorkspace(page, '行情中心');
    await expect(page.getByText('美股').first()).toBeVisible();
    await expect(page.getByText(/A\s*股/).first()).toBeVisible();

    const cnTab = page.getByRole('button', { name: /A\s*股/ }).first();
    if (await cnTab.isVisible().catch(() => false)) {
      await cnTab.click();
    } else {
      await page.getByText(/A\s*股/).first().click();
    }

    await expect(page.getByText(/513100|纳指\s*ETF|搜索 A股|搜索 ETF/).first()).toBeVisible({ timeout: 20_000 });

    const paramSelect = page.getByLabel('A股基金图表参数').first();
    if (await paramSelect.isVisible().catch(() => false)) {
      await paramSelect.selectOption('nav');
      await expect(paramSelect).toHaveValue('nav');
      await expect(page.locator('body')).not.toContainText('Cannot access');
    }
  });

  test('loads notify tab without requiring push credentials', async ({ page }) => {
    await page.goto('./index.html?tab=notify');

    await waitForWorkspace(page, '通知设置');
    await expect(page.getByText(/通知接入|iOS|Android|PC 浏览器通知/).first()).toBeVisible({ timeout: 20_000 });
  });
});
