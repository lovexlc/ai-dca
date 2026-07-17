import { expect, test } from '@playwright/test';

function seedSession(page, username) {
  return page.addInitScript((sessionUsername) => {
    globalThis.localStorage.setItem('aiDcaCloudSyncSession', JSON.stringify({
      username: sessionUsername,
      userId: `test-${sessionUsername}`,
      accessToken: 'test-token'
    }));
    globalThis.localStorage.setItem('aiDcaSyncClientId', 'test-current-device');
  }, username);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/sync/v2/devices', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ account: { migrationStatus: 'migration_pending' }, legacySnapshot: false, devices: [] })
  }));
});

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
      migration: { status: 'completed', migrationMode: 'tab-scoped-v2' },
      legacySnapshot: true,
      legacySnapshotMeta: { keyCount: 3, updatedAt: '2026-07-17T00:00:00.000Z' },
      accountStatus: 'migration_pending'
    })
  }));
  await page.goto('/?tab=cloudData');
  await expect(page.getByText('迁移已完成，按钮已隐藏')).toBeVisible();
  await expect(page.getByRole('button', { name: '迁移当前账号' })).toHaveCount(0);
});

test('旧版错误归集状态提供修复迁移入口', async ({ page }) => {
  await seedSession(page, 'lovexl');
  await page.route('**/api/sync/data/manifest*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      resources: [{ resourceId: 'aiDcaPlanStore', revision: 1, contentHash: 'legacy-content' }],
      migration: { status: 'completed' },
      legacySnapshot: true,
      legacySnapshotMeta: { keyCount: 3 },
      accountStatus: 'migration_pending'
    })
  }));
  await page.goto('/?tab=cloudData');
  await expect(page.getByRole('button', { name: '修复迁移数据' })).toBeVisible();
  await expect(page.getByText('迁移已完成，按钮已隐藏')).toHaveCount(0);
});

test('展示所有设备迁移状态，并允许放弃其它设备', async ({ page }) => {
  let devices = [
    { deviceId: 'test-current-device', deviceType: 'PC Web', migrationStatus: 'completed', dataMigrationStatus: 'completed', migrationMode: 'tab-scoped-v2', needsMigration: false, lastSeenAt: '2026-07-17T00:00:00.000Z' },
    { deviceId: 'pending-device', deviceType: 'APP Web', migrationStatus: 'pending', dataMigrationStatus: 'pending', needsMigration: true, lastSeenAt: '2026-07-16T00:00:00.000Z' }
  ];
  await seedSession(page, 'lovexl');
  await page.unroute('**/api/sync/v2/devices');
  await page.route('**/api/sync/v2/devices', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ account: { migrationStatus: 'migration_pending' }, legacySnapshot: true, devices })
  }));
  await page.route('**/api/sync/v2/devices/discard', async (route) => {
    devices = devices.map((device) => device.deviceId === 'pending-device'
      ? { ...device, migrationStatus: 'discarded', dataMigrationStatus: 'cancelled', needsMigration: false }
      : device);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, deviceId: 'pending-device', migrationStatus: 'discarded' }) });
  });
  await page.route('**/api/sync/data/manifest*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ resources: [], migration: { status: 'completed', migrationMode: 'tab-scoped-v2' }, legacySnapshot: true, legacySnapshotMeta: { keyCount: 3 }, accountStatus: 'migration_pending' })
  }));
  await page.goto('/?tab=cloudData');
  await expect(page.getByText('账号设备迁移')).toBeVisible();
  await expect(page.getByText('当前设备之外还有 1 台设备待处理')).toBeVisible();
  await expect(page.getByText('当前设备', { exact: true })).toBeVisible();
  await expect(page.getByText('待迁移', { exact: true })).toBeVisible();
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '放弃迁移' }).click();
  await expect(page.getByText('已放弃', { exact: true })).toBeVisible();
  await expect(page.getByText('当前设备之外还有 1 台设备待处理')).toHaveCount(0);
});

test('点击迁移时保留原页面并展示迁移进度', async ({ page }) => {
  await seedSession(page, 'lovexl');
  await page.route('**/api/sync/data/manifest*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      resources: [],
      migration: { status: 'pending' },
      legacySnapshot: true,
      legacySnapshotMeta: { keyCount: 3 },
      accountStatus: 'migration_pending'
    })
  }));
  await page.route('**/api/sync/v2/snapshot*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: '测试用未授权' }) });
  });
  await page.goto('/?tab=cloudData');
  await page.getByRole('button', { name: '迁移当前账号' }).click();
  await expect(page.getByRole('status', { name: '迁移进度' })).toBeVisible();
  await expect(page.getByText('逐 Tab 云端资源')).toBeVisible();
  await expect(page.getByRole('status', { name: '页面加载中' })).toHaveCount(0);
});

test('普通用户看不到云端数据 Tab，直接访问也会回到普通页面', async ({ page }) => {
  await seedSession(page, 'normaluser');
  await page.goto('/?tab=cloudData');
  await expect(page.locator('a[href*="cloudData"]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/tab=cloudData/);
  await expect(page.locator('a[href*="markets"]')).toBeVisible();
});
