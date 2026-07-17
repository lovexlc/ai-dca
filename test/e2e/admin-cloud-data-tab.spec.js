import { expect, test } from '@playwright/test';

function seedSession(page, username) {
  return page.addInitScript((sessionUsername) => {
    globalThis.localStorage.setItem('aiDcaCloudSyncSession', JSON.stringify({
      username: sessionUsername,
      userId: `test-${sessionUsername}`,
      accessToken: 'test-token'
    }));
  }, username);
}

test('管理员可看到并打开云端数据 Tab', async ({ page }) => {
  await seedSession(page, 'lovexl');
  await page.goto('/?tab=cloudData');
  await expect(page.locator('a[href*="cloudData"]')).toBeVisible();
  await expect(page.getByText('逐 Tab 云端资源')).toBeVisible();
});

test('存在旧版快照且未完成迁移时显示迁移按钮', async ({ page }) => {
  await seedSession(page, 'lovexl');
  await page.route('**/api/sync/data/manifest*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      resources: [],
      migration: { status: 'pending' },
      legacySnapshot: true,
      legacySnapshotMeta: { keyCount: 3, updatedAt: '2026-07-17T00:00:00.000Z' },
      accountStatus: 'migration_pending'
    })
  }));
  await page.goto('/?tab=cloudData');
  await expect(page.getByRole('button', { name: '迁移当前账号' })).toBeVisible();
  await expect(page.getByLabel('旧安全密码')).toBeVisible();
});

test('迁移完成后隐藏迁移按钮', async ({ page }) => {
  await seedSession(page, 'lovexl');
  await page.route('**/api/sync/data/manifest*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      resources: [],
      migration: { status: 'completed' },
      legacySnapshot: true,
      legacySnapshotMeta: { keyCount: 3, updatedAt: '2026-07-17T00:00:00.000Z' },
      accountStatus: 'migration_pending'
    })
  }));
  await page.goto('/?tab=cloudData');
  await expect(page.getByText('迁移已完成，按钮已隐藏')).toBeVisible();
  await expect(page.getByRole('button', { name: '迁移当前账号' })).toHaveCount(0);
});

test('普通用户看不到云端数据 Tab，直接访问也会回到普通页面', async ({ page }) => {
  await seedSession(page, 'normaluser');
  await page.goto('/?tab=cloudData');
  await expect(page.locator('a[href*="cloudData"]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/tab=cloudData/);
  await expect(page.locator('a[href*="markets"]')).toBeVisible();
});
