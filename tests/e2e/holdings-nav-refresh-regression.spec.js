import { expect, test } from '@playwright/test';

const LEDGER_KEY = 'aiDcaFundHoldingsLedger';

function ledgerFixture() {
  return {
    source: 'react-fund-holdings-ledger',
    version: 2,
    transactions: [
      {
        id: 'e2e-otc-buy',
        code: '000001',
        name: '场外测试基金',
        kind: 'otc',
        type: 'BUY',
        date: '2026-05-20',
        price: 1,
        shares: 1000,
        note: ''
      }
    ],
    snapshotsByCode: {
      '000001': {
        code: '000001',
        name: '场外测试基金',
        latestNav: 1,
        latestNavDate: '2026-05-28',
        previousNav: 0.99,
        previousNavDate: '2026-05-27',
        currentPrice: 1,
        price: 0,
        previousClose: 0,
        changePercent: 1.01,
        updatedAt: '2026-05-28T13:00:00.000Z'
      }
    },
    lastNavMeta: { status: 'idle', updatedAt: '', successCount: 0, failureCount: 0, errors: [] },
    migratedFromLegacy: false,
    legacyMigrationAt: '',
    switchChains: []
  };
}

test('holdings manual refresh updates OTC today return rate from latest NAV snapshot', async ({ page }) => {
  await page.addInitScript(({ key, ledger }) => {
    window.localStorage.setItem(key, JSON.stringify(ledger));
  }, { key: LEDGER_KEY, ledger: ledgerFixture() });

  await page.route('**/api/markets/fund-metrics**', async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            ok: true,
            code: '000001',
            name: '场外测试基金',
            latestNav: 1.02,
            latestNavDate: '2026-05-29',
            previousNav: 1,
            previousNavDate: '2026-05-28',
            updatedAt: '2026-05-29T13:00:00.000Z'
          }
        ],
        successCount: 1,
        failureCount: 0,
        generatedAt: '2026-05-29T13:00:00.000Z'
      }
    });
  });
  await page.route('**/api/holdings/nav-history**', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        code: '000001',
        items: [
          { date: '2026-05-28', nav: 1 },
          { date: '2026-05-29', nav: 1.02 }
        ]
      }
    });
  });

  await page.goto('./index.html?tab=holdings');
  await expect(page.getByText('场外测试基金').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /同步净值|正在同步/ }).click();

  const row = page.getByRole('row').filter({ hasText: '000001' }).first();
  await expect(row).toContainText(/\+2%\+¥ 20\.00\+2%/, { timeout: 10_000 });
});
