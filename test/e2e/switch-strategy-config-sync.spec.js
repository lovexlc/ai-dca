import { expect, test } from '@playwright/test';

const LOCAL_PREFS = {
  enabled: true,
  activeRuleId: 'rule-1',
  rules: [{
    id: 'rule-1',
    name: '默认规则',
    enabled: true,
    benchmarkCodes: ['513100'],
    enabledCodes: ['159501'],
    premiumClass: { '513100': 'H', '159501': 'L' },
    arbTargetPct: 2,
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3,
    otcPremiumThresholdPct: 8,
    otcMinIntraPremiumLow: 1,
    otcMinIntraPremiumHigh: 2
  }]
};

const SERVER_CONFIG = {
  enabled: false,
  activeRuleId: 'rule-1',
  rules: [{
    id: 'rule-1',
    name: '默认规则',
    enabled: true,
    benchmarkCodes: [],
    enabledCodes: [],
    premiumClass: {}
  }]
};

test('does not repeatedly POST the same switch config when the server canonicalizes it differently', async ({ page }) => {
  let postCount = 0;
  await page.addInitScript((prefs) => {
    window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
    window.localStorage.clear();
    window.localStorage.setItem('aiDcaNotifyClientConfig', JSON.stringify({
      notifyClientId: 'web:playwright-switch-sync',
      notifyClientSecret: 'playwright-switch-sync-secret'
    }));
    window.localStorage.setItem('aiDcaSwitchStrategyPrefs', JSON.stringify(prefs));
  }, LOCAL_PREFS);

  await page.route('**/api/notify/switch/config**', async (route) => {
    if (route.request().method() === 'POST') postCount += 1;
    await route.fulfill({ json: { ok: true, config: SERVER_CONFIG, clientId: 'web:playwright-switch-sync' } });
  });
  await page.route('**/api/notify/switch/snapshot**', (route) => (
    route.fulfill({ json: { ok: true, snapshot: null, config: SERVER_CONFIG } })
  ));
  await page.route('**/api/markets/fund-metrics**', (route) => (
    route.fulfill({ json: { items: [], successCount: 0, failureCount: 0 } })
  ));

  await page.goto('/index.html?tab=fundSwitch');
  await expect(page.getByText('自动监控', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3200);

  expect(postCount).toBe(1);
});
