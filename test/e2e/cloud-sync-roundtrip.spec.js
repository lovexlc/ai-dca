/* global Storage, URL, localStorage, setTimeout, window */
import { expect, test } from '@playwright/test';

import { SYNC_REGISTRY } from '../../src/app/syncRegistry.js';
import { mockAcceptanceNetwork, waitForWorkspace } from './acceptance-helpers.js';

const ACCOUNT = {
  username: 'cloud-sync-e2e',
  password: 'Login-password-123!',
  securityPassword: 'Security-password-123!'
};

function buildProbeEntries() {
  const marker = 'sync-probe';
  return {
    aiDcaFundHoldingsLedger: JSON.stringify({
      source: 'react-fund-holdings-ledger',
      version: 2,
      transactions: [{ id: `${marker}-holding`, code: '513100', type: 'BUY', date: '2026-07-14', price: 1, shares: 1 }],
      snapshotsByCode: {},
      switchChains: []
    }),
    aiDcaFundHoldingsState: JSON.stringify({ source: marker, version: 1, rows: [] }),
    aiDcaAccountAllocationSettings: JSON.stringify({ source: marker, version: 1, cashAmount: 123, targetInvestmentPct: 70 }),
    aiDcaAccumulationState: JSON.stringify({ marker }),
    aiDcaPositionSnapshot: JSON.stringify({ marker }),
    aiDcaPlanStore: JSON.stringify({ source: marker, version: 1, activePlanId: `${marker}-plan`, plans: [{ id: `${marker}-plan`, symbol: 'QQQ' }] }),
    aiDcaPlanState: JSON.stringify({ marker }),
    aiDcaDcaStore: JSON.stringify({ source: marker, version: 1, activeDcaId: `${marker}-dca`, plans: [{ id: `${marker}-dca`, symbol: 'QQQ' }] }),
    aiDcaDcaState: JSON.stringify({ marker }),
    aiDcaSellPlanStore: JSON.stringify([{ id: `${marker}-sell`, symbol: 'QQQ' }]),
    aiDcaSellPlanDraft: JSON.stringify({ marker }),
    aiDcaSwitchStrategyPrefs: JSON.stringify({ marker }),
    aiDcaSwitchStrategyWorkerConfig: JSON.stringify({ marker }),
    aiDcaSwitchWatchlist: JSON.stringify([{ id: `${marker}-switch`, sourceCode: '513100', targetCode: '513500' }]),
    aiDcaVixState: JSON.stringify({ marker }),
    aiDcaNotifyClientConfig: JSON.stringify({ marker }),
    aiDcaWebNotifyConfig: JSON.stringify({ marker }),
    aiDcaMarketAlerts: JSON.stringify([{ id: `${marker}-market-alert`, symbol: 'QQQ' }]),
    aiDcaHoldingAlerts: JSON.stringify([{ id: `${marker}-holding-alert`, code: '513100' }]),
    aiDcaWorkspacePrefs: JSON.stringify({ source: 'react-workspace-prefs', version: 3, scenario: 'stock', homepageTab: 'markets', updatedAt: '2026-07-14T00:00:00.000Z', marker }),
    aiDcaHomeDashboardState: JSON.stringify({ marker }),
    'markets:watchlist:v1': JSON.stringify({
      defaultsVersion: 9,
      activeListId: `${marker}-list`,
      lists: [{ id: `${marker}-list`, name: marker, type: 'us', us: ['QQQ'], cn: [], createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z' }]
    }),
    aiDcaAnalyticsOptOut_v1: '1',
    aiDcaPremiumState: JSON.stringify({ unlocked: true, plan: marker, source: marker, updatedAt: '2026-07-14T00:00:00.000Z' })
  };
}

function createCloudBackend() {
  return {
    backup: null,
    contentHash: '',
    keyCount: 0,
    latestDelayMs: 0,
    latestGets: 0,
    puts: [],
    updatedAt: '',
    version: null
  };
}

async function installCloudRoutes(context, backend) {
  await context.addInitScript(() => {
    window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
    window.__AI_DCA_SYNC_BASE__ = '/api/sync';
  });
  await context.route('**/api/sync/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });

    if (path.endsWith('/analytics/track')) return json({ ok: true });
    if (path.endsWith('/auth/register')) {
      return json({ userId: 'user-cloud-sync', username: ACCOUNT.username, accessToken: 'token-register', refreshToken: 'refresh-register' });
    }
    if (path.endsWith('/auth/login')) {
      return json({
        userId: 'user-cloud-sync',
        username: ACCOUNT.username,
        accessToken: `token-login-${Date.now()}`,
        refreshToken: `refresh-login-${Date.now()}`,
        latestBackupMeta: backend.version == null ? null : {
          version: backend.version,
          updatedAt: backend.updatedAt,
          keyCount: backend.keyCount,
          contentHash: backend.contentHash
        }
      });
    }
    if (path.endsWith('/meta')) {
      return json(backend.version == null ? {
        version: null,
        updatedAt: '',
        keyCount: 0,
        bytes: 0,
        contentHash: ''
      } : {
        version: backend.version,
        updatedAt: backend.updatedAt,
        keyCount: backend.keyCount,
        bytes: JSON.stringify(backend.backup).length,
        contentHash: backend.contentHash
      });
    }
    if (path.endsWith('/latest') && request.method() === 'GET') {
      backend.latestGets += 1;
      if (backend.latestDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, backend.latestDelayMs));
      }
      return json(backend.backup ? {
        version: backend.version,
        updatedAt: backend.updatedAt,
        keyCount: backend.keyCount,
        contentHash: backend.contentHash,
        encryptedEnvelope: backend.backup
      } : { version: null, encryptedEnvelope: null });
    }
    if (path.endsWith('/latest') && request.method() === 'PUT') {
      const body = request.postDataJSON();
      backend.backup = body.encryptedEnvelope;
      backend.contentHash = String(body.encryptedEnvelope?.meta?.contentHash || '');
      backend.keyCount = Number(body.encryptedEnvelope?.meta?.keyCount) || 0;
      backend.updatedAt = new Date().toISOString();
      backend.version = backend.version == null ? 1 : backend.version + 1;
      backend.puts.push(body);
      return json({
        version: backend.version,
        updatedAt: backend.updatedAt,
        keyCount: backend.keyCount,
        contentHash: backend.contentHash,
        lastEndType: body.end?.type || ''
      });
    }
    return json({ message: 'not found' }, 404);
  });
}

