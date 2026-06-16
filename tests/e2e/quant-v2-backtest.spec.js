import { expect, test } from '@playwright/test';

const ADMIN_SESSION_KEY = 'aiDcaCloudSyncSession';

function makeBacktestResult(strategy, { timeframe = '5m' } = {}) {
  const start = Math.floor(Date.UTC(2026, 5, 12, 1, 30) / 1000);
  const rows = Array.from({ length: 18 }, (_, index) => {
    const ts = start + index * 300;
    const highPremiumPct = index < 6 ? 3.2 : index < 12 ? 0.8 : 3.1;
    const lowPremiumPct = 0;
    return {
      ts,
      date: '2026-06-12',
      currentCode: index < 6 ? '513100' : '159501',
      fromCode: index < 6 ? '513100' : '159501',
      toCode: index < 6 ? '159501' : '513100',
      highPremiumPct,
      lowPremiumPct,
      gapPct: highPremiumPct - lowPremiumPct,
      rule: index < 6 ? 'B' : 'A',
      threshold: index < 6 ? 3 : 1,
      signal: index === 4 || index === 10 ? 'switch' : 'wait',
      profit: index === 10 ? 1450 : 0,
      equity: 100000 + index * 80 + (index >= 10 ? 170 : 0),
      cash: 4200 + index * 25
    };
  });
  const candles = rows.map((row, index) => ({
    t: row.ts,
    date: row.date,
    o: 1.42 + index * 0.002,
    h: 1.428 + index * 0.002,
    l: 1.416 + index * 0.002,
    c: 1.424 + index * 0.002,
    open: 1.42 + index * 0.002,
    high: 1.428 + index * 0.002,
    low: 1.416 + index * 0.002,
    close: 1.424 + index * 0.002
  }));
  const signals = [{
    ts: rows[4].ts,
    date: rows[4].date,
    fromCode: '513100',
    toCode: '159501',
    rule: 'B',
    threshold: 3,
    gapPct: 3.2,
    profit: 0
  }, {
    ts: rows[10].ts,
    date: rows[10].date,
    fromCode: '159501',
    toCode: '513100',
    rule: 'A',
    threshold: 1,
    gapPct: 0.8,
    profit: 1450
  }];

  return {
    runId: `bt-v2-${timeframe}`,
    status: 'passed',
    timeframe,
    strategyId: strategy.id,
    strategyName: strategy.name,
    generatedAt: '2026-06-12T03:00:00.000Z',
    summary: {
      trades: signals.length,
      signalCount: signals.length,
      tradeCount: 3,
      totalProfit: 1450,
      totalReturnPct: 1.45,
      winRatePct: 100,
      sharpeRatio: 1.84,
      maxDrawdownPct: -0.42,
      finalEquity: 101450,
      sampleCount: rows.length,
      priceCoveragePct: 100,
      navCoveragePct: 100,
      dataCoveragePct: 100,
      passed: true,
      from: '2026-06-12',
      to: '2026-06-12',
      holdHighReturnPct: 0.82,
      holdLowReturnPct: -0.25,
      highCode: strategy.highCodes[0] || '513100',
      lowCode: strategy.lowCodes[0] || '159501'
    },
    rows,
    signals,
    trades: [{
      type: 'buy',
      code: '513100',
      shares: 66000,
      price: 1.424,
      amount: 93984,
      fee: 4.7,
      totalCost: 93988.7,
      date: '2026-06-12'
    }, {
      type: 'sell',
      code: '513100',
      shares: 66000,
      price: 1.432,
      amount: 94512,
      fee: 4.73,
      netProceeds: 94507.27,
      profit: 518.57,
      date: '2026-06-12'
    }, {
      type: 'buy',
      code: '159501',
      shares: 64000,
      price: 1.476,
      amount: 94464,
      fee: 4.72,
      totalCost: 94468.72,
      date: '2026-06-12'
    }],
    chart: {
      code: '513100',
      timeframe,
      candles,
      markers: signals.map((signal) => ({
        ts: signal.ts,
        date: signal.date,
        side: signal.rule === 'B' ? 'sell' : 'buy',
        price: signal.rule === 'B' ? 1.432 : 1.476,
        fromCode: signal.fromCode,
        toCode: signal.toCode,
        rule: signal.rule,
        gapPct: signal.gapPct,
        label: `卖 ${signal.fromCode} → 买 ${signal.toCode}`
      }))
    },
    quality: {
      passed: true,
      reason: '数据覆盖率满足回测门槛',
      anchorCode: '513100',
      anchorBars: candles.length,
      missingKlineCodes: [],
      klineIssues: []
    }
  };
}

