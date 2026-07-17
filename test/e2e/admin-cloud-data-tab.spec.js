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

test('普通用户看不到云端数据 Tab，直接访问也会回到普通页面', async ({ page }) => {
  await seedSession(page, 'normaluser');
  await page.goto('/?tab=cloudData');
  await expect(page.locator('a[href*="cloudData"]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/tab=cloudData/);
  await expect(page.locator('a[href*="markets"]')).toBeVisible();
});
