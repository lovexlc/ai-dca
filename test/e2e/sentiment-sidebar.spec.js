import { expect, test } from '@playwright/test';

test('test environment exposes the sentiment sidebar and TACO snapshot', async ({ page }) => {
  await page.goto('./index.html?tab=emotion', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: '情绪' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '情绪监控' })).toBeVisible();
  await expect(page.getByText('TACO 转向分', { exact: true })).toBeVisible();
  await expect(page.getByText('81', { exact: true })).toBeVisible();
  await expect(page.getByText('完整历史曲线')).toBeVisible();
  await expect(page.getByText('可复现模型')).toBeVisible();
});
