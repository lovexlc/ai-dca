import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergePricePushItems } from '../src/app/navService.js';
import {
  normalizeMarketSnapshotItem,
  normalizeMarketSummarySnapshotItem,
  runMarketDataPush,
  runMarketSummaryPush
} from '../workers/notify/src/marketDataPush.js';

function createMemoryKv(seed = {}) {
  const memory = new Map(Object.entries(seed));
  return {
    memory,
    async get(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    async put(key, value) {
      memory.set(key, String(value));
    },
    async delete(key) {
      memory.delete(key);
    }
  };
}

function createWsHubBinding(snapshot, priceBodies = []) {
  return {
    idFromName(name) {
      return name;
    },
    get() {
      return {
        async fetch(url, init = {}) {
          const path = new URL(String(url)).pathname;
          if (path === '/subscribed-symbols') {
            return new Response(JSON.stringify(snapshot), {
              headers: { 'content-type': 'application/json' }
            });
          }
          if (path === '/prices') {
            const body = JSON.parse(String(init.body || '{}'));
            priceBodies.push(body);
            return new Response(JSON.stringify({
              delivered: 1,
              failed: 0,
              subscribed: 1,
              total: Array.isArray(body.items) ? body.items.length : 0
            }), { headers: { 'content-type': 'application/json' } });
          }
          return new Response('not found', { status: 404 });
        }
      };
    }
  };
}

test('market realtime normalizes exchange fund snapshot fields', () => {
  const item = normalizeMarketSnapshotItem({
    code: '513100',
    name: '纳指ETF',
    market: 'cn',
    fundKind: 'exchange',
    price: 2.365,
    previousClose: 2.273,
    change: 0.092,
    changePercent: 4.05,
    volume: 12345678,
    turnover: 29382745.67,
    marketCapital: 2930000000,
    latestNav: 2.065,
    latestNavDate: '2026-06-02',
    iopv: 2.0647,
    asOf: '2026-06-03T10:12:03+08:00',
    quoteDate: '2026-06-03',
    marketState: 'REGULAR',
    source: 'fund-metrics'
  });

  assert.equal(item.code, '513100');
  assert.equal(item.kind, 'exchange_fund');
  assert.equal(item.price, 2.365);
  assert.equal(item.prevClose, 2.273);
  assert.equal(item.volume, 12345678);
  assert.equal(item.turnover, 29382745.67);
  assert.equal(item.marketCapital, 2930000000);
  assert.equal(item.latestNav, 2.065);
  assert.equal(item.latestNavDate, '2026-06-02');
  assert.equal(item.estimatedNav, 2.0647);
  assert.equal(item.estimatedNavSource, 'iopv');
  assert.equal(item.premiumPercent, 14.5445);
  assert.equal(item.quoteAt, '2026-06-03T10:12:03+08:00');
});

test('market realtime normalizes Yahoo market summary snapshot fields', () => {
  const item = normalizeMarketSummarySnapshotItem({
    symbol: 'ES=F',
    name: 'S&P Futures',
    price: 7508,
    priceText: '7,508.00',
    change: -43.25,
    changeText: '-43.25',
    changePercent: -0.5728,
    changePercentText: '-0.57%',
    marketState: 'REGULAR',
    asOf: '2026-07-08T12:17:07.000Z',
    timeText: '8:17AM EDT',
    delayMinutes: 10,
    source: 'Delayed Quote'
  }, { region: 'US' });

  assert.equal(item.code, 'ES=F');
  assert.equal(item.symbol, 'ES=F');
  assert.equal(item.kind, 'market_summary');
  assert.equal(item.summaryRegion, 'US');
  assert.equal(item.priceText, '7,508.00');
  assert.equal(item.changePercentText, '-0.57%');
  assert.equal(item.asOf, '2026-07-08T12:17:07.000Z');
});

test('market summary push refreshes markets worker and publishes subscribed symbols', async () => {
  const priceBodies = [];
  let marketsCalls = 0;
  const kv = createMemoryKv({
    'notify:settings': JSON.stringify({
      clients: {},
      gcmRegistrations: [{
        id: 'web-ws:web:client-1',
        deviceInstallationId: 'web-ws:web:client-1',
        token: 'ws-token',
        isWebClient: true,
        capabilities: ['market']
      }]
    })
  });
  const env = {
    NOTIFY_STATE: kv,
    WS_HUB: createWsHubBinding({
      symbols: ['ES=F'],
      topics: ['market.summary'],
      connections: 1
    }, priceBodies),
    MARKETS: {
      async fetch(request) {
        marketsCalls += 1;
        assert.match(String(request.url), /\/market-summary\?region=US&refresh=1$/);
        return new Response(JSON.stringify({
          region: 'US',
          title: 'US Markets',
          items: [{
            symbol: 'ES=F',
            name: 'S&P Futures',
            price: 7508,
            priceText: '7,508.00',
            change: -43.25,
            changeText: '-43.25',
            changePercent: -0.5728,
            changePercentText: '-0.57%',
            marketState: 'REGULAR',
            asOf: '2026-07-08T12:17:07.000Z',
            sparkline: [7510, 7509.5, null, 7508],
            sparklineRange: '1d',
            sparklineInterval: '15m'
          }, {
            symbol: 'NQ=F',
            name: 'Nasdaq Futures',
            price: 29146.25
          }]
        }), { headers: { 'content-type': 'application/json' } });
      }
    }
  };

  const result = await runMarketSummaryPush(env);

  assert.equal(marketsCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.changed, 2);
  assert.equal(result.delivered, 1);
  assert.equal(priceBodies.length, 1);
  assert.equal(priceBodies[0].source, 'markets/market-summary');
  assert.deepEqual(priceBodies[0].topics, ['market.summary']);
  assert.deepEqual(priceBodies[0].items.map((item) => item.code), ['ES=F']);
  assert.deepEqual(priceBodies[0].items[0].sparkline, [7510, 7509.5, 7508]);
  assert.equal(priceBodies[0].items[0].sparklineInterval, '15m');
  assert.equal(JSON.parse(kv.memory.get('market-summary-push-cache:US:ES=F')).price, 7508);
  assert.deepEqual(JSON.parse(kv.memory.get('market-summary-push-cache:US:ES=F')).sparkline, [7510, 7509.5, 7508]);
});

test('market summary push skips upstream when no summary topic is online', async () => {
  let marketsCalls = 0;
  const kv = createMemoryKv({
    'notify:settings': JSON.stringify({
      clients: {},
      gcmRegistrations: [{
        id: 'web-ws:web:client-1',
        deviceInstallationId: 'web-ws:web:client-1',
        token: 'ws-token',
        isWebClient: true,
        capabilities: ['market']
      }]
    })
  });
  const env = {
    NOTIFY_STATE: kv,
    WS_HUB: createWsHubBinding({
      symbols: ['ES=F'],
      topics: ['market.price'],
      connections: 1
    }),
    MARKETS: {
      async fetch() {
        marketsCalls += 1;
        return new Response('{}');
      }
    }
  };

  const result = await runMarketSummaryPush(env);

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no-online-summary-subscriptions');
  assert.equal(marketsCalls, 0);
});

test('market price push ignores summary-only websocket subscriptions', async () => {
  let marketsCalls = 0;
  const kv = createMemoryKv({
    'notify:settings': JSON.stringify({
      clients: {},
      gcmRegistrations: [{
        id: 'web-ws:web:client-1',
        deviceInstallationId: 'web-ws:web:client-1',
        token: 'ws-token',
        isWebClient: true,
        capabilities: ['market']
      }]
    })
  });
  const env = {
    NOTIFY_STATE: kv,
    WS_HUB: createWsHubBinding({
      symbols: ['ES=F'],
      topics: ['market.summary'],
      connections: 1
    }),
    MARKETS: {
      async fetch() {
        marketsCalls += 1;
        return new Response('{}');
      }
    }
  };

  const result = await runMarketDataPush(env);

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no-online-subscriptions');
  assert.equal(marketsCalls, 0);
});

test('market realtime merge preserves snapshot and applies WS fields', () => {
  const existing = [{
    code: '513100',
    latestNav: 2.05,
    latestNavDate: '2026-06-01',
    previousNav: 2.01,
    price: 2.32,
    currentPrice: 2.32
  }];

  const merged = mergePricePushItems(existing, [{
    code: '513100',
    price: 2.365,
    prevClose: 2.273,
    changePercent: 4.05,
    volume: 12345678,
    turnover: 29382745.67,
    marketCapital: 2930000000,
    latestNav: 2.065,
    latestNavDate: '2026-06-02',
    estimatedNav: 2.0647,
    premiumPercent: 14.5411,
    quoteAt: '2026-06-03T10:12:03+08:00',
    quoteDate: '2026-06-03',
    source: 'fund-metrics'
  }]);

  assert.notEqual(merged, existing);
  assert.equal(merged[0].price, 2.365);
  assert.equal(merged[0].previousClose, 2.273);
  assert.equal(merged[0].previousNav, 2.273);
  assert.equal(merged[0].volume, 12345678);
  assert.equal(merged[0].turnover, 29382745.67);
  assert.equal(merged[0].marketCapital, 2930000000);
  assert.equal(merged[0].latestNav, 2.065);
  assert.equal(merged[0].latestNavDate, '2026-06-02');
  assert.equal(merged[0].estimatedNav, 2.0647);
  assert.equal(merged[0].premiumPercent, 14.5411);
  assert.equal(merged[0].quoteAt, '2026-06-03T10:12:03+08:00');
  assert.equal(merged[0].asOf, '2026-06-03T10:12:03+08:00');
});
