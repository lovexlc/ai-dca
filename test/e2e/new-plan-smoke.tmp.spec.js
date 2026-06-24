import { expect, test } from '@playwright/test';

test('new plan wizard renders extracted cards', async ({ page }) => {
  await page.goto('./index.html?tab=tradePlans#new');
  await expect(page.getByRole('button', { name: /1\s*选标的/ })).toBeVisible();
  await expect(page.getByText('选择标的').first()).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /2\s*选模板/ }).click();
  await expect(page.getByText('选择策略模板').first()).toBeVisible();
  await page.getByRole('button', { name: /3\s*调参数/ }).click();
  await expect(page.getByText(/均线分层设置|固定回撤/).filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /4\s*预览确认/ }).click();
  await expect(page.getByText('确认策略配置').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/ReferenceError|TypeError|Application error/);
});
