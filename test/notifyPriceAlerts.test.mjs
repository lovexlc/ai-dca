import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateHoldingAlertRules } from '../workers/notify/src/alertRuleEvaluation.js';

function buildJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('evaluateHoldingAlertRules fetches live fund metrics and triggers cost based gain alerts', async () => {
  const metricRequests = [];
  let writtenState = null;
  const env = {
    __notifySettings: {},
    __notifyCurrentClientId: 'web:test',
    PUBLIC_DATA_BASE_URL: 'https://example.test',
    MARKETS: {
      fetch: async (request) => {
        const body = await request.json();
        metricRequests.push(body);
        return buildJsonResponse({
          items: [{
            ok: true,
            code: '021000',
            currentPrice: 2.4,
            previousClose: 2.2,
            latestNav: 2.4,
            previousNav: 2.2,
            latestNavDate: '2026-06-26',
            source: 'test'
          }]
        });
      }
    }
  };

  const result = await evaluateHoldingAlertRules(env, [{
    ruleId: 'holding-alert:021000:gain:test',
    symbol: '021000',
    name: '南方纳指 I',
    alertType: 'gain',
    threshold: 10,
    holdingCost: 2.139,
    fundKind: 'qdii',
    cooldownHours: 24
  }], {
    clientId: 'web:test',
    settings: {},
    readState: async () => ({}),
    writeState: async (state) => { writtenState = state; }
  });

  assert.equal(metricRequests.length, 1);
  assert.deepEqual(metricRequests[0].codes, ['021000']);
  assert.equal(metricRequests[0].refresh, true);
  assert.equal(metricRequests[0].fundKinds['021000'], 'qdii');
  assert.equal(result.delivered.length, 1);
  assert.equal(result.delivered[0].symbol, '021000');
  assert.ok(writtenState['holding-alert:021000:gain:test'].lastPushedAt > 0);
});
