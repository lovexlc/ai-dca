import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectFundKind,
  normalizeFundKind
} from '../src/app/holdingsLedgerBasics.js';
import { handleFundMetrics } from '../workers/markets/src/fundMetricsRoutes.js';
import { isExchangeFundCode } from '../workers/notify/src/getNav.js';
import { isExchangeLikeCode } from '../workers/notify/src/holdingsSnapshotFetch.js';

test('539001 is treated as an OTC QDII fund across holdings paths', () => {
  const name = '建信纳斯达克100指数(QDII)A人民币';

  assert.equal(detectFundKind('539001', name), 'qdii');
  assert.equal(normalizeFundKind('exchange', '539001', name), 'qdii');
  assert.equal(isExchangeFundCode('539001'), false);
  assert.equal(isExchangeLikeCode('539001'), false);
  assert.equal(isExchangeFundCode('513100'), true);
  assert.equal(isExchangeLikeCode('513100'), true);
});

test('fund metrics routes 539001 through Danjuan NAV instead of Tencent quotes', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes('/djapi/fund/derived/539001')) {
      return jsonResponse({
        result_code: 0,
        data: {
          unit_nav: '1.2345',
          nav_grtd: '0.50',
          end_date: '2026-09-17',
          updated_at: Date.parse('2026-09-17T15:00:00+08:00')
        }
      });
    }
    if (url.includes('/djapi/fund/detail/539001')) {
      return jsonResponse({ result_code: 0, data: { fund_position: {} } });
    }
    if (url.endsWith('/djapi/fund/539001')) {
      return jsonResponse({
        result_code: 0,
        data: {
          fd_code: '539001',
          fd_name: '建信纳斯达克100指数(QDII)A人民币',
          fd_full_name: '建信纳斯达克100指数(QDII)A人民币',
          type_desc: 'QDII',
          fd_type: 11
        }
      });
    }
    throw new Error('unexpected quote request: ' + url);
  };

  try {
    const response = await handleFundMetrics({}, {
      codes: ['539001'],
      refresh: true,
      fundKinds: { '539001': 'qdii' }
    });
    const payload = await response.json();
    const item = payload.items[0];

    assert.equal(payload.successCount, 1);
    assert.equal(item.ok, true);
    assert.equal(item.source, 'danjuan');
    assert.equal(item.fundKind, 'qdii');
    assert.equal(item.latestNav, 1.2345);
    assert.equal(requestedUrls.some((url) => url.includes('xueqiu')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
