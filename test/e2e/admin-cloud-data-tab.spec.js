import { expect, test } from '@playwright/test';

function seedSession(page, username = 'lovexl', entries = {}) {
  return page.addInitScript(({ sessionUsername, localEntries }) => {
    globalThis.localStorage.setItem('aiDcaCloudSyncSession', JSON.stringify({
      username: sessionUsername,
      userId: `test-${sessionUsername}`,
      accessToken: 'test-token'
    }));
    globalThis.localStorage.setItem('aiDcaSyncClientId', 'test-current-device');
    for (const [key, value] of Object.entries(localEntries || {})) globalThis.localStorage.setItem(key, value);
  }, { sessionUsername: username, localEntries: entries });
}

async function installSyncRoutes(page, { localPlanState = null } = {}) {
  const requests = { manifest: [], tab: [], checks: [], puts: [] };
  let completed = false;
  if (localPlanState) {
    await seedSession(page, 'lovexl', {
      aiDcaPlanState: JSON.stringify(localPlanState),
      aiDcaSwitchStrategyWorkerConfig: JSON.stringify({ enabled: false, rules: [] })
    });
  } else {
    await seedSession(page);
  }
  page.route('**/api/notify/switch/config*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, config: { enabled: false, rules: [] } })
  }));
  page.route('**/api/sync/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (path.endsWith('/data/manifest')) {
      requests.manifest.push(url.toString());
      return json({ resources: [{ resourceId: 'aiDcaPlanState', revision: 1, contentHash: 'remote-hash', updatedAt: '2026-07-17T00:00:00.000Z', deleted: false }], legacySnapshot: false, migration: { status: 'migration_pending' }, accountStatus: 'migration_pending' });
    }
    if (path.endsWith('/v2/devices') && request.method() === 'GET') {
      return json({ account: { migrationStatus: 'migration_pending' }, legacySnapshot: false, devices: [
        { deviceId: 'test-current-device', deviceType: 'PC Web', dataCheckStatus: completed ? 'completed' : 'conflict', dataScope: completed ? 'account' : 'device', dataCheckAt: '2026-07-17T00:00:00.000Z' },
        { deviceId: 'other-device', deviceType: 'APP Web', migrationStatus: 'pending' }
      ] });
    }
    if (path.endsWith('/v2/devices/register')) return json({ ok: true, device: { deviceId: 'test-current-device', migrationStatus: 'pending' } });
    if (path.endsWith('/v2/device-data-check') && request.method() === 'GET') return json({ check: null });
    if (path.endsWith('/v2/device-data-check') && request.method() === 'POST') {
      const body = request.postDataJSON();
      requests.checks.push({ url: url.toString(), body });
      completed = body.status === 'completed';
      return json({ ok: true, check: { status: body.status, completedAt: body.completedAt || '', dataScope: completed ? 'account' : 'device' } });
    }
    if (path.endsWith('/trade-plans/plan-state')) {
      requests.tab.push(url.toString());
      if (request.method() === 'PUT') {
        requests.puts.push({ url: url.toString(), body: request.postDataJSON() });
        return json({ ok: true, revision: 2, contentHash: 'local-hash' });
      }
      return json({ resource: 'aiDcaPlanState', revision: 1, deleted: false, data: JSON.stringify({ enabled: true, threshold: 2 }), contentHash: 'remote-hash' });
    }
    if (path.includes('/api/sync/') && path.endsWith('/data/manifest') === false) {
      return json({ resource: '', revision: 0, deleted: false, data: null, encrypted: null });
    }
    return json({ ok: true });
  });
  return requests;
}

test('管理员可看到云端数据 Tab，打开时只读元数据，不自动检查本机内容', async ({ page }) => {
  const requests = await installSyncRoutes(page);
  await page.goto('/?tab=cloudData');
  await expect(page.getByText('管理员灰度', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '检查本机数据' })).toBeVisible();
  await expect.poll(() => requests.tab.length).toBe(0);
  await expect.poll(() => requests.checks.length).toBe(0);
});

test('其他设备没有上报本机检查结果时显示未检查', async ({ page }) => {
  await installSyncRoutes(page);
  await page.goto('/?tab=cloudData');
  await expect(page.getByText('账号设备')).toBeVisible();
  await expect(page.getByText('当前设备', { exact: true })).toBeVisible();
  await expect(page.getByText('未检查', { exact: true })).toBeVisible();
  await expect(page.getByText('待迁移', { exact: true })).toHaveCount(0);
});

test('检查后展示记录/字段冲突，选择本机覆盖并完成后切换账户作用域', async ({ page }) => {
  const requests = await installSyncRoutes(page, { localPlanState: { enabled: false, threshold: 1 } });
  await page.goto('/?tab=cloudData');
  await page.getByRole('button', { name: '检查本机数据' }).click();
  await expect(page.getByText('冲突资源')).toBeVisible();
  await expect(page.getByRole('heading', { name: '策略状态', exact: true })).toBeVisible();
  await expect(page.getByText('字段级选择')).toBeVisible();
  for (const button of await page.getByRole('button', { name: '使用本机' }).all()) await button.click();
  await page.getByRole('button', { name: /换基 Worker 配置/ }).click();
  await page.getByRole('button', { name: '使用本机' }).click();
  await page.getByRole('button', { name: '应用选择' }).click();
  await expect.poll(() => requests.puts.length).toBe(1);
  await expect.poll(() => requests.checks.some((item) => item.body.status === 'completed')).toBe(true);
  await expect.poll(() => requests.manifest.some((value) => value.includes('accountUsername=lovexl') && !value.includes('deviceId='))).toBe(true);
  expect(requests.puts[0].url).not.toContain('accountUsername=lovexl');
});

test('管理员移动端更多菜单显示云端数据入口', async ({ page }) => {
  await installSyncRoutes(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?tab=holdings');
  await page.getByRole('button', { name: '更多', exact: true }).click();
  const more = page.getByRole('dialog', { name: '更多功能' });
  await expect(more.getByRole('button', { name: '云端数据' })).toBeVisible();
  await more.getByRole('button', { name: '云端数据' }).click();
  await expect(page.getByText('管理员灰度', { exact: true })).toBeVisible();
});

test('普通用户看不到云端数据 Tab，直接访问也会回到普通页面', async ({ page }) => {
  await seedSession(page, 'normaluser');
  await page.goto('/?tab=cloudData');
  await expect(page.locator('a[href*="cloudData"]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/tab=cloudData/);
  await expect(page.locator('a[href*="markets"]')).toBeVisible();
});
