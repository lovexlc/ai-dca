import { expect, test } from '@playwright/test';

test('quant research workspace renders the Worker premium paper trading panel', async ({ page }) => {
  await page.route('**/api/notify/quant/premium/config**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        config: {
          enabled: true,
          name: '纳指 ETF 溢价差',
          highCodes: ['159513'],
          lowCodes: ['513100', '159501'],
          activeSide: 'all',
          intraSellLowerPct: 1,
          intraBuyOtherPct: 3,
          notifyEnabled: true
        }
      })
    });
  });
  await page.route('**/api/notify/quant/premium/paper**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        state: {
          enabled: true,
          cash: 60000,
          maxExecutionsPerDay: 1,
          executionsToday: 0,
          lastStatus: 'idle',
          positions: {
            '159513': { code: '159513', name: '纳指科技 ETF', shares: 20000, costPrice: 1.735 },
            '513100': { code: '513100', name: '纳指 ETF', shares: 8000, costPrice: 1.486 }
          },
          orders: [],
          cashEvents: [{
            id: 'cash-1',
            ts: '2026-06-12T02:00:00.000Z',
            type: 'deposit',
            amount: 10000,
            cashBefore: 50000,
            cashAfter: 60000,
            note: 'e2e'
          }]
        }
      })
    });
  });
  await page.route('**/api/notify/quant/premium/snapshot**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        config: {
          enabled: true,
          name: '纳指 ETF 溢价差',
          highCodes: ['159513'],
          lowCodes: ['513100', '159501'],
          activeSide: 'all',
          intraSellLowerPct: 1,
          intraBuyOtherPct: 3,
          notifyEnabled: true
        },
        snapshot: {
          ready: true,
          computedAt: '2026-06-12T02:00:00.000Z',
          signals: [{
            rule: 'B',
            from: '159513',
            to: '513100',
            gapPct: 3.4,
            threshold: 3,
            description: '159513(H) - 513100(L) 溢价差 +3.40% > 3%'
          }],
          triggers: []
        }
      })
    });
  });

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

  await expect(page.getByRole('heading', { name: 'Worker 溢价差模拟盘' })).toBeVisible();
  await expect(page.getByRole('button', { name: '切换使用场景' })).toContainText('量化研究');
  await expect(page.locator('nav a', { hasText: '量化研究' })).toBeVisible();
  await expect(page.locator('nav a', { hasText: '综合仪表盘' })).toHaveCount(0);
  await expect(page.locator('nav a', { hasText: '行情与数据' })).toHaveCount(0);
  await expect(page.locator('nav a', { hasText: '策略研究' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^选股与因子研究$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '手动跑一轮' })).toBeVisible();
  await expect(page.getByRole('button', { name: '策略', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '资金', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '成交', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '量化策略配置' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '当前信号' })).toBeVisible();
  await expect(page.getByLabel('H 高溢价 ETF')).toHaveValue('159513');
  await expect(page.getByLabel('L 低溢价 ETF')).toHaveValue('513100 159501');
  await expect(page.getByText('159513(H) - 513100(L) 溢价差 +3.40% > 3%')).toBeVisible();

  await page.getByRole('button', { name: '资金', exact: true }).click();
  await expect(page.getByRole('heading', { name: '资金', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '增加现金' })).toBeVisible();
  await expect(page.getByRole('button', { name: '减少现金' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重置模拟盘' })).toBeVisible();
  await expect(page.getByText('e2e')).toBeVisible();

  await page.getByRole('button', { name: '成交', exact: true }).click();
  await expect(page.getByRole('heading', { name: '模拟持仓' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '159513' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '513100' })).toBeVisible();
  await expect(page.getByText('python3 scripts/quant_premium_runner.py')).toHaveCount(0);
  await expect(page.getByText('data/quant/orders.jsonl')).toHaveCount(0);

  await page.goto('/?tab=quant&module=research');
  await expect(page.getByRole('heading', { name: 'Worker 溢价差模拟盘' })).toBeVisible();
});

test('quant trading menu is hidden for non-admin users', async ({ page }) => {
  await page.addInitScript((sessionKey) => {
    globalThis.localStorage.removeItem(sessionKey);
  }, 'aiDcaCloudSyncSession');

  await page.goto('/?tab=quant');
  await page.getByRole('button', { name: '知道了' }).click({ timeout: 3000 }).catch(() => {});

  await expect(page.getByRole('link', { name: /策略指南/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Worker 溢价差模拟盘' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /综合仪表盘/ })).toHaveCount(0);
});
