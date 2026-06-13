import { expect, test } from '@playwright/test';

async function closeStartupModals(page) {
  await page.getByRole('button', { name: '知道了' }).click({ timeout: 3000 }).catch(() => {});
  await page.getByRole('button', { name: '关闭' }).click({ timeout: 3000 }).catch(() => {});
}

async function seedSession(page, username = 'lovexl') {
  await page.addInitScript((sessionUsername) => {
    localStorage.setItem('aiDcaCloudSyncSession', JSON.stringify({
      username: sessionUsername,
      userId: `test-${sessionUsername}`,
      accessToken: 'test-token'
    }));
    if (!sessionStorage.getItem('scenarioSwitchTestSeeded')) {
      localStorage.removeItem('aiDcaWorkspacePrefs');
      sessionStorage.setItem('scenarioSwitchTestSeeded', '1');
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
    await expect(page.getByRole('menuitemcheckbox')).toHaveCount(2);
    await expect(page.getByRole('menuitemcheckbox', { name: /持仓交易/ })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: /量化研究/ })).toBeVisible();
  });

  test('switches to the quant scenario and shows quant modules in the sidebar', async ({ page }) => {
    await openScenarioMenu(page);
    await page.getByRole('menuitemcheckbox', { name: /量化研究/ }).click();

    await expect(page.getByRole('button', { name: '切换使用场景' })).toContainText('量化研究');
    await expect(page.locator('nav a', { hasText: '综合仪表盘' })).toBeVisible();
    await expect(page.locator('nav a', { hasText: '行情与数据' })).toBeVisible();
    await expect(page.locator('nav a', { hasText: '策略研究' })).toBeVisible();
    await expect(page.locator('nav a', { hasText: '交易计划' })).toHaveCount(0);

    await page.reload();
    await closeStartupModals(page);

    await expect(page.getByRole('button', { name: '切换使用场景' })).toContainText('量化研究');
    await expect(page.locator('nav a', { hasText: '综合仪表盘' })).toBeVisible();
  });

  test('keeps holdings and trade plans inside the holding scenario', async ({ page }) => {
    await expect(page.getByRole('button', { name: '切换使用场景' })).toContainText('持仓交易');
    await expect(page.locator('nav a', { hasText: '持仓总览' })).toBeVisible();
    await expect(page.locator('nav a', { hasText: '交易计划' })).toBeVisible();
    await expect(page.locator('nav a', { hasText: '综合仪表盘' })).toHaveCount(0);
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
    await expect(page.locator('nav a', { hasText: '综合仪表盘' })).toHaveCount(0);
  });
});
