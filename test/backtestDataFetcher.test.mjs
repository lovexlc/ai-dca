import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchBacktestData } from '../src/app/backtestDataFetcher.js';

function datedRows(startDay, count, mapper) {
  return Array.from({ length: count }, (_, index) => {
    const day = startDay + index;
    const date = `2026-06-${String(day).padStart(2, '0')}`;
    return mapper(date, index);
  });
}

test('fetchBacktestData aligns price candles to the common NAV date range', async () => {
  const originalFetch = globalThis.fetch;
  const requestedKlineUrls = [];
  const klineByCode = {
    '159513': [
      ...datedRows(1, 2, (date, index) => ({ date, close: 1.01 + index * 0.001 })),
      ...datedRows(3, 12, (date, index) => ({ date, close: 1.03 + index * 0.001 }))
    ],
    '513100': [
      ...datedRows(1, 2, (date, index) => ({ date, close: 1.02 + index * 0.001 })),
      ...datedRows(3, 12, (date, index) => ({ date, close: 1.04 + index * 0.001 }))
    ]
  };
  const navByCode = {
    '159513': datedRows(3, 12, (date) => ({ date, nav: 1 })),
    '513100': datedRows(3, 12, (date) => ({ date, nav: 1 }))
  };

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    const klineMatch = requestUrl.match(/\/api\/markets\/kline\/(\d{6})/);
    if (klineMatch) {
      requestedKlineUrls.push(new URL(requestUrl, 'http://localhost'));
      return new Response(JSON.stringify({ candles: klineByCode[klineMatch[1]] || [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    const navUrl = new URL(requestUrl, 'http://localhost');
    if (navUrl.pathname === '/api/holdings/nav-history') {
      const code = navUrl.searchParams.get('code');
      return new Response(JSON.stringify({
        ok: true,
        items: navByCode[code] || [],
        generatedAt: '2026-06-15T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z'
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`unexpected fetch ${requestUrl}`);
  };

  try {
    const { historyByCode, navHistoryByCode } = await fetchBacktestData(['159513', '513100'], {
      startDate: '2026-06-01',
      endDate: '2026-06-14',
      highCodes: ['159513'],
      lowCodes: ['513100'],
      forceRefresh: true
    });

    assert.equal(historyByCode['159513'].length, 12);
    assert.equal(historyByCode['513100'].length, 12);
    assert.equal(historyByCode['159513'][0].date, '2026-06-03');
    assert.equal(historyByCode['513100'][0].date, '2026-06-03');
    assert.equal(navHistoryByCode['159513'].length, 12);
    assert.equal(navHistoryByCode['513100'].length, 12);
    assert.deepEqual(navHistoryByCode['513100'][0], { date: '2026-06-03', nav: 1 });
    assert.equal(requestedKlineUrls.length, 2);
    for (const url of requestedKlineUrls) {
      assert.equal(url.searchParams.get('limit'), 'all');
      assert.equal(url.searchParams.get('session'), 'all');
      assert.equal(url.searchParams.get('includeR2'), '1');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
