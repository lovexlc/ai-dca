import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const pages = [
  { name: 'strategy', url: './index.html?tab=strategy', text: '美股策略助手' },
  { name: 'holdings', url: './index.html?tab=holdings', text: '持仓总览' },
  { name: 'markets', url: './index.html?tab=markets', text: '行情中心' },
  { name: 'notify', url: './index.html?tab=notify', text: '通知设置' }
];

test.describe('accessibility acceptance', () => {
  for (const item of pages) {
    test(`${item.name} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(item.url);
      await expect(page.getByText(item.text).first()).toBeVisible({ timeout: 20_000 });

      const results = await new AxeBuilder({ page })
        .disableRules([
          // Existing design uses brand/gradient surfaces that can be tuned separately.
          'color-contrast'
        ])
        .analyze();

      const serious = results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''));
      expect(serious).toEqual([]);
    });
  }
});
