import { expect, test } from '@playwright/test';

test('test environment exposes the sentiment sidebar and live TACO factors', async ({ page }) => {
  await page.route('**/api/markets/taco*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        date: '2026-07-26',
        score: 81,
        status: '转向在即',
        percentile: '前 5%',
        rank: '第 91 高',
        source: 'xiaoyinsi-taco-page',
        asOf: '2026-07-26',
        generatedAt: '2026-07-28T12:00:00.000Z',
        factors: [
          { key: 'brent', label: '布伦特原油', displayValue: '$87.3', contribution: 17, tone: 'rose', direction: '偏高↑', note: '能源成本压力' },
          { key: 'ust10y', label: '美债10Y', displayValue: '4.64%', contribution: 4, tone: 'amber', direction: '正常', note: '融资压力' },
          { key: 'hormuz', label: '霍尔木兹通行', displayValue: '4 艘/日', contribution: 82, tone: 'emerald', direction: '极低↓↓', note: '航运中断压力' },
          { key: 'sp500', label: '标普500', displayValue: '7,413', contribution: -3, tone: 'slate', direction: '偏高↑', note: '风险偏好缓冲' }
        ]
      })
    });
  });
  await page.goto('./index.html?tab=emotion', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: '情绪' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '情绪监控' })).toBeVisible();
  await expect(page.getByText('TACO 转向分', { exact: true })).toBeVisible();
  await expect(page.getByText('81', { exact: true })).toBeVisible();
  await expect(page.getByText('实时拉取 · 2026-07-26', { exact: true })).toBeVisible();
  await expect(page.getByText('$87.3', { exact: true })).toBeVisible();
  await expect(page.getByText('4 艘/日', { exact: true })).toBeVisible();
  await expect(page.getByText('完整历史曲线')).toBeVisible();
  await expect(page.getByText('可复现模型')).toBeVisible();
});
