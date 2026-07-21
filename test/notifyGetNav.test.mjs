import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchFundMetricPrices,
  fetchFundMetricsSnapshot
} from '../workers/notify/src/getNav.js';

test('switch strategy price map keeps market center turnover and ytd metrics', async () => {
  const env = {
    MARKETS: {
      fetch: async () => new Response(JSON.stringify({
        items: [{
          ok: true,
          code: '159632',
          name: '华安纳斯达克100ETF',
          price: 1.234,
          previousClose: 1.2,
          change: 0.034,
          changePercent: 2.83,
          volume: 123456,
          turnover: 98765432,
          marketCapital: 4567890000,
          ytdReturn: 12.34,
          return1y: 18.9,
          source: 'xueqiu'
        }]
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  };

  const result = await fetchFundMetricPrices(['159632'], env);
  assert.equal(result['159632'].turnover, 98765432);
  assert.equal(result['159632'].ytdReturn, 12.34);
  assert.equal(result['159632'].changePercent, 2.83);
  assert.equal(result['159632'].source, 'xueqiu');
});

test('switch strategy derives price and NAV from one market-center snapshot', async () => {
  let requestCount = 0;
  const env = {
    MARKETS: {
      fetch: async () => {
        requestCount += 1;
        return new Response(JSON.stringify({
          items: [{
            ok: true,
            code: '513100',
            name: '纳指ETF',
            price: 1.02,
            latestNav: 0.5,
            latestNavDate: '2026-01-01',
            navBase: 1,
            iopv: 1,
            premiumPercent: 2,
            source: 'xueqiu-quote',
            asOf: '2026-07-21T02:00:00.000Z'
          }]
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
  };

  const result = await fetchFundMetricsSnapshot(env, ['513100']);
  assert.equal(requestCount, 1);
  assert.equal(result.priceMap['513100'].price, 1.02);
  assert.equal(result.priceMap['513100'].premiumPercent, 2);
  assert.equal(result.navByCode['513100'].nav, 0.5);
  assert.equal(result.navByCode['513100'].navBase, 1);
  assert.equal(result.navByCode['513100'].premiumPercent, 2);
});
