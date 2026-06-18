import { test } from 'node:test';
import assert from 'node:assert/strict';

/* global Request, Response, URL */

import notifyWorker from '../workers/notify/src/index.js';
import {
  QUANT_PREMIUM_CONFIG_PREFIX,
  QUANT_PREMIUM_STRATEGIES_PREFIX,
  QUANT_PREMIUM_STUDIO_CONTRACT_VERSION,
  buildQuantPremiumSwitchConfig,
  normalizeQuantPremiumConfig,
  normalizeQuantPremiumStrategy,
  runQuantPremiumBacktest
} from '../workers/notify/src/quantPremiumRoutes.js';
import { hashText } from '../workers/notify/src/clientSettings.js';
import { runQuantPremiumBacktestV2 } from '../workers/notify/src/quantPremiumBacktestV2.js';
import { quantPremiumPaperStateKey } from '../workers/notify/src/premiumPaperTrading.js';
import { getRunnableSwitchRules } from '../workers/notify/src/switchStrategy.js';

function makePremiumCandles(premiums = [], { start = Math.floor(Date.UTC(2026, 5, 12, 1, 30) / 1000), step = 300 } = {}) {
  return premiums.map((premiumPct, index) => ({
    t: start + index * step,
    c: 1 + Number(premiumPct) / 100
  }));
}

