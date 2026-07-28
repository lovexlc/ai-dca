import { expect, test } from '@playwright/test';
import { mockAcceptanceNetwork, waitForWorkspace } from './acceptance-helpers.js';

const WORKSPACE_ROUTES = [
  ['markets', './index.html?tab=markets', '行情中心'],
  ['emotion', './index.html?tab=emotion', '情绪'],
  ['holdings', './index.html?tab=holdings', '持仓总览'],
  ['tradePlans', './index.html?tab=tradePlans', '交易计划'],
  ['fundSwitch', './index.html?tab=fundSwitch', '基金切换'],
  ['notify', './index.html?tab=notify', '通知管理'],
];

async function readWorkspaceGeometry(page) {
  return page.evaluate(() => {
    const header = document.querySelector('[data-testid="app-header"]')?.getBoundingClientRect();
    const panel = document.querySelector('.page-workspace-panel');
    const pageHeader = document.querySelector('.page-header');
    const pageHeaderRect = pageHeader?.getBoundingClientRect();
    return {
      headerBottom: header?.bottom ?? 0,
      panelPaddingTop: Number.parseFloat(getComputedStyle(panel).paddingTop || '0'),
      pageHeader: pageHeaderRect
        ? { top: pageHeaderRect.top, height: pageHeaderRect.height }
        : null,
    };
  });
}

test.describe('workspace embedded layout', () => {
  test.beforeEach(async ({ page }) => {
    await mockAcceptanceNetwork(page);
  });

  for (const [name, url, label] of WORKSPACE_ROUTES) {
    test(`${name} starts on the shared content baseline`, async ({ page }) => {
      await page.goto(url);
      await waitForWorkspace(page, label);

      const geometry = await readWorkspaceGeometry(page);
      expect(geometry.panelPaddingTop).toBe(16);
      if (geometry.pageHeader) {
        expect(geometry.pageHeader.top).toBeGreaterThanOrEqual(geometry.headerBottom + 15);
        expect(geometry.pageHeader.height).toBeLessThanOrEqual(80);
      }
    });
  }

  test('embedded holdings overview hides its duplicate page title', async ({ page }) => {
    await page.goto('./index.html?tab=holdings');
    await waitForWorkspace(page, '持仓总览');

    await expect(page.getByRole('heading', { name: '持仓总览' })).toHaveCount(0);
  });

  test('holdings subpages keep the shared top spacing', async ({ page }) => {
    await page.goto('./index.html?tab=holdings#/income');
    await expect(page.getByRole('heading', { name: '收益明细' })).toBeVisible();

    const geometry = await readWorkspaceGeometry(page);
    const headingTop = await page.getByRole('heading', { name: '收益明细' }).boundingBox();
    expect(geometry.panelPaddingTop).toBe(16);
    expect(headingTop?.y ?? 0).toBeGreaterThanOrEqual(geometry.headerBottom + 15);
  });

  test('top navigation remains open while the pointer is stationary', async ({ page }) => {
    await page.goto('./index.html?tab=emotion');
    await waitForWorkspace(page, '情绪');

    const trigger = page.getByRole('button', { name: '情绪' }).first();
    await trigger.hover();
    await expect(page.getByRole('menu')).toBeVisible();

    for (let index = 0; index < 6; index += 1) {
      await page.waitForTimeout(150);
      await expect(trigger).toHaveAttribute('data-state', 'open');
      await expect(page.getByRole('menu')).toBeVisible();
    }
  });
});
