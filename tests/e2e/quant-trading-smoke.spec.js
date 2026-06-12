import { expect, test } from '@playwright/test';

test('quant trading workspace renders modules and executes a simulated trade', async ({ page }) => {
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

  await expect(page.getByRole('heading', { name: '纳指 ETF 溢价差模拟盘' })).toBeVisible();
  await expect(page.getByText('模拟账户').first()).toBeVisible();

  await page.getByRole('button', { name: /^策略$/ }).click();
  await expect(page.getByRole('heading', { name: '策略' })).toBeVisible();
  await expect(page.getByText('盘口与 IOPV')).toBeVisible();

  await page.getByRole('button', { name: /^交易$/ }).click();
  await expect(page.getByRole('heading', { name: '交易' })).toBeVisible();
  await page.getByRole('button', { name: '执行模拟撮合' }).click();
  await expect(page.getByText('模拟撮合完成')).toBeVisible();
  await expect(page.getByRole('cell', { name: '买入' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '卖出' }).first()).toBeVisible();

  await page.getByRole('button', { name: /^复盘$/ }).click();
  await expect(page.getByRole('heading', { name: '复盘', exact: true })).toBeVisible();
  await expect(page.getByText('复盘交易')).toBeVisible();
});

test('quant trading menu is hidden for non-admin users', async ({ page }) => {
  await page.addInitScript((sessionKey) => {
    globalThis.localStorage.removeItem(sessionKey);
  }, 'aiDcaCloudSyncSession');

  await page.goto('/?tab=quant');
  await page.getByRole('button', { name: '知道了' }).click({ timeout: 3000 }).catch(() => {});

  await expect(page.getByRole('link', { name: /策略指南/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '纳指 ETF 溢价差模拟盘' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /量化模拟/ })).toHaveCount(0);
});
