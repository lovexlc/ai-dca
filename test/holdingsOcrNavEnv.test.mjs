import assert from 'node:assert/strict';
import test from 'node:test';

import { readFundNavSnapshot } from '../workers/ocr-proxy/src/holdingsNavRoutes.js';

test('OCR holdings NAV snapshot uses MARKETS service binding env', async () => {
  const requests = [];
  const env = {
    MARKETS: {
      async fetch(request) {
        requests.push(request);
        return new Response(JSON.stringify({
          items: [{
            ok: true,
            code: '000834',
            name: '大成纳斯达克100ETF联接(QDII)A',
            latestNav: 3.4567,
            latestNavDate: '2026-06-10',
            fundKind: 'qdii',
            source: 'fund-metrics'
          }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }
  };

  const snapshot = await readFundNavSnapshot('000834', '2026-06-11T12:00:00.000+08:00', env);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(snapshot.code, '000834');
  assert.equal(snapshot.latestNav, 3.4567);
  assert.equal(snapshot.fundKind, 'qdii');
});
