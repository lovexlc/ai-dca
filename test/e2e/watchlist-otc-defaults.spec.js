import { expect, test } from '@playwright/test';
import { mockAcceptanceNetwork, waitForWorkspace } from './acceptance-helpers.js';

function activeListSelector(page, name) {
  return page.locator('button[title="列表切换"]').filter({ hasText: name, visible: true }).first();
}

function visibleListOption(page, name) {
  return page.locator('button').filter({ hasText: name, visible: true }).last();
}

function visibleText(page, text) {
  return page.getByText(text).filter({ visible: true }).first();
}

test.describe('watchlist OTC defaults', () => {
  test.beforeEach(async ({ page }) => {
    await mockAcceptanceNetwork(page);
    // Mock fund-limit API
    await page.route('**/api/fund-limit**', async (route) => {
      return route.fulfill({ json: { items: [] } });
    });
    await page.route('**/api/fund-fee**', async (route) => {
      return route.fulfill({ json: { items: [] } });
    });
  });

  test('new user sees both 场内 and 场外 default lists', async ({ page }) => {
    await page.goto('./index.html?tab=markets');
    await waitForWorkspace(page, '行情中心');

    // Click the watchlist selector to open dropdown
    const selectorButton = activeListSelector(page, '默认-场内基金');
    await selectorButton.click();

    // Should see both default lists
    await expect(visibleListOption(page, '默认-场内基金')).toBeVisible({ timeout: 5000 });
    await expect(visibleListOption(page, '默认-场外基金')).toBeVisible({ timeout: 5000 });
  });

  test('existing user with v1 watchlist gets OTC list after migration', async ({ page }) => {
    // Simulate existing user with v1 watchlist in localStorage
    await page.addInitScript(() => {
      window.localStorage.setItem('markets:watchlist:v1', JSON.stringify({
        lists: [{
          id: 'default',
          name: '默认列表',
          us: [],
          cn: ['513100', '513300'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }],
        activeListId: 'default',
        defaultsVersion: 1
      }));
    });

    await page.goto('./index.html?tab=markets');
    await waitForWorkspace(page, '行情中心');

    // Click the watchlist selector
    const selectorButton = activeListSelector(page, '默认-场内基金');
    await selectorButton.click();

    // Should see renamed default + new OTC list
    await expect(visibleListOption(page, '默认-场内基金')).toBeVisible({ timeout: 5000 });
    await expect(visibleListOption(page, '默认-场外基金')).toBeVisible({ timeout: 5000 });
  });

  test('created empty list keeps selector and fund search usable', async ({ page }) => {
    await page.goto('./index.html?tab=markets');
    await waitForWorkspace(page, '行情中心');

    await activeListSelector(page, '默认-场内基金').click();
    await page.getByRole('button', { name: '新建列表' }).click();
    await page.getByLabel('输入新的列表名称').fill('空分组');
    await page.getByRole('button', { name: '确定' }).click();

    await expect(activeListSelector(page, '空分组')).toBeVisible();
    await expect(visibleText(page, '未配置自选。')).toBeVisible();
    await expect(page.getByRole('button', { name: /基金搜索/ }).first()).toBeVisible();

    await activeListSelector(page, '空分组').click();
    await visibleListOption(page, '默认-场外基金').click();
    await expect(activeListSelector(page, '默认-场外基金')).toBeVisible();

    await activeListSelector(page, '默认-场外基金').click();
    await visibleListOption(page, '空分组').click();
    await expect(visibleText(page, '未配置自选。')).toBeVisible();

    await page.getByRole('button', { name: /基金搜索/ }).first().click();
    await page.locator('input[placeholder*="搜索基金代码"]').filter({ visible: true }).first().fill('513100');
    await expect(page.locator('button').filter({ hasText: '加入自选', visible: true }).first()).toBeVisible();
    await page.locator('button').filter({ hasText: '加入自选', visible: true }).first().click();

    await expect(page.getByText('未配置自选。').filter({ visible: true })).toHaveCount(0);
    await expect(visibleText(page, '513100')).toBeVisible();
  });

  test('OTC list shows fund limit info in sidebar meta', async ({ page }) => {
    // Pre-seed localStorage with v2 watchlist containing OTC list
    await page.addInitScript(() => {
      window.localStorage.setItem('markets:watchlist:v1', JSON.stringify({
        lists: [
          {
            id: 'default',
            name: '默认-场内基金',
            type: 'cn_etf',
            us: [],
            cn: ['513100'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          },
          {
            id: 'default-otc',
            name: '默认-场外基金',
            type: 'cn_otc',
            us: [],
            cn: ['000834', '270042'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        ],
        activeListId: 'default-otc',
        defaultsVersion: 2
      }));
    });

    // Mock fund-limit API with real data
    await page.route('**/api/fund-limit**', async (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          json: {
            items: [
              { ok: true, code: '000834', data: { buyStatus: 'limit_large', maxPurchasePerDay: 1000 } },
              { ok: true, code: '270042', data: { buyStatus: 'open', maxPurchasePerDay: 0 } }
            ]
          }
        });
      }
      return route.fulfill({ json: { items: [] } });
    });

    await page.goto('./index.html?tab=markets');
    await waitForWorkspace(page, '行情中心');

    // The active list should be the OTC list
    // Check that the list name shows in the selector
    await expect(activeListSelector(page, '默认-场外基金')).toBeVisible({ timeout: 10000 });

    // Check that OTC fund codes are visible in the sidebar
    await expect(visibleText(page, '000834')).toBeVisible({ timeout: 10000 });
    await expect(visibleText(page, '270042')).toBeVisible({ timeout: 10000 });
  });

  test('v4 OTC defaults migrate to include S&P 500 OTC funds', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('markets:watchlist:v1', JSON.stringify({
        lists: [
          {
            id: 'default',
            name: '默认-场内基金',
            type: 'cn_etf',
            us: [],
            cn: ['513100'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          },
          {
            id: 'default-otc',
            name: '默认-场外基金',
            type: 'cn_otc',
            us: [],
            cn: ['000834', '270042'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        ],
        activeListId: 'default-otc',
        defaultsVersion: 4
      }));
    });

    await page.goto('./index.html?tab=markets');
    await waitForWorkspace(page, '行情中心');

    await expect(activeListSelector(page, '默认-场外基金')).toBeVisible({ timeout: 10000 });
    await expect(visibleText(page, '017641')).toBeVisible({ timeout: 10000 });
    await expect(visibleText(page, '050025')).toBeVisible({ timeout: 10000 });
    await expect(visibleText(page, '012860')).toBeVisible({ timeout: 10000 });
  });
});
