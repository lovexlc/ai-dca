import { expect, test } from '@playwright/test';

test.describe('mobile market list interactions', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('scrolls to the final card and keeps settings above bottom navigation', async ({ page }) => {
    await page.goto('/markets');

    const shell = page.locator('.market-mobile-list-shell');
    const cards = page.locator('.market-mobile-card');
    await expect(shell).toBeVisible();
    await expect(cards.first()).toBeVisible();

    const dimensions = await shell.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

    await shell.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect.poll(() => shell.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const lastCard = cards.last();
    const bottomNav = page.locator('.mobile-bottom-nav');
    const [lastCardBox, bottomNavBox] = await Promise.all([
      lastCard.boundingBox(),
      bottomNav.boundingBox(),
    ]);
    expect(lastCardBox).not.toBeNull();
    expect(bottomNavBox).not.toBeNull();
    expect(lastCardBox.y + lastCardBox.height).toBeLessThan(bottomNavBox.y);
    await lastCard.click();
    await expect(page).toHaveURL(/symbol=/);

    await page.goto('/markets');
    await expect(page.locator('.market-mobile-toolbar')).toBeVisible();
    await page.getByRole('button', { name: '自定义卡片内容' }).click();

    const settings = page.locator('.market-column-sheet');
    await expect(settings).toBeVisible();
    await settings.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await page.getByRole('button', { name: '重置' }).click();
    await page.getByRole('button', { name: '完成' }).click();
    await expect(page.locator('.market-sheet-backdrop')).toHaveCount(0);
  });
});