function createMemoryKv(seed = {}) {
  const memory = new Map(Object.entries(seed));
  return {
    async get(key, options = undefined) {
      if (!memory.has(key)) return null;
      const value = memory.get(key);
      if (options?.type === 'json') {
        try {
          return typeof value === 'string' ? JSON.parse(value) : value;
        } catch {
          return null;
        }
      }
      return typeof value === 'string' ? value : JSON.stringify(value);
    },
    async put(key, value) {
      memory.set(key, String(value));
    },
    async list({ prefix = '' } = {}) {
      return {
        keys: Array.from(memory.keys())
          .filter((name) => name.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true
      };
    }
  };
}

function navHistoryMonthPayload(code, items = []) {
  return JSON.stringify({
    version: 1,
    code,
    month: '2026-06',
    from: '2026-06-01',
    to: '2026-06-30',
    count: items.length,
    items,
    generatedAt: '2026-06-18T00:00:00.000+08:00',
    expiresAt: '2099-01-01T00:00:00.000+08:00'
  });
}

function quantPremiumTestFingerprint({
  highCodes = ['159513'],
  lowCodes = ['513100'],
  activeSide = 'all',
  intraSellLowerPct = 1,
  intraBuyOtherPct = 3
} = {}) {
  return JSON.stringify({
    highCodes,
    lowCodes,
    activeSide,
    intraSellLowerPct,
    intraBuyOtherPct
  });
}

async function createQuantPremiumRouteFixture({
  clientId = 'web:quant-route',
  clientSecret = 'quant-secret',
  strategies = [],
  records = {}
} = {}) {
  return {
    clientId,
    clientSecret,
    env: {
      NOTIFY_STATE: createMemoryKv({
        'notify:settings': JSON.stringify({
          clients: {
            [clientId]: {
              clientId,
              clientSecretHash: await hashText(clientSecret)
            }
          }
        }),
        [`quant:premium:strategies:${clientId}`]: JSON.stringify({
          version: 1,
          strategies
        }),
        ...records
      })
    }
  };
}

test('quant premium config normalizes arbitrary H/L symbols without holdings', () => {
  const config = normalizeQuantPremiumConfig({
    enabled: true,
    highCodes: '159513, 513100',
    lowCodes: '159501 159513 513100',
    activeSide: 'all',
    intraSellLowerPct: '0.8',
    intraBuyOtherPct: '4.2'
  });

  assert.deepEqual(config.highCodes, ['159513', '513100']);
  assert.deepEqual(config.lowCodes, ['159501']);
  assert.equal(config.activeSide, 'all');
  assert.equal(config.intraSellLowerPct, 0.8);
  assert.equal(config.intraBuyOtherPct, 4.2);

  const switchConfig = buildQuantPremiumSwitchConfig(config);
  assert.equal(switchConfig.enabled, true);
  assert.deepEqual(switchConfig.benchmarkCodes, ['159513', '513100', '159501']);
  assert.deepEqual(switchConfig.enabledCodes, []);
  assert.equal(switchConfig.premiumClass['159513'], 'H');
  assert.equal(switchConfig.premiumClass['159501'], 'L');
  assert.equal(getRunnableSwitchRules(switchConfig).length, 1);
});

test('quant premium state keys are isolated from holding switch keys', () => {
  assert.equal(QUANT_PREMIUM_CONFIG_PREFIX, 'quant:premium:config:');
  assert.equal(QUANT_PREMIUM_STRATEGIES_PREFIX, 'quant:premium:strategies:');
  assert.equal(quantPremiumPaperStateKey('client-a'), 'quant:premium:paper:state:client-a');
  assert.equal(quantPremiumPaperStateKey('client-a', 'strategy-a'), 'quant:premium:paper:state:client-a:strategy-a');
  assert.equal(quantPremiumPaperStateKey('client-a').startsWith('switch:'), false);
});

test('quant premium studio route returns one backend contract for the workspace', async () => {
  const clientId = 'web:quant-studio';
  const clientSecret = 'quant-secret';
  const strategy = normalizeQuantPremiumStrategy({
    id: 'studio-demo',
    enabled: true,
    name: 'Studio Demo',
    highCodes: ['159513'],
    lowCodes: ['513100'],
    backtestGate: {
      status: 'passed',
      latestRunId: 'bt-studio-demo',
      summary: { sampleCount: 16, signalCount: 2 },
      updatedAt: '2026-06-12T02:00:00.000Z'
    }
  });
  const env = {
    NOTIFY_STATE: createMemoryKv({
      'notify:settings': JSON.stringify({
        clients: {
          [clientId]: {
            clientId,
            clientSecretHash: await hashText(clientSecret)
          }
        }
      }),
      [`quant:premium:strategies:${clientId}`]: JSON.stringify({
        version: 1,
        strategies: [strategy]
      }),
      [`quant:premium:backtest:${clientId}:studio-demo:bt-studio-demo`]: JSON.stringify({
        ok: true,
        runId: 'bt-studio-demo',
        strategyId: 'studio-demo',
        status: 'passed',
        summary: { sampleCount: 16, signalCount: 2 },
        rows: [],
        signals: []
      }),
      [`quant:premium:snapshot:${clientId}:studio-demo`]: JSON.stringify({
        ready: true,
        computedAt: '2026-06-12T02:05:00.000Z',
        triggers: [{ pairKey: 'studio-demo:159513:513100', fromCode: '159513', toCode: '513100' }]
      }),
      [`quant:premium:paper:state:${clientId}:studio-demo`]: JSON.stringify({
        cash: 50000,
        positions: {},
        orders: [],
        cashEvents: [],
        lastStatus: 'idle'
      }),
      [`quant:premium:audit:${clientId}:studio-demo`]: JSON.stringify({
        events: [{
          id: 'qa-1',
          type: 'quant.backtest.completed',
          strategyId: 'studio-demo',
          createdAt: '2026-06-12T02:00:00.000Z',
          summary: '回测通过'
        }]
      })
    })
  };

  const response = await notifyWorker.fetch(new Request(
    `https://tools.freebacktrack.tech/api/notify/quant/premium/studio?clientId=${encodeURIComponent(clientId)}&strategyId=studio-demo`,
    {
      headers: { 'x-notify-client-secret': clientSecret }
    }
  ), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.kind, 'quant-premium-studio');
  assert.equal(payload.version, QUANT_PREMIUM_STUDIO_CONTRACT_VERSION);
  assert.equal(payload.selectedStrategyId, 'studio-demo');
  assert.equal(payload.resources.strategy.id, 'studio-demo');
  assert.equal(payload.resources.backtest.result.runId, 'bt-studio-demo');
  assert.equal(payload.resources.marketSnapshot.liveSignals.length, 1);
  assert.equal(payload.resources.paperPortfolio.cash, 50000);
  assert.equal(payload.resources.audit.events[0].type, 'quant.backtest.completed');
  assert.deepEqual(payload.resources.riskDecision.reasons, ['backtest-not-approved', 'live-signal-disabled']);
});

test('quant premium resource backtests route returns latest and requested run', async () => {
  const clientId = 'web:quant-backtests';
  const strategy = normalizeQuantPremiumStrategy({
    id: 'route-demo',
    enabled: true,
    name: 'Route Demo',
    highCodes: ['159513'],
    lowCodes: ['513100'],
    backtestGate: {
      status: 'passed',
      latestRunId: 'bt-latest',
      summary: { sampleCount: 20, signalCount: 3 },
      updatedAt: '2026-06-12T02:00:00.000Z'
    }
  });
  const { clientSecret, env } = await createQuantPremiumRouteFixture({
    clientId,
    strategies: [strategy],
    records: {
      [`quant:premium:backtest:${clientId}:route-demo:bt-latest`]: JSON.stringify({
        ok: true,
        runId: 'bt-latest',
        strategyId: 'route-demo',
        status: 'passed',
        summary: { sampleCount: 20, signalCount: 3 },
        rows: [],
        signals: []
      }),
      [`quant:premium:backtest:${clientId}:route-demo:bt-old`]: JSON.stringify({
        ok: true,
        runId: 'bt-old',
        strategyId: 'route-demo',
        status: 'passed',
        summary: { sampleCount: 12, signalCount: 1 },
        rows: [],
        signals: []
      })
    }
  });

  const headers = { 'x-notify-client-secret': clientSecret };
  const latestResponse = await notifyWorker.fetch(new Request(
    `https://tools.freebacktrack.tech/api/notify/quant/premium/strategies/route-demo/backtests?clientId=${encodeURIComponent(clientId)}`,
    { headers }
  ), env);
  const latestPayload = await latestResponse.json();
  const requestedResponse = await notifyWorker.fetch(new Request(
    `https://tools.freebacktrack.tech/api/notify/quant/premium/strategies/route-demo/backtests/bt-old?clientId=${encodeURIComponent(clientId)}`,
    { headers }
  ), env);
  const requestedPayload = await requestedResponse.json();

  assert.equal(latestResponse.status, 200);
  assert.equal(latestPayload.result.runId, 'bt-latest');
  assert.equal(latestPayload.items.length, 1);
  assert.equal(latestPayload.items[0].runId, 'bt-latest');
  assert.equal(latestPayload.gate.latestRunId, 'bt-latest');
  assert.equal(requestedResponse.status, 200);
  assert.equal(requestedPayload.result.runId, 'bt-old');
  assert.equal(requestedPayload.gate.latestRunId, 'bt-latest');
});

test('quant premium backtest route requests kline with R2 merge enabled', async () => {
  const clientId = 'web:quant-r2-merge';
  const clientSecret = 'quant-secret';
  const strategy = normalizeQuantPremiumStrategy({
    id: 'merge-r2-demo',
    enabled: true,
    name: 'Merge R2 Demo',
    highCodes: ['159513'],
    lowCodes: ['513100'],
    activeSide: 'all',
    intraBuyOtherPct: 3,
    intraSellLowerPct: 1
  });
  const { env } = await createQuantPremiumRouteFixture({
    clientId,
    clientSecret,
    strategies: [strategy]
  });
  const requestedUrls = [];
  const start = Math.floor(Date.UTC(2026, 5, 12, 1, 30) / 1000);
  const candles = Array.from({ length: 12 }, (_, index) => ({
    t: start + index * 60,
    o: 1,
    h: 1.05,
    l: 0.99,
    c: 1,
    v: 1000
  }));
  env.ADMIN_TEST_TOKEN = 'admin-test';
  env.NAV_HISTORY_KV = createMemoryKv({
    'navhist:v1:159513:2026-06': navHistoryMonthPayload('159513', [{ date: '2026-06-12', nav: 1 }]),
    'navhist:v1:513100:2026-06': navHistoryMonthPayload('513100', [{ date: '2026-06-12', nav: 1 }])
  });
  env.MARKETS = {
    async fetch(request) {
      const url = new URL(request.url);
      requestedUrls.push(url.toString());
      const code = decodeURIComponent(url.pathname.split('/').pop() || '');
      const premium = code === '159513' ? 0.04 : 0;
      return new Response(JSON.stringify({
        symbol: code,
        interval: url.searchParams.get('tf') || '1m',
        market: 'cn',
        source: 'realtime+r2',
        mergedR2: true,
        candles: candles.map((item) => ({ ...item, c: item.c + premium }))
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  try {
    const response = await notifyWorker.fetch(new Request(
      `https://tools.freebacktrack.tech/api/notify/quant/premium/strategies/merge-r2-demo/backtest?clientId=${encodeURIComponent(clientId)}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-admin-token': 'admin-test',
          'x-notify-client-secret': clientSecret
        },
        body: JSON.stringify({ timeframe: '1m' })
      }
    ), env);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.result.status, 'passed');
    assert.equal(payload.result.timeframe, '1m');
    assert.equal(payload.result.summary.sampleCount, 12);
    assert.equal(requestedUrls.length, 2);
    for (const item of requestedUrls) {
      const url = new URL(item);
      assert.equal(url.searchParams.get('tf'), '1m');
      assert.equal(url.searchParams.get('limit'), '1000');
      assert.equal(url.searchParams.get('session'), 'all');
      assert.equal(url.searchParams.get('refresh'), '1');
      assert.equal(url.searchParams.get('mergeR2'), '1');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('quant premium approve route enables live signal only for a passed matching backtest', async () => {
  const clientId = 'web:quant-approve';
  const strategy = normalizeQuantPremiumStrategy({
    id: 'approve-demo',
    enabled: true,
    name: 'Approve Demo',
    highCodes: ['159513'],
    lowCodes: ['513100'],
    backtestGate: {
      status: 'passed',
      latestRunId: 'bt-pass',
      summary: { sampleCount: 20, signalCount: 3 },
      updatedAt: '2026-06-12T02:00:00.000Z'
    }
  });
  const fingerprint = quantPremiumTestFingerprint();
  const { clientSecret, env } = await createQuantPremiumRouteFixture({
    clientId,
    strategies: [strategy],
    records: {
      [`quant:premium:backtest:${clientId}:approve-demo:bt-pass`]: JSON.stringify({
        ok: true,
        runId: 'bt-pass',
        strategyId: 'approve-demo',
        strategyFingerprint: fingerprint,
        status: 'passed',
        summary: { sampleCount: 20, signalCount: 3 },
        rows: [],
        signals: []
      })
    }
  });

  const response = await notifyWorker.fetch(new Request(
    `https://tools.freebacktrack.tech/api/notify/quant/premium/strategies/approve-demo/approve?clientId=${encodeURIComponent(clientId)}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-notify-client-secret': clientSecret
      },
      body: JSON.stringify({ runId: 'bt-pass' })
    }
  ), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.strategy.id, 'approve-demo');
  assert.equal(payload.strategy.liveSignalEnabled, true);
  assert.equal(payload.gate.status, 'passed');
  assert.equal(payload.gate.latestRunId, 'bt-pass');
  assert.equal(payload.gate.approvedFingerprint, fingerprint);
  assert.ok(payload.gate.approvedAt);

  const studioResponse = await notifyWorker.fetch(new Request(
    `https://tools.freebacktrack.tech/api/notify/quant/premium/studio?clientId=${encodeURIComponent(clientId)}&strategyId=approve-demo`,
    { headers: { 'x-notify-client-secret': clientSecret } }
  ), env);
  const studioPayload = await studioResponse.json();
  assert.equal(studioPayload.resources.riskDecision.allowed, true);
  assert.equal(studioPayload.resources.audit.events[0].type, 'quant.backtest.approved');
});

test('quant premium approve route rejects failed and stale backtests', async () => {
  const clientId = 'web:quant-approve-rejects';
  const failedStrategy = normalizeQuantPremiumStrategy({
    id: 'failed-demo',
    enabled: true,
    highCodes: ['159513'],
    lowCodes: ['513100'],
    backtestGate: {
      status: 'failed',
      latestRunId: 'bt-failed',
      summary: { sampleCount: 0, signalCount: 0 }
    }
  });
  const staleStrategy = normalizeQuantPremiumStrategy({
    id: 'stale-demo',
    enabled: true,
    highCodes: ['159513'],
    lowCodes: ['159501'],
    backtestGate: {
      status: 'passed',
      latestRunId: 'bt-stale',
      summary: { sampleCount: 20, signalCount: 3 }
    }
  });
  const { clientSecret, env } = await createQuantPremiumRouteFixture({
    clientId,
    strategies: [failedStrategy, staleStrategy],
    records: {
      [`quant:premium:backtest:${clientId}:failed-demo:bt-failed`]: JSON.stringify({
        ok: true,
        runId: 'bt-failed',
        strategyId: 'failed-demo',
        status: 'failed',
        summary: { sampleCount: 0, signalCount: 0 },
        rows: [],
        signals: []
      }),
      [`quant:premium:backtest:${clientId}:stale-demo:bt-stale`]: JSON.stringify({
        ok: true,
        runId: 'bt-stale',
        strategyId: 'stale-demo',
        strategyFingerprint: quantPremiumTestFingerprint({ lowCodes: ['513100'] }),
        status: 'passed',
        summary: { sampleCount: 20, signalCount: 3 },
        rows: [],
        signals: []
      })
    }
  });
  const headers = {
    'content-type': 'application/json',
    'x-notify-client-secret': clientSecret
  };

  const failedResponse = await notifyWorker.fetch(new Request(
    `https://tools.freebacktrack.tech/api/notify/quant/premium/strategies/failed-demo/approve?clientId=${encodeURIComponent(clientId)}`,
    { method: 'POST', headers, body: JSON.stringify({ runId: 'bt-failed' }) }
  ), env);
  const staleResponse = await notifyWorker.fetch(new Request(
    `https://tools.freebacktrack.tech/api/notify/quant/premium/strategies/stale-demo/approve?clientId=${encodeURIComponent(clientId)}`,
    { method: 'POST', headers, body: JSON.stringify({ runId: 'bt-stale' }) }
  ), env);

  assert.equal(failedResponse.status, 400);
  assert.match((await failedResponse.json()).error, /通过/);
  assert.equal(staleResponse.status, 409);
  assert.match((await staleResponse.json()).error, /重新回测/);
});

test('quant premium live signal requires a passed approved backtest gate', () => {
  const strategy = normalizeQuantPremiumStrategy({
    id: 's1',
    enabled: true,
    liveSignalEnabled: true,
    highCodes: ['159513'],
    lowCodes: ['513100'],
    backtestGate: {
      status: 'passed',
      approvedAt: '2026-06-12T02:00:00.000Z',
      approvedFingerprint: JSON.stringify({
        highCodes: ['159513'],
        lowCodes: ['513100'],
        activeSide: 'all',
        intraSellLowerPct: 1,
        intraBuyOtherPct: 3
      })
    }
  });

  assert.equal(strategy.liveSignalEnabled, true);

  const stale = normalizeQuantPremiumStrategy({
    ...strategy,
    lowCodes: ['159501']
  });
  assert.equal(stale.liveSignalEnabled, false);
  assert.equal(stale.backtestGate.approvedAt, '');
});

test('quant premium backtest passes when 5m price and nav coverage are sufficient', () => {
  const candles = Array.from({ length: 16 }, (_, index) => ({
    t: Math.floor(Date.UTC(2026, 5, 12, 1, 30) / 1000) + index * 300,
    c: 1.5 + index * 0.001
  }));
  const result = runQuantPremiumBacktest({
    id: 's1',
    enabled: true,
    highCodes: ['159513'],
    lowCodes: ['513100'],
    intraBuyOtherPct: 0.2
  }, {
    timeframe: '5m',
    historyByCode: {
      '159513': candles.map((item) => ({ ...item, c: item.c + 0.02 })),
      '513100': candles
    },
    navHistoryByCode: {
      '159513': [{ date: '2026-06-12', nav: 1.48 }],
      '513100': [{ date: '2026-06-12', nav: 1.5 }]
    }
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.summary.sampleCount, 16);
  assert.ok(result.summary.signalCount > 0);
  assert.equal(result.timeframe, '5m');
  assert.equal(result.chart.code, '159513');
  assert.equal(result.chart.candles.length, 16);
  assert.ok(result.chart.markers.length > 0);
  assert.equal(result.chart.markers[0].side, 'sell');
});

test('quant premium V2 backtest accepts markets candle schema and returns route contract', () => {
  const candles = Array.from({ length: 16 }, (_, index) => ({
    t: Math.floor(Date.UTC(2026, 5, 12, 1, 30) / 1000) + index * 300,
    c: 1.5 + index * 0.001
  }));
  const result = runQuantPremiumBacktest({
    id: 's1-v2',
    enabled: true,
    highCodes: ['159513'],
    lowCodes: ['513100'],
    intraBuyOtherPct: 0.2
  }, {
    timeframe: '5m',
    useV2: true,
    historyByCode: {
      '159513': candles.map((item) => ({ ...item, c: item.c + 0.02 })),
      '513100': candles
    },
    navHistoryByCode: {
      '159513': [{ date: '2026-06-12', nav: 1.48 }],
      '513100': [{ date: '2026-06-12', nav: 1.5 }]
    }
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.timeframe, '5m');
  assert.equal(result.summary.sampleCount, 16);
  assert.equal(result.summary.priceCoveragePct, 100);
  assert.equal(result.summary.navCoveragePct, 100);
  assert.equal(result.summary.signalCount, result.signals.length);
  assert.ok(result.summary.signalCount > 0);
  assert.equal(result.quality.passed, true);
  assert.equal(result.chart.code, '159513');
  assert.equal(result.chart.candles.length, 16);
  assert.equal(result.chart.candles[0].c, result.chart.candles[0].close);
  assert.ok(result.chart.markers.length > 0);
});

test('quant premium backtest cycles according to simulated current holding', () => {
  const gaps = [4, 4, 0.5, 0.5, 4, 4, 0.4, 0.4, 4, 4, 0.6, 0.6];
  const result = runQuantPremiumBacktest({
    id: 'cycle',
    enabled: true,
    highCodes: ['513100'],
    lowCodes: ['159501'],
    activeSide: 'all',
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3
  }, {
    timeframe: '5m',
    historyByCode: {
      '513100': makePremiumCandles(gaps),
      '159501': makePremiumCandles(gaps.map(() => 0))
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-06-12', nav: 1 }],
      '159501': [{ date: '2026-06-12', nav: 1 }]
    }
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.signals.slice(0, 4).map((signal) => `${signal.fromCode}->${signal.toCode}`), [
    '513100->159501',
    '159501->513100',
    '513100->159501',
    '159501->513100'
  ]);
  assert.deepEqual(result.signals.slice(0, 4).map((signal) => signal.rule), ['B', 'A', 'B', 'A']);
  assert.ok(result.summary.totalProfit > 0);
});

test('quant premium V2 backtest triggers on documented inclusive thresholds for 513100 and 159501', () => {
  const gaps = [3, 3, 1, 1, 3, 3, 1, 1, 3, 3, 1, 1];
  const result = runQuantPremiumBacktest({
    id: 'inclusive-v2',
    enabled: true,
    highCodes: ['513100'],
    lowCodes: ['159501'],
    activeSide: 'all',
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3
  }, {
    timeframe: '5m',
    useV2: true,
    historyByCode: {
      '513100': makePremiumCandles(gaps),
      '159501': makePremiumCandles(gaps.map(() => 0))
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-06-12', nav: 1 }],
      '159501': [{ date: '2026-06-12', nav: 1 }]
    }
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.signals.slice(0, 4).map((signal) => signal.rule), ['B', 'A', 'B', 'A']);
  assert.deepEqual(result.signals.slice(0, 4).map((signal) => `${signal.fromCode}->${signal.toCode}`), [
    '513100->159501',
    '159501->513100',
    '513100->159501',
    '159501->513100'
  ]);
});

test('quant premium V2 backtest reinvests full proceeds instead of idling orderCash-sized cash', () => {
  const gaps = [3, 3, 1, 1, 3, 3, 1, 1, 3, 3, 1, 1];
  const result = runQuantPremiumBacktest({
    id: 'full-reinvest-v2',
    enabled: true,
    highCodes: ['513100'],
    lowCodes: ['159501'],
    activeSide: 'all',
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3
  }, {
    timeframe: '1d',
    useV2: true,
    initialEquity: 100000,
    orderCash: 16000,
    historyByCode: {
      '513100': makePremiumCandles(gaps, { start: Math.floor(Date.UTC(2026, 0, 2) / 1000), step: 86400 }),
      '159501': makePremiumCandles(gaps.map(() => 0), { start: Math.floor(Date.UTC(2026, 0, 2) / 1000), step: 86400 })
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-01-02', nav: 1 }],
      '159501': [{ date: '2026-01-02', nav: 1 }]
    }
  });

  assert.equal(result.status, 'passed');
  const buyTrades = result.trades.filter((trade) => trade.type === 'buy');
  assert.ok(buyTrades.length >= 3);
  assert.ok(
    buyTrades.slice(1).every((trade) => trade.totalCost > 90000),
    `expected post-switch buys to stay near full equity, got ${buyTrades.slice(1).map((trade) => trade.totalCost).join(', ')}`
  );
  const investedRows = result.rows.filter((row) => Object.keys(row.positions || {}).length > 0);
  assert.ok(investedRows.length > 0);
  const maxCashRatio = Math.max(...investedRows.map((row) => row.cash / row.equity));
  assert.ok(maxCashRatio < 0.01, `expected cash drag below 1%, got ${(maxCashRatio * 100).toFixed(2)}%`);
});

test('quant premium V2 switch buy rounds up to the next board lot after selling', () => {
  const start = Math.floor(Date.UTC(2026, 0, 2) / 1000);
  const hCandles = Array.from({ length: 12 }, (_, index) => ({
    t: start + index * 86400,
    c: 1.9
  }));
  const lCandles = Array.from({ length: 12 }, (_, index) => ({
    t: start + index * 86400,
    c: 1.901
  }));

  const result = runQuantPremiumBacktestV2({
    id: 'ceil-lot-v2',
    enabled: true,
    highCodes: ['513100'],
    lowCodes: ['159501'],
    activeSide: 'all',
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3
  }, {
    timeframe: '1d',
    initialEquity: 19000,
    feeRate: 0,
    minFee: 0,
    tickSize: 0.001,
    slippageTicks: 0,
    lotSize: 100,
    historyByCode: {
      '513100': hCandles,
      '159501': lCandles
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-01-02', nav: 1 }],
      '159501': [{ date: '2026-01-02', nav: 1.901 }]
    }
  });

  assert.equal(result.status, 'passed');
  const switchBuy = result.trades.find((trade) => trade.type === 'buy' && trade.code === '159501');
  assert.ok(switchBuy);
  assert.equal(switchBuy.shares, 10000);
  assert.equal(switchBuy.totalCost, 19010);
  assert.equal(switchBuy.roundLotMode, 'ceil');
  const firstSwitchRow = result.rows.find((row) => row.signal === 'switch');
  assert.ok(firstSwitchRow);
  assert.equal(firstSwitchRow.currentCode, '159501');
  assert.equal(firstSwitchRow.cash, -10);
});

test('quant premium V2 trades use bid/ask execution prices and minute timestamps', () => {
  const start = Math.floor(Date.UTC(2026, 0, 2, 1, 35) / 1000);
  const hCandles = Array.from({ length: 12 }, (_, index) => ({
    t: start + index * 300,
    c: 1.03,
    bidPrice: 1.02,
    askPrice: 1.04
  }));
  const lCandles = Array.from({ length: 12 }, (_, index) => ({
    t: start + index * 300,
    c: 1,
    bidPrice: 0.99,
    askPrice: 1.01
  }));

  const result = runQuantPremiumBacktestV2({
    id: 'bid-ask-v2',
    enabled: true,
    highCodes: ['513100'],
    lowCodes: ['159501'],
    activeSide: 'all',
    intraSellLowerPct: 1,
    intraBuyOtherPct: 3
  }, {
    timeframe: '5m',
    initialEquity: 100000,
    feeRate: 0,
    minFee: 0,
    tickSize: 0.001,
    slippageTicks: 0,
    lotSize: 100,
    historyByCode: {
      '513100': hCandles,
      '159501': lCandles
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-01-02', nav: 1 }],
      '159501': [{ date: '2026-01-02', nav: 1 }]
    }
  });

  assert.equal(result.status, 'passed');
  const switchSell = result.trades.find((trade) => trade.type === 'sell' && trade.code === '513100');
  const switchBuy = result.trades.find((trade) => trade.type === 'buy' && trade.code === '159501');
  assert.ok(switchSell);
  assert.ok(switchBuy);
  assert.equal(switchSell.price, 1.02);
  assert.equal(switchSell.priceSource, 'bid');
  assert.equal(switchSell.datetime, '2026-01-02 09:35');
  assert.equal(switchBuy.price, 1.01);
  assert.equal(switchBuy.priceSource, 'ask');
  assert.equal(switchBuy.datetime, '2026-01-02 09:35');
  assert.match(result.rows[0].datetime, /^2026-01-02 09:35$/);
});

test('quant premium backtest chart returns the full fetched kline window', () => {
  const gaps = Array.from({ length: 300 }, () => 4);
  const result = runQuantPremiumBacktest({
    id: 'full-chart',
    enabled: true,
    highCodes: ['513100'],
    lowCodes: ['159501'],
    activeSide: 'all',
    intraBuyOtherPct: 3
  }, {
    timeframe: '5m',
    historyByCode: {
      '513100': makePremiumCandles(gaps),
      '159501': makePremiumCandles(gaps.map(() => 0))
    },
    navHistoryByCode: {
      '513100': [{ date: '2026-06-12', nav: 1 }],
      '159501': [{ date: '2026-06-12', nav: 1 }]
    }
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.summary.sampleCount, 300);
  assert.equal(result.chart.candles.length, 300);
});

test('quant premium backtest records missing kline codes as quality issues', () => {
  const candles = Array.from({ length: 16 }, (_, index) => ({
    t: Math.floor(Date.UTC(2026, 5, 12, 1, 30) / 1000) + index * 300,
    c: 1.5 + index * 0.001
  }));
  const result = runQuantPremiumBacktest({
    id: 's-missing',
    enabled: true,
    highCodes: ['159509'],
    lowCodes: ['513100']
  }, {
    timeframe: '5m',
    historyByCode: {
      '159509': [],
      '513100': candles
    },
    navHistoryByCode: {
      '159509': [{ date: '2026-06-12', nav: 1.5 }],
      '513100': [{ date: '2026-06-12', nav: 1.5 }]
    },
    dataIssues: {
      kline: [{ code: '159509', timeframe: '5m', reason: 'xueqiu kline empty SZ159509' }]
    }
  });

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.quality.missingKlineCodes, ['159509']);
  assert.match(result.quality.reason, /159509/);
  assert.equal(result.summary.sampleCount, 0);
  assert.equal(result.chart.code, '513100');
  assert.equal(result.chart.candles.length, 16);
  assert.equal(result.chart.markers.length, 0);
});
