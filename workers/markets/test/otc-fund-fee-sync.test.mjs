import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCodes, refreshOtcFundFees } from '../src/otcFundFeeSync.js';

function createDb() {
  const writes = [];
  return {
    writes,
    prepare() {
      return {
        bind(...args) {
          writes.push(args);
          return { run: async () => ({ success: true }) };
        }
      };
    }
  };
}

test('normalizes and deduplicates fee backfill codes', () => {
  assert.deepEqual(normalizeCodes(['sh000834', '000834', 'bad', '006479']), ['000834', '006479']);
});

test('backfills fee data in source-sized batches and writes each result to D1', async () => {
  const db = createDb();
  const sourceBatches = [];
  const codes = Array.from({ length: 61 }, (_, index) => String(index).padStart(6, '0'));
  const env = {
    DB: db,
    OCR: {
      async fetch(_url, init) {
        const body = JSON.parse(init.body);
        sourceBatches.push(body.codes);
        return new Response(JSON.stringify({
          items: body.codes.map((code) => ({
            code,
            ok: true,
            data: {
              code,
              fundType: 'otc',
              source: 'test',
              annualFeeRate: 0.8,
              managementFeeRate: 0.6,
              redeemRules: [['持有不足 7 天', '1.5%']]
            }
          }))
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
  };

  const result = await refreshOtcFundFees(env, { codes });
  assert.equal(result.ok, true);
  assert.equal(result.requested, 61);
  assert.equal(result.sourceBatchCount, 2);
  assert.deepEqual(sourceBatches.map((batch) => batch.length), [60, 1]);
  assert.equal(result.sourceSuccessCount, 61);
  assert.equal(result.d1WriteCount, 61);
  assert.equal(db.writes.length, 61);
  const firstStoredFee = JSON.parse(db.writes[0][10]);
  assert.equal(firstStoredFee.managementFeeRate, 0.6);
  assert.equal(firstStoredFee.redeemFeeRate, 1.5);
});

test('does not claim success when the OCR service is unavailable', async () => {
  const result = await refreshOtcFundFees({ DB: createDb() }, { codes: ['000834'] });
  assert.equal(result.ok, false);
  assert.match(result.error, /OCR service binding unavailable/);
});
