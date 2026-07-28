import { expect, test } from '@playwright/test';

test('test environment exposes the sentiment route and cached local TACO factors', async ({ page }) => {
  await page.route('**/api/markets/taco*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        date: '2026-07-28',
        score: 81,
        status: '转向在即',
        rawScore: 81.2,
        percentile: '—',
        rank: '—',
        source: 'local-four-factor-model',
        modelVersion: 'taco-local-v1',
        asOf: '2026-07-28',
        generatedAt: '2026-07-28T12:00:00.000Z',
        factors: [
          { key: 'brent', label: '布伦特原油', value: 87.3, displayValue: '$87.3', modelTerm: 53.37, contribution: 53.37, tone: 'rose', direction: '正向项', note: 'Yahoo Brent 期货' },
          { key: 'ust10y', label: '美债10Y', value: 4.64, displayValue: '4.640%', modelTerm: 27.36, contribution: 27.36, tone: 'amber', direction: '正向项', note: 'Yahoo 10Y 指数' },
          { key: 'hormuz', label: '霍尔木兹通行', value: 4, displayValue: '4 艘/日', modelTerm: -3.06, contribution: -3.06, tone: 'emerald', direction: '反向项', note: 'PortWatch n_total' },
          { key: 'sp500', label: '标普500', value: 7413, displayValue: '7,413.00', modelTerm: -10.71, contribution: -10.71, tone: 'slate', direction: '缓冲项', note: 'Yahoo S&P 500 指数' }
        ]
      })
    });
  });
  await page.goto('./index.html?tab=emotion', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('button', { name: /^情绪/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '情绪监控' })).toHaveCount(0);
  await expect(page.getByText('TACO 转向分', { exact: true })).toBeVisible();
  await expect(page.getByText('81', { exact: true })).toBeVisible();
  await expect(page.getByText('本地模型 · 2026-07-28', { exact: true })).toBeVisible();
  await expect(page.getByText('$87.3', { exact: true })).toBeVisible();
  await expect(page.getByText('4 艘/日', { exact: true })).toBeVisible();
  await expect(page.getByText('完整历史曲线')).toBeVisible();
  await expect(page.getByText('可复现模型')).toBeVisible();
});
