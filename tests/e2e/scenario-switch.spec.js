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
    await expect(page.getByRole('button', { name: '切换使用场景' })).toContainText('美股交易');
    await openScenarioMenu(page);
    await expect(page.getByRole('menuitemcheckbox')).toHaveCount(2);
    await expect(page.getByRole('menuitemcheckbox', { name: /美股交易/ })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: /基金定投/ })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: /量化研究/ })).toHaveCount(0);
  });

  test('switches to the fund scenario and persists it', async ({ page }) => {
    await openScenarioMenu(page);
    await page.getByRole('menuitemcheckbox', { name: /基金定投/ }).click();

    await expect(page.getByRole('button', { name: '切换使用场景' })).toContainText('基金定投');
    await expect(page.locator('nav a', { hasText: '基金切换' })).toBeVisible();
    await expect(page.locator('nav a', { hasText: '策略指南' })).toHaveCount(0);

    await page.reload();
    await closeStartupModals(page);

    await expect(page.getByRole('button', { name: '切换使用场景' })).toContainText('基金定投');
    await expect(page.locator('nav a', { hasText: '基金切换' })).toBeVisible();
  });

  test('keeps admin quant tabs inside the stock scenario', async ({ page }) => {
    await expect(page.getByRole('button', { name: '切换使用场景' })).toContainText('美股交易');
    await expect(page.locator('nav a', { hasText: '量化交易' })).toBeVisible();
    await expect(page.locator('nav a', { hasText: '数据' })).toBeVisible();
  });
});

test.describe('scenario permissions', () => {
  test('shows two scenarios and hides admin-only tabs from non-admin users', async ({ page }) => {
    await seedSession(page, 'normaluser');
    await page.goto('/');
    await closeStartupModals(page);

    await openScenarioMenu(page);

    await expect(page.getByRole('menuitemcheckbox')).toHaveCount(2);
    await expect(page.getByRole('menuitemcheckbox', { name: /美股交易/ })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: /基金定投/ })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: /量化研究/ })).toHaveCount(0);
    await expect(page.locator('nav a', { hasText: '量化交易' })).toHaveCount(0);
    await expect(page.locator('nav a', { hasText: '数据' })).toHaveCount(0);
  });
});
