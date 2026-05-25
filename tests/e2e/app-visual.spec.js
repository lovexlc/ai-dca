import { expect, test } from '@playwright/test';
import {
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  ensureNotifyConfigExpanded,
  mockAcceptanceNetwork,
  openMarketsCnEtfDetail,
  selectCnFundMetric,
  waitForWorkspace
} from './acceptance-helpers.js';

function screenshotPath(name) {
  return `test-results/screenshots/${name}-${test.info().project.name}.png`;
}

async function setAcceptanceViewport(page) {
  const isMobile = test.info().project.name.includes('mobile');
  await page.setViewportSize(isMobile ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT);
}

test.describe('visual acceptance', () => {
  test.beforeEach(async ({ page }) => {
    await setAcceptanceViewport(page);
    await mockAcceptanceNetwork(page);
  });

  test('markets CN ETF detail screenshot', async ({ page }) => {
    await openMarketsCnEtfDetail(page);
    await page.getByRole('button', { name: '5天' }).click();
    await selectCnFundMetric(page, 'nav');
    await page.screenshot({ path: screenshotPath('markets-cn-etf-detail'), fullPage: true });
  });

  test('markets CN fund metric state screenshot', async ({ page }) => {
    await openMarketsCnEtfDetail(page);
    await page.getByRole('button', { name: '5天' }).click();
    await selectCnFundMetric(page, 'premium');
    await expect(page.getByText('估算溢价').first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: screenshotPath('markets-cn-fund-param-premium'), fullPage: true });
  });

  test('holdings screenshot', async ({ page }) => {
    await page.goto('./index.html?tab=holdings');
    await waitForWorkspace(page, '持仓总览');
    await page.screenshot({ path: screenshotPath('holdings'), fullPage: true });
  });

  test('strategy guide screenshot', async ({ page }) => {
    await page.goto('./index.html?tab=strategyGuide');
    await waitForWorkspace(page, '美股策略助手');
    await page.screenshot({ path: screenshotPath('strategy-guide'), fullPage: true });
  });

  test('notify config screenshot', async ({ page }) => {
    await page.goto('./index.html?tab=notify');
    await waitForWorkspace(page, '通知设置');
    await ensureNotifyConfigExpanded(page);
    await page.getByRole('tab', { name: 'Android' }).click();
    await page.screenshot({ path: screenshotPath('notify-config'), fullPage: true });
  });
});
