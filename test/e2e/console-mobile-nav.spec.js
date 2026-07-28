import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true });

test('full-screen market list closes an open mobile navigation drawer', async ({ page }) => {
  await page.addInitScript(() => {
    window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
    window.localStorage.clear();
  });
  await page.goto('./index.html?tab=markets');
  await page.getByTestId('app-header').waitFor({ state: 'attached' });

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('console:open-mobile-nav')));
  await expect(page.locator('[role="dialog"][aria-label="移动端导航"]')).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('console:close-mobile-nav')));
  await expect(page.locator('[role="dialog"][aria-label="移动端导航"]')).toHaveCount(0);
});