test('quant v2 backtest flow works for H 513100 and L 159501', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  const httpErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });

  let strategies = [{
    id: 'default',
    enabled: true,
    name: '纳指 ETF 溢价差',
    highCodes: ['159513'],
    lowCodes: ['513100', '159501'],
    activeSide: 'all',
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3,
    notifyEnabled: true,
    paperEnabled: true,
    liveSignalEnabled: false,
    backtestGate: { status: 'none', latestRunId: '', approvedAt: '', approvedFingerprint: '', summary: null }
  }];
  let latestBacktestResult = null;
  let latestSnapshot = {
    computedAt: '2026-06-12T03:00:00.000Z',
    ready: true,
    signals: [{
      rule: 'B',
      from: '513100',
      to: '159501',
      gapPct: 3.2,
      threshold: 3,
      triggered: true
    }],
    triggers: []
  };
  const savedPayloads = [];
  const backtestPayloads = [];

  await page.route('https://tools.freebacktrack.tech/**', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('https://www.google.com/**', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/sync/**', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });

  await page.route('**/api/notify/quant/premium/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    if (path === '/api/notify/quant/premium/strategies' && method === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, strategies }) });
      return;
    }

    if (path === '/api/notify/quant/premium/config' && method === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, config: strategies[0] }) });
      return;
    }

    if (path.endsWith('/backtest/latest') && method === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: latestBacktestResult, gate: strategies[0]?.backtestGate || null })
      });
      return;
    }

    if (path.endsWith('/backtest') && method === 'POST') {
      const payload = await route.request().postDataJSON();
      backtestPayloads.push(payload);
      const strategyId = decodeURIComponent(path.split('/').at(-2));
      const strategy = strategies.find((item) => item.id === strategyId) || strategies[0];
      latestBacktestResult = makeBacktestResult(strategy, { timeframe: payload.timeframe || '5m' });
      strategies = strategies.map((item) => item.id === strategy.id
        ? {
          ...item,
          backtestGate: {
            status: 'passed',
            latestRunId: latestBacktestResult.runId,
            approvedAt: '',
            approvedFingerprint: '',
            summary: latestBacktestResult.summary
          }
        }
        : item);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, result: latestBacktestResult }) });
      return;
    }

    if (path === '/api/notify/quant/premium/strategies' && method === 'POST') {
      const payload = await route.request().postDataJSON();
      savedPayloads.push(payload);
      const next = { ...payload.strategy };
      strategies = [next, ...strategies.filter((item) => item.id !== next.id)];
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, strategy: next, strategies }) });
      return;
    }

    const strategyMatch = path.match(/^\/api\/notify\/quant\/premium\/strategies\/([^/]+)$/);
    if (strategyMatch && method === 'POST') {
      const payload = await route.request().postDataJSON();
      savedPayloads.push(payload);
      const strategyId = decodeURIComponent(strategyMatch[1]);
      const next = { ...payload.strategy, id: strategyId };
      strategies = [next, ...strategies.filter((item) => item.id !== strategyId)];
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, strategy: next, strategies }) });
      return;
    }

    if (path === '/api/notify/quant/premium/snapshot' && method === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, config: strategies[0], snapshot: latestSnapshot })
      });
      return;
    }

    if (path === '/api/notify/quant/premium/run' && method === 'POST') {
      latestSnapshot = {
        computedAt: '2026-06-12T03:05:00.000Z',
        ready: true,
        signals: [{
          rule: 'B',
          from: '513100',
          to: '159501',
          gapPct: 3.2,
          threshold: 3,
          triggered: true
        }],
        triggers: []
      };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, summary: { triggered: 1 }, snapshot: latestSnapshot })
      });
      return;
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: `unhandled ${method} ${path}` }) });
  });

  await page.addInitScript((sessionKey) => {
    globalThis.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false };
    globalThis.localStorage.setItem('aiDcaAnalyticsOptOut_v1', '1');
    globalThis.localStorage.setItem('aiDcaWebNotifyConfig', JSON.stringify({ pcEnabled: false, lastSeenEventId: '' }));
    globalThis.localStorage.setItem(sessionKey, JSON.stringify({
      userId: 'e2e-admin',
      username: 'lovexl',
      accessToken: 'e2e-token',
      refreshToken: '',
      savedAt: new Date().toISOString()
    }));
  }, ADMIN_SESSION_KEY);

  await page.goto('/?tab=quant&module=v2');
  await page.getByRole('button', { name: '知道了' }).click({ timeout: 3000 }).catch(() => {});

  await expect(page.getByRole('heading', { name: '量化研究' })).toBeVisible();
  await expect(page.getByLabel('H 高溢价 ETF（卖出方）')).toBeVisible();
  await expect(page.getByRole('button', { name: '移除 159513' })).toBeVisible();
  await expect(page.getByRole('button', { name: '移除 513100' })).toBeVisible();
  await expect(page.getByRole('button', { name: '移除 159501' })).toBeVisible();

  await page.getByRole('button', { name: '移除 159513' }).click();
  await page.getByRole('button', { name: '移除 513100' }).click();
  await page.getByLabel('H 高溢价 ETF（卖出方）').fill('513100');
  await page.getByLabel('H 高溢价 ETF（卖出方）').press('Enter');
  await expect(page.getByRole('button', { name: '移除 513100' })).toBeVisible();
  await expect(page.getByRole('button', { name: '移除 159501' })).toBeVisible();

  await page.getByLabel('规则 A：卖 L 买 H').fill('1');
  await page.getByLabel('规则 B：卖 H 买 L').fill('3');
  await page.getByRole('button', { name: /保存并运行回测/ }).click();

  await expect(page.getByText('+1.45%').first()).toBeVisible();
  await expect(page.getByText('¥1,450.00')).toBeVisible();
  await expect(page.getByText('¥101,450.00')).toBeVisible();
  await expect(page.getByText('持有 H')).toBeVisible();
  expect(savedPayloads.at(-1).strategy.highCodes).toEqual(['513100']);
  expect(savedPayloads.at(-1).strategy.lowCodes).toEqual(['159501']);
  expect(savedPayloads.at(-1).strategy.enabled).toBe(true);
  expect(backtestPayloads.at(-1)).toMatchObject({ timeframe: '5m', useV2: true });

  await page.getByRole('button', { name: 'K线+信号' }).click();
  await expect(page.getByText('收盘价')).toBeVisible();
  await page.getByRole('button', { name: '溢价差' }).click();
  await expect(page.getByText('溢价差 (%)')).toBeVisible();

  await page.getByLabel('K 线粒度').selectOption('1d');
  await page.getByRole('button', { name: /运行回测/ }).click();
  await expect.poll(() => backtestPayloads.at(-1)?.timeframe).toBe('1d');

  await page.getByRole('button', { name: /交易历史/ }).click();
  await expect(page.getByRole('cell', { name: '513100' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '159501' }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '结算金额' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '¥94,507.27' })).toBeVisible();

  await page.getByRole('button', { name: /实盘监控/ }).click();
  await page.getByRole('button', { name: '刷新' }).click();
  await expect(page.getByText('规则 B').first()).toBeVisible();
  await expect(page.getByText('卖 513100').first()).toBeVisible();
  await expect(page.getByText('买 159501').first()).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(httpErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