async function openPage(browser, backend) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installCloudRoutes(context, backend);
  const page = await context.newPage();
  await mockAcceptanceNetwork(page);
  await page.goto('./index.html?tab=markets');
  await waitForWorkspace(page, '行情中心');
  await expect.poll(
    () => page.evaluate(() => !Storage.prototype.setItem.toString().includes('[native code]')),
    { timeout: 5_000, message: 'cloud sync storage observer should install immediately' }
  ).toBe(true);
  return { context, page };
}

async function openAuthDialog(page) {
  await page.getByRole('button', { name: '登录账户' }).filter({ visible: true }).click();
  const dialog = page.getByRole('dialog', { name: /账户登录|注册账户/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillCredentials(dialog) {
  await dialog.getByLabel('用户名').fill(ACCOUNT.username);
  await dialog.getByLabel('登录密码').fill(ACCOUNT.password);
  await dialog.getByLabel('安全密码').fill(ACCOUNT.securityPassword);
}

test('registered sync domains round-trip across isolated browsers', async ({ browser }) => {
  test.setTimeout(180_000);
  const backend = createCloudBackend();
  const probeEntries = buildProbeEntries();
  expect(Object.keys(probeEntries).sort()).toEqual(SYNC_REGISTRY.map((entry) => entry.key).sort());

  const first = await openPage(browser, backend);
  let dialog = await openAuthDialog(first.page);
  await dialog.getByRole('button', { name: '注册', exact: true }).click();
  await fillCredentials(dialog);
  await dialog.getByRole('button', { name: '注册并登录' }).click();
  await expect(first.page.getByRole('button', { name: `账户：${ACCOUNT.username}` })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => backend.puts.length, { timeout: 20_000 }).toBe(1);

  await first.page.evaluate((entries) => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, probeEntries);
  await expect.poll(() => backend.puts.length, { timeout: 20_000 }).toBe(2);
  expect(backend.keyCount).toBe(SYNC_REGISTRY.length);

  backend.latestDelayMs = 5_000;
  const second = await openPage(browser, backend);
  dialog = await openAuthDialog(second.page);
  await fillCredentials(dialog);
  await dialog.getByRole('button', { name: '登录', exact: true }).last().click();
  await expect.poll(() => backend.latestGets, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '关闭' })).toBeDisabled();
  await second.page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.locator('..').evaluate((backdrop) => backdrop.click());
  await expect(dialog).toBeVisible();
  await expect(second.page.getByRole('button', { name: `账户：${ACCOUNT.username}` })).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toBeHidden();

  const restored = await second.page.evaluate((keys) => ({
    entries: Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
    remembered: Boolean(JSON.parse(localStorage.getItem('aiDcaSecureSyncRememberedKey') || 'null')?.rawKey)
  }), SYNC_REGISTRY.map((entry) => entry.key));
  expect(restored.remembered).toBe(true);
  for (const key of SYNC_REGISTRY.map((entry) => entry.key)) {
    expect(restored.entries[key], `${key} should be restored`).not.toBeNull();
    if (key === 'aiDcaAnalyticsOptOut_v1') expect(restored.entries[key]).toBe('1');
    else expect(restored.entries[key], `${key} should contain its probe value`).toContain('sync-probe');
  }

  backend.latestDelayMs = 0;
  await second.page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('aiDcaWorkspacePrefs') || '{}');
    localStorage.setItem('aiDcaWorkspacePrefs', JSON.stringify({ ...current, secondBrowserUpdate: 'sync-probe-browser-two' }));
  });
  await expect.poll(() => backend.puts.length, { timeout: 20_000 }).toBe(3);

  const third = await openPage(browser, backend);
  dialog = await openAuthDialog(third.page);
  await fillCredentials(dialog);
  await dialog.getByRole('button', { name: '登录', exact: true }).last().click();
  await expect(third.page.getByRole('button', { name: `账户：${ACCOUNT.username}` })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => third.page.evaluate(() => JSON.parse(localStorage.getItem('aiDcaWorkspacePrefs') || '{}').secondBrowserUpdate || ''), { timeout: 10_000 })
    .toBe('sync-probe-browser-two');

  await first.context.close();
  await second.context.close();
  await third.context.close();
});
