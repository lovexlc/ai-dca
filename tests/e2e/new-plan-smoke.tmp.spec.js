import { expect, test } from '@playwright/test';

test('new plan wizard renders extracted cards', async ({ page }) => {
  await page.goto('./index.html?tab=plans#new');
  await expect(page.getByText('新建建仓计划').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /1\s*选标的/ })).toBeVisible();
  await page.getByRole('button', { name: /2\s*选策略/ }).click();
  await expect(page.getByText('选择策略模板').first()).toBeVisible();
  await page.getByRole('button', { name: /3\s*配参数/ }).click();
  await expect(page.getByText(/均线分层设置|固定回撤/).first()).toBeVisible();
  await page.getByRole('button', { name: /4\s*确认/ }).click();
  await expect(page.getByText('确认策略配置').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/ReferenceError|TypeError|Application error/);
});
