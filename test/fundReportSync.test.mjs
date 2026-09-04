import test from 'node:test';
import assert from 'node:assert/strict';
import { syncFundReport } from '../workers/markets/src/fundReportSync.js';

test('skips unchanged artCode before full OCR parsing', async () => {
  let fetchCount = 0;
  const env = {
    OCR: {
      fetch: async () => {
        fetchCount += 1;
        return new Response(JSON.stringify({ ok: true, artCode: 'A1', reportPeriod: '2026Q2' }), { headers: { 'content-type': 'application/json' } });
      }
    },
    DB: {
      prepare: () => ({ bind: () => ({ first: async () => ({ art_code: 'A1' }) }) })
    }
  };
  const result = await syncFundReport(env, '270042');
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'unchanged');
  assert.equal(fetchCount, 1);
});

test('rejects invalid full OCR extraction', async () => {
  let fetchCount = 0;
  const env = {
    OCR: {
      fetch: async () => {
        fetchCount += 1;
        const body = fetchCount === 1
          ? { ok: true, artCode: 'A2', reportPeriod: '2026Q2' }
          : { ok: false, parserStatus: 'validation_failed' };
        return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      }
    },
    DB: {
      prepare: () => ({ bind: () => ({ first: async () => null }) })
    }
  };
  const result = await syncFundReport(env, '270042');
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'validation_failed');
  assert.equal(fetchCount, 2);
});
