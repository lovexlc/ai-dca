import { expect, test } from '@playwright/test';

test('manual fund code can be applied as a switch holding', async ({ page }) => {
  await page.addInitScript(() => {
    window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
    window.localStorage.clear();
  });
  await page.goto('./index.html?tab=fundSwitch');

  await page.getByRole('button', { name: /添加新的切换方案/ }).click();
  const input = page.getByLabel('手动添加基金代码');
  const useButton = page.getByRole('button', { name: '使用', exact: true });

  await input.fill('sh１５９５０１');
  await expect(useButton).toBeEnabled();
  await useButton.click();

  await expect(page.getByRole('button', { name: '已选择', exact: true })).toBeVisible();
  await expect(page.getByText('已选择 159501，点击“下一步”继续。')).toBeVisible();
  await expect(page.getByRole('button', { name: /下一步/ })).toBeEnabled();
});
