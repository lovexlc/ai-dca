import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchBacktestData } from '../src/app/backtestDataFetcher.js';

test('fetchBacktestData adapts legacy premium rows and falls back to IOPV NAV', async () => {
  const originalFetch = globalThis.fetch;
  const rows = Array.from({ length: 3 }, (_, index) => ({
    date: `2026-06-${String(index + 1).padStart(2, '0')}`,
    sell_bid: 1.03 + index * 0.001,
    sell_ask: 1.031 + index * 0.001,
    sell_iopv: 1,
    buy_bid: 1.00 + index * 0.001,
    buy_ask: 1.001 + index * 0.001,
    buy_iopv: 1
  }));

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/api/v1/quant/historical-premiums')) {
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (requestUrl.includes('/api/holdings/nav-history')) {
      return new Response(JSON.stringify({ ok: false, error: 'nav unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`unexpected fetch ${requestUrl}`);
  };

  try {
    const { historyByCode, navHistoryByCode } = await fetchBacktestData(['159513', '513100'], {
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      highCodes: ['159513'],
      lowCodes: ['513100']
    });

    assert.equal(historyByCode['159513'].length, 3);
    assert.equal(historyByCode['513100'].length, 3);
    assert.equal(navHistoryByCode['159513'].length, 3);
    assert.equal(navHistoryByCode['513100'].length, 3);
    assert.equal(historyByCode['159513'][0].bidPrice, 1.03);
    assert.deepEqual(navHistoryByCode['513100'][0], { date: '2026-06-01', nav: 1 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
