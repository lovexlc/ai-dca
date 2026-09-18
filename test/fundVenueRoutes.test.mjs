import assert from 'node:assert/strict';
import test from 'node:test';

import { handleFundVenue } from '../workers/markets/src/fundVenueRoutes.js';

function response(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

test('fund venue route classifies OTC, exchange, and ambiguous LOF codes', async () => {
  const originalFetch = globalThis.fetch;
  const rows = {
    '539001': {
      Code: '539001',
      Name: '建信纳斯达克100指数(QDII)A人民币',
      SecurityTypeName: '开放式基金',
      TypeName: 'FUND'
    },
    '513100': {
      Code: '513100',
      Name: '纳指ETF国泰',
      SecurityTypeName: 'ETF',
      TypeName: 'QDII-ETF',
      MktNum: '1'
    },
    '161130': {
      Code: '161130',
      Name: '易方达纳斯达克100ETF联接(QDII-LOF)A人民币',
      SecurityTypeName: 'LOF',
      TypeName: 'QDII-LOF',
      MktNum: '0'
    }
  };
  globalThis.fetch = async (input) => {
    const code = new URL(String(input)).searchParams.get('input');
    return response({ QuotationCodeTable: { Data: [rows[code]] } });
  };

  try {
    const payload = await (await handleFundVenue({}, {
      codes: ['539001', '513100', '161130']
    })).json();
    const byCode = Object.fromEntries(payload.items.map((item) => [item.code, item]));

    assert.equal(byCode['539001'].fundVenue, 'otc');
    assert.equal(byCode['539001'].fundKind, 'qdii');
    assert.equal(byCode['513100'].fundVenue, 'exchange');
    assert.equal(byCode['161130'].fundVenue, '');
    assert.equal(byCode['161130'].ambiguous, true);
    assert.deepEqual(
      byCode['161130'].candidates.map((item) => item.fundVenue).sort(),
      ['exchange', 'otc']
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
