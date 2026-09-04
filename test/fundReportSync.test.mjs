import test from 'node:test';
import assert from 'node:assert/strict';
import { syncFundReport } from '../workers/markets/src/fundReportSync.js';

test('skips invalid OCR extraction', async () => {
  const env = {
    OCR: { fetch: async () => new Response(JSON.stringify({ ok: false, parserStatus: 'validation_failed' }), { headers: { 'content-type': 'application/json' } }) },
    DB: {}
  };
  const result = await syncFundReport(env, '270042');
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'validation_failed');
});
