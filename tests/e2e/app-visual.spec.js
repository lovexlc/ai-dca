import { expect, test } from '@playwright/test';

const visualPages = [
  { name: 'strategy', url: './index.html?tab=strategy', text: '美股策略助手' },
  { name: 'markets', url: './index.html?tab=markets', text: '行情中心' },
  { name: 'notify', url: './index.html?tab=notify', text: '通知设置' }
];

test.describe('visual acceptance', () => {
  for (const item of visualPages) {
    test(`${item.name} screenshot`, async ({ page }) => {
      await page.goto(item.url);
      await expect(page.getByText(item.text).first()).toBeVisible({ timeout: 20_000 });
      await page.screenshot({ path: `test-results/screenshots/${item.name}-${test.info().project.name}.png`, fullPage: true });
    });
  }
});
