import assert from 'node:assert/strict';
import test from 'node:test';
import { handleExchangeFundList } from '../workers/markets/src/exchangeFundRoutes.js';

test('exchange fund HTTP route forwards sorting and list filters to the same DO', async () => {
  let received;
  const env = {
    EXCHANGE_FUND_HUB: {
      getByName(name) {
        assert.equal(name, 'cn-exchange-funds');
        return {
          async getSortedSnapshot(payload) {
            received = payload;
            return { ok: true, ready: true, total: 1, items: [{ code: '159501' }] };
          },
        };
      },
    },
  };
  const request = new Request('https://test.freebacktrack.tech/api/markets/exchange-fund-list?symbols=sh159501,513100&heldSymbols=513100&q=纳指&heldOnly=1&sortBy=premium&order=desc&limit=50&offset=5&orderBy=%5B%7B%22field%22%3A%22turnover%22%2C%22dir%22%3A%22asc%22%7D%5D');
  const response = await handleExchangeFundList(env, request, new URL(request.url));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(received, {
    symbols: ['sh159501', '513100'],
    heldSymbols: ['513100'],
    query: '纳指',
    heldOnly: true,
    sortBy: 'premium',
    order: 'desc',
    orderBy: [{ field: 'turnover', dir: 'asc' }],
    limit: '50',
    offset: '5',
  });
});
