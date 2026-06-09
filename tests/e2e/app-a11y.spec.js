import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ensureNotifyConfigExpanded,
  mockAcceptanceNetwork,
  openMarketsCnEtfDetail,
  selectChartRange,
  selectCnFundMetric,
  waitForWorkspace
} from './acceptance-helpers.js';

const pages = [
  { name: 'strategy-guide', url: './index.html?tab=strategyGuide', text: '策略指南' },
  { name: 'holdings', url: './index.html?tab=holdings', text: '持仓总览' },
  { name: 'markets', url: './index.html?tab=markets', text: '行情中心' },
  { name: 'notify', url: './index.html?tab=notify', text: '消息推送配置' }
];

async function expectNoSeriousA11yViolations(page) {
  const results = await new AxeBuilder({ page })
    .disableRules([
      // Existing design uses brand/gradient surfaces that can be tuned separately.
      'color-contrast'
    ])
    .analyze();

  const serious = results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''));
  expect(serious).toEqual([]);
}

test.describe('accessibility acceptance', () => {
  test.beforeEach(async ({ page }) => {
    await mockAcceptanceNetwork(page);
  });

  for (const item of pages) {
    test(`${item.name} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(item.url, { waitUntil: 'domcontentloaded' });
      await waitForWorkspace(page, item.text);

      if (item.name === 'markets') {
        await openMarketsCnEtfDetail(page);
        await selectChartRange(page, '5 天');
        await selectCnFundMetric(page, 'nav');
      }

      if (item.name === 'notify') {
        await ensureNotifyConfigExpanded(page);
      }

      await expectNoSeriousA11yViolations(page);
    });
  }

  test('account login dialog has no serious accessibility violations', async ({ page }) => {
    await page.goto('./index.html?tab=strategy', { waitUntil: 'domcontentloaded' });
    await waitForWorkspace(page, '美股策略助手');
    await page.getByRole('button', { name: /登录账户|账户：/ }).click();
    await expect(page.getByRole('dialog').filter({ hasText: /账户登录|注册账户|状态|未登录/ })).toBeVisible({ timeout: 10_000 });
    await expectNoSeriousA11yViolations(page);
  });
});
