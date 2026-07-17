import { expect, test } from '@playwright/test';

async function closeStartupModals(page) {
  await page.getByRole('button', { name: '知道了' }).click({ timeout: 3000 }).catch(() => {});
  await page.getByRole('button', { name: '关闭' }).click({ timeout: 3000 }).catch(() => {});
}

async function seedSession(page, username = 'lovexl') {
  await page.addInitScript((sessionUsername) => {
    globalThis.localStorage.setItem('aiDcaCloudSyncSession', JSON.stringify({
      username: sessionUsername,
      userId: `test-${sessionUsername}`,
      accessToken: 'test-token'
    }));
    if (!globalThis.sessionStorage.getItem('scenarioSwitchTestSeeded')) {
      globalThis.localStorage.removeItem('aiDcaWorkspacePrefs');
      globalThis.sessionStorage.setItem('scenarioSwitchTestSeeded', '1');
    }
  }, username);
}

async function openScenarioMenu(page) {
  await page.getByRole('button', { name: '切换使用场景' }).click();
  await expect(page.locator('[data-slot="dropdown-menu-content"]')).toBeVisible();
}

test.describe('scenario switcher', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await page.goto('/');
    await closeStartupModals(page);
  });

  test('renders the current scenario in the top bar', async ({ page }) => {
    await expect(page.getByRole('button', { name: '切换使用场景' })).toContainText('持仓交易');
    await openScenarioMenu(page);
    await expect(page.getByRole('menuitemcheckbox')).toHaveCount(1);
    await expect(page.getByRole('menuitemcheckbox', { name: /持仓交易/ })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: /量化研究/ })).toHaveCount(0);
  });

  test('removed quant links fall back to holdings', async ({ page }) => {
    await page.goto('/?tab=quant&module=backtest');
    await closeStartupModals(page);

    await expect(page.getByRole('button', { name: '切换使用场景' })).toContainText('持仓交易');
    await expect(page.locator('nav a', { hasText: '策略' })).toHaveCount(0);
    await expect(page.locator('nav a', { hasText: '回测' })).toHaveCount(0);
    await expect(page.locator('nav a', { hasText: '实盘' })).toHaveCount(0);
    await expect(page.locator('nav a', { hasText: '量化研究' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '量化研究', level: 1 })).toHaveCount(0);
    await expect(page).toHaveURL(/\/(?:index\.html)?(?:\?tab=holdings)?$/);
    await expect(page.locator('body')).toContainText('持仓总览');
    await expect(page.getByRole('heading', { name: '暂无交易记录', level: 3 })).toBeVisible();
  });

  test('keeps holdings and trade plans inside the holding scenario', async ({ page }) => {
    await expect(page.getByRole('button', { name: '切换使用场景' })).toContainText('持仓交易');
    await expect(page.locator('nav a', { hasText: '持仓总览' })).toBeVisible();
    await expect(page.locator('nav a', { hasText: '交易计划' })).toBeVisible();
    await expect(page.locator('a[href*="adminData"]')).toBeVisible();
    await expect(page.locator('a[href*="cloudData"]')).toBeVisible();
    await expect(page.locator('nav a', { hasText: '量化研究' })).toHaveCount(0);
  });
});

test.describe('scenario permissions', () => {
  test('hides the quant scenario from non-admin users', async ({ page }) => {
    await seedSession(page, 'normaluser');
    await page.goto('/');
    await closeStartupModals(page);

    await openScenarioMenu(page);

    await expect(page.getByRole('menuitemcheckbox')).toHaveCount(1);
    await expect(page.getByRole('menuitemcheckbox', { name: /持仓交易/ })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: /量化研究/ })).toHaveCount(0);
    await expect(page.locator('nav a', { hasText: '量化研究' })).toHaveCount(0);
    await expect(page.locator('a[href*="adminData"]')).toHaveCount(0);
    await expect(page.locator('a[href*="cloudData"]')).toHaveCount(0);
  });
});
