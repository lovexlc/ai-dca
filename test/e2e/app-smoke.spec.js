import { expect, test } from '@playwright/test';
import {
  MOBILE_VIEWPORT,
  ensureNotifyConfigExpanded,
  expectNoCrash,
  expectNoHorizontalOverflow,
  mockAcceptanceNetwork,
  openMarketsCnEtfDetail,
  selectChartRange,
  selectCnFundMetric,
  visibleChart,
  waitForWorkspace
} from './acceptance-helpers.js';

test.describe('workspace smoke', () => {
  test.beforeEach(async ({ page }) => {
    await mockAcceptanceNetwork(page);
  });

  test('markets CN ETF detail renders nav and premium charts', async ({ page }) => {
    await openMarketsCnEtfDetail(page);

    await selectChartRange(page, '5 天');
    await page.getByRole('tab', { name: '自定义' }).click();
    await expect(page.getByText('自定义区间', { exact: true })).toBeVisible();
    await page.locator('input[type="date"]').nth(0).fill('2026-05-02');
    await page.locator('input[type="date"]').nth(1).fill('2026-05-20');
    await page.getByRole('button', { name: '应用自定义区间' }).click();
    await expect(page.getByRole('tab', { name: '自定义' })).toHaveAttribute('aria-selected', 'true');
    await expect(visibleChart(page)).toBeVisible({ timeout: 10_000 });

    await selectCnFundMetric(page, 'nav');

    await selectCnFundMetric(page, 'premium');
    await expect(page.locator('body')).toContainText(/溢价|溢价差/, { timeout: 10_000 });
    await expectNoCrash(page);
  });

  test('markets fund search results stay inside content area', async ({ page }) => {
    await page.goto('./index.html?tab=markets');
    await waitForWorkspace(page, '行情中心');

    await page.getByRole('button', { name: /基金搜索/ }).first().click();
    await page.getByPlaceholder(/搜索基金代码/).first().fill('513100');
    await expect(page.getByRole('button', { name: /加入自选|已加入/ }).first()).toBeVisible({ timeout: 10_000 });

    const geometry = await page.evaluate(() => {
      const actionButton = [...document.querySelectorAll('button')]
        .find((button) => /加入自选|已加入/.test(button.textContent || ''));
      const panel = actionButton?.closest('div[class*="rounded-2xl"]');
      const sidebar = document.querySelector('.console-sidebar')
        || document.querySelector('[aria-label="模块导航"]')?.closest('aside,div');
      const rectOf = (element) => {
        const rect = element?.getBoundingClientRect?.();
        return rect ? { left: rect.left, right: rect.right } : null;
      };
      return {
        panel: rectOf(panel),
        sidebar: rectOf(sidebar),
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(geometry.panel?.left ?? 0).toBeGreaterThanOrEqual((geometry.sidebar?.right ?? 0) - 1);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  });

  test('holdings page does not crash and opens new transaction panel', async ({ page }) => {
    await page.goto('./index.html?tab=holdings');

    await waitForWorkspace(page, '持仓总览');
    await expect(page.locator('body')).toContainText(/持仓|基金|收益|暂无/);
    await page.getByRole('button', { name: /录入第一笔交易|录入交易流水|新增单笔/ }).filter({ visible: true }).first().click();
    await expect(page.getByRole('dialog').filter({ hasText: '新增交易' })).toBeVisible({ timeout: 10_000 });
    await expectNoCrash(page);
  });

  test('strategy guide supports strategyGuide link fallback, guide jump, and mobile overflow guard', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('./index.html?tab=strategyGuide');

    await waitForWorkspace(page, '策略指南');
    await expect(page.getByText('策略指南').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button').filter({ hasText: '金字塔加仓法' }).first().click();
    await expect(page.getByRole('dialog').filter({ hasText: '只买不卖' })).toBeVisible({ timeout: 10_000 });
    await expectNoCrash(page);
  });

  test('notify config tabs accept pasted iOS and ServerChan settings', async ({ page }) => {
    await page.goto('./index.html?tab=notify');

    await waitForWorkspace(page, '消息推送配置');
    await ensureNotifyConfigExpanded(page);

    await page.getByRole('tab', { name: /^Andriod$/ }).click();
    await expect(page.getByRole('tab', { name: /^Andriod$/ })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: /查看「安卓：下载哪个 & 怎么配置」使用帮助/ }).click();
    const serverChan3TipDialog = page.getByRole('dialog', { name: '安卓：下载哪个 & 怎么配置' });
    await expect(serverChan3TipDialog).toBeVisible();
    await expect(serverChan3TipDialog.getByRole('img', { name: /Server酱³ 示例/ })).toHaveAttribute(
      'src',
      'https://img.remit.ee/api/file/BQACAgUAAyEGAASHRsPbAAEVDnpqInOCSSCH6N6JmuEmQYx9pQYIFAAC4CMAAuKuEFX0k_jBmJTJgDsE.jpg'
    );
    await page.keyboard.press('Escape');
    await expect(serverChan3TipDialog).toBeHidden();
    await expect(page.locator('body')).toContainText('安卓端使用 Server酱³ 时，先打开客户端下载地址安装客户端');
    await expect(page.getByRole('link', { name: /安卓客户端下载地址/ })).toHaveAttribute('href', 'https://sc3.ft07.com/client');
    await expect(page.getByRole('link', { name: /安卓配置设置地址/ })).toHaveAttribute('href', 'https://sc3.ft07.com/sendkey');
    await expect(page.locator('body')).toContainText('不要随意泄漏 UID 或 SendKey');
    const serverChanTestButton = page.getByRole('button', { name: '消息推送测试' });
    await expect(serverChanTestButton).toBeDisabled();
    const serverChanUidInput = page.getByLabel('Server酱³ UID');
    const serverChanSendKeyInput = page.getByLabel('Server酱³ SendKey');
    await serverChanUidInput.fill('uid-e2e-smoke');
    await serverChanSendKeyInput.fill('sendkey-e2e-smoke-123456');
    await expect(serverChanUidInput).toHaveValue('uid-e2e-smoke');
    await expect(serverChanSendKeyInput).toHaveValue('sendkey-e2e-smoke-123456');
    await expect(serverChanTestButton).toBeEnabled();

    await page.getByRole('tab', { name: /^iOS$/ }).click();
    await expect(page.getByRole('tab', { name: /^iOS$/ })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: /查看「iOS：配置 Bark 推送」使用帮助/ }).click();
    const barkTipDialog = page.getByRole('dialog', { name: 'iOS：配置 Bark 推送' });
    await expect(barkTipDialog).toBeVisible();
    await expect(barkTipDialog.getByRole('img', { name: /Bark 示例/ })).toHaveAttribute('src', 'https://bark.day.app/_media/example.jpg');
    await page.keyboard.press('Escape');
    await expect(barkTipDialog).toBeHidden();
    const iosTestButton = page.getByRole('button', { name: '消息推送测试' });
    await expect(iosTestButton).toBeDisabled();
    const iosInput = page.getByLabel('Bark 链接或 Device Key');
    await iosInput.fill('https://api.day.app/e2e-device-key/Smoke');
    await expect(iosInput).toHaveValue(/api\.day\.app|e2e-device-key/);
    await expect(iosTestButton).toBeEnabled();
    await expectNoCrash(page);
  });

  test('account menu opens login dialog and shows status copy', async ({ page }) => {
    await page.goto('./index.html?tab=strategy');

    await waitForWorkspace(page, '策略章节');
    await page.getByRole('button', { name: /登录账户/ }).filter({ visible: true }).click();
    await expect(page.getByRole('dialog').filter({ hasText: /账户登录|注册账户|状态|未登录/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('body')).toContainText(/账户登录|登录|状态|未登录/);
    await expectNoCrash(page);
  });
});
