import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true });

test('full-screen market list closes an open mobile navigation drawer', async ({ page }) => {
  await page.addInitScript(() => {
    window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
    window.localStorage.clear();
  });
  await page.goto('./index.html?tab=markets');
  await page.getByTestId('app-header').waitFor({ state: 'attached' });
  await expect(page.locator('.app-header__brand')).toContainText('美股策略助手');
  const headerGeometry = await page.locator('[data-testid="app-header"]').evaluate((element) => {
    const brand = element.querySelector('.app-header__brand')?.getBoundingClientRect();
    const menu = element.querySelector('.app-header__menu-button')?.getBoundingClientRect();
    return { brandRight: brand?.right || 0, menuLeft: menu?.left || 0 };
  });
  expect(headerGeometry.menuLeft).toBeGreaterThan(headerGeometry.brandRight);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('console:open-mobile-nav')));
  await expect(page.locator('[role="dialog"][aria-label="移动端导航"]')).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('console:close-mobile-nav')));
  await expect(page.locator('[role="dialog"][aria-label="移动端导航"]')).toHaveCount(0);
});

test('mobile bottom navigation exposes five workspace tabs and top-right reminders', async ({ page }) => {
  await page.addInitScript(() => {
    window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
    window.localStorage.clear();
  });
  await page.goto('./index.html?tab=holdings');

  const bottomNav = page.getByTestId('mobile-bottom-nav');
  await expect(bottomNav).toBeVisible();
  await expect(bottomNav.getByRole('button')).toHaveText(['首页', '行情', '持仓', '计划', '换基']);

  const reminderButton = page.getByRole('button', { name: '提醒' });
  await expect(reminderButton).toBeVisible();
  await reminderButton.click();
  await expect(page.getByText('通知记录', { exact: true })).toBeVisible();

  await bottomNav.getByRole('button', { name: '首页' }).click();
  await expect(page).toHaveURL(/\/index\.html(?:\?.*)?$/);
});

test('mobile system dark mode uses the semantic dark surface tokens', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./index.html?tab=holdings');
  await page.getByTestId('app-header').waitFor({ state: 'attached' });

  const theme = await page.evaluate(() => ({
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
  }));
  expect(theme.bodyBackground).toBe('rgb(0, 0, 0)');
  expect(theme.colorScheme).toContain('dark');
  expect(theme.brand).toBe('#75d99c');
});
