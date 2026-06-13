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

  await expect(page.getByRole('heading', { name: '纳指 ETF 量化交易系统' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^综合仪表盘$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^行情与数据$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^策略研究$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^交易执行$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^风控监控$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^账户绩效$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^系统设置$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^选股与因子研究$/ })).toHaveCount(0);

  await page.getByRole('button', { name: /^行情与数据$/ }).click();
  await expect(page.getByText('雪球实时执行')).toBeVisible();
  await expect(page.getByText('全市场标的行情')).toBeVisible();

  await page.getByRole('button', { name: /^策略研究$/ }).click();
  await expect(page.getByRole('heading', { name: '策略开发工具' })).toBeVisible();
  await expect(page.getByText('盘口与 IOPV')).toBeVisible();
  await expect(page.getByRole('heading', { name: '复盘', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^交易执行$/ }).click();
  await expect(page.getByRole('heading', { name: '策略部署' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '交易', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '执行模拟撮合' }).click();
  await expect(page.getByText('模拟撮合完成')).toBeVisible();
  await expect(page.getByRole('cell', { name: '买入' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '卖出' }).first()).toBeVisible();

  await page.getByRole('button', { name: /^风控监控$/ }).click();
  await expect(page.getByRole('heading', { name: '风控规则配置' })).toBeVisible();

  await page.getByRole('button', { name: /^账户绩效$/ }).click();
  await expect(page.getByRole('heading', { name: '账户与绩效分析' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '模拟账户' })).toBeVisible();

  await page.getByRole('button', { name: /^系统设置$/ }).click();
  await expect(page.getByRole('heading', { name: '系统配置' })).toBeVisible();
});

test('quant trading menu is hidden for non-admin users', async ({ page }) => {
  await page.addInitScript((sessionKey) => {
    globalThis.localStorage.removeItem(sessionKey);
  }, 'aiDcaCloudSyncSession');

  await page.goto('/?tab=quant');
  await page.getByRole('button', { name: '知道了' }).click({ timeout: 3000 }).catch(() => {});

  await expect(page.getByRole('link', { name: /策略指南/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '纳指 ETF 量化交易系统' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /量化交易/ })).toHaveCount(0);
});
