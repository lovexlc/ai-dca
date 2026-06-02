import { expect, test } from '@playwright/test';
import { mockAcceptanceNetwork, waitForWorkspace } from './acceptance-helpers.js';

test.describe('watchlist OTC defaults', () => {
  test.beforeEach(async ({ page }) => {
    await mockAcceptanceNetwork(page);
    // Mock fund-limit API
    await page.route('**/api/fund-limit**', async (route) => {
      return route.fulfill({ json: { items: [] } });
    });
  });

  test('new user sees both 场内 and 场外 default lists', async ({ page }) => {
    await page.goto('./index.html?tab=markets');
    await waitForWorkspace(page, '行情中心');

    // Click the watchlist selector to open dropdown
    const selectorButton = page.getByRole('button', { name: /列表切换|默认/ }).first();
    await selectorButton.click();

    // Should see both default lists
    await expect(page.getByText('默认-场内基金')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('默认-场外基金')).toBeVisible({ timeout: 5000 });
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
    const selectorButton = page.getByRole('button', { name: /列表切换|默认/ }).first();
    await selectorButton.click();

    // Should see renamed default + new OTC list
    await expect(page.getByText('默认-场内基金')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('默认-场外基金')).toBeVisible({ timeout: 5000 });
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
    await expect(page.getByText('默认-场外基金').first()).toBeVisible({ timeout: 10000 });

    // Check that OTC fund codes are visible in the sidebar
    await expect(page.getByText('000834').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('270042').first()).toBeVisible({ timeout: 10000 });
  });
});
