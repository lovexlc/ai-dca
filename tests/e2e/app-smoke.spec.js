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
    await page.getByRole('button', { name: '查看 Server酱³ 配置示例图' }).click();
    const serverChan3TipDialog = page.getByRole('dialog', { name: 'Server酱³ 配置示例图' });
    await expect(serverChan3TipDialog).toBeVisible();
    await expect(serverChan3TipDialog.getByRole('img', { name: /Server酱³ 示例/ })).toHaveAttribute(
      'src',
      'https://img.remit.ee/api/file/BQACAgUAAyEGAASHRsPbAAEVDnpqInOCSSCH6N6JmuEmQYx9pQYIFAAC4CMAAuKuEFX0k_jBmJTJgDsE.jpg'
    );
    await serverChan3TipDialog.getByRole('button', { name: '关闭 Server酱³ 示例图' }).click();
    await expect(serverChan3TipDialog).toBeHidden();
    await expect(page.locator('body')).toContainText('安卓端使用 Server酱³ 时，先打开客户端下载地址安装客户端');
    await expect(page.getByRole('link', { name: /安卓客户端下载地址/ })).toHaveAttribute('href', 'https://sc3.ft07.com/client');
    await expect(page.getByRole('link', { name: /安卓配置设置地址/ })).toHaveAttribute('href', 'https://sc3.ft07.com/sendkey');
    await expect(page.locator('body')).toContainText('不要随意泄漏 UID 或 SendKey');
    const serverChanUidInput = page.getByLabel('Server酱³ UID');
    const serverChanSendKeyInput = page.getByLabel('Server酱³ SendKey');
    await serverChanUidInput.fill('uid-e2e-smoke');
    await serverChanSendKeyInput.fill('sendkey-e2e-smoke-123456');
    await expect(serverChanUidInput).toHaveValue('uid-e2e-smoke');
    await expect(serverChanSendKeyInput).toHaveValue('sendkey-e2e-smoke-123456');

    await page.getByRole('tab', { name: /^iOS$/ }).click();
    await expect(page.getByRole('tab', { name: /^iOS$/ })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: '查看 iOS Bark 链接示例图' }).click();
    const barkTipDialog = page.getByRole('dialog', { name: 'iOS Bark 链接示例图' });
    await expect(barkTipDialog).toBeVisible();
    await expect(barkTipDialog.getByRole('img', { name: /Bark 示例/ })).toHaveAttribute('src', 'https://bark.day.app/_media/example.jpg');
    await barkTipDialog.getByRole('button', { name: '关闭 Bark 示例图' }).click();
    await expect(barkTipDialog).toBeHidden();
    const iosInput = page.getByLabel('Bark 链接或 Device Key');
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
