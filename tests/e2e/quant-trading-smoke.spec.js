import { expect, test } from '@playwright/test';

test('quant research workspace renders the Python premium runner handoff', async ({ page }) => {
  await page.addInitScript(({ quantStateKey, sessionKey }) => {
    globalThis.localStorage.removeItem(quantStateKey);
    globalThis.localStorage.setItem(sessionKey, JSON.stringify({
      userId: 'e2e-admin',
      username: 'lovexl',
      accessToken: 'e2e-token',
      refreshToken: '',
      savedAt: new Date().toISOString()
    }));
  }, { quantStateKey: 'aiDcaQuantProjectState', sessionKey: 'aiDcaCloudSyncSession' });

  await page.goto('/?tab=quant');
  await page.getByRole('button', { name: '知道了' }).click({ timeout: 3000 }).catch(() => {});

  await expect(page.getByRole('heading', { name: 'Python 溢价差执行器' })).toBeVisible();
  await expect(page.getByRole('button', { name: '切换使用场景' })).toContainText('量化研究');
  await expect(page.locator('nav a', { hasText: '量化研究' })).toBeVisible();
  await expect(page.locator('nav a', { hasText: '综合仪表盘' })).toHaveCount(0);
  await expect(page.locator('nav a', { hasText: '行情与数据' })).toHaveCount(0);
  await expect(page.locator('nav a', { hasText: '策略研究' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^选股与因子研究$/ })).toHaveCount(0);
  await expect(page.getByText('python3 scripts/quant_premium_runner.py --config config/quant-premium.yaml')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'H/L 溢价差规则' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '159513' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '513100' })).toBeVisible();
  await expect(page.getByText('data/quant/signals.jsonl')).toBeVisible();
  await expect(page.getByText('data/quant/orders.jsonl')).toBeVisible();

  await page.goto('/?tab=quant&module=research');
  await expect(page.getByRole('heading', { name: 'Python 溢价差执行器' })).toBeVisible();
});

test('quant trading menu is hidden for non-admin users', async ({ page }) => {
  await page.addInitScript((sessionKey) => {
    globalThis.localStorage.removeItem(sessionKey);
  }, 'aiDcaCloudSyncSession');

  await page.goto('/?tab=quant');
  await page.getByRole('button', { name: '知道了' }).click({ timeout: 3000 }).catch(() => {});

  await expect(page.getByRole('link', { name: /策略指南/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Python 溢价差执行器' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /综合仪表盘/ })).toHaveCount(0);
});
