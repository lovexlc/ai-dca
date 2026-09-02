import test from 'node:test';
import assert from 'node:assert/strict';

import notifyWorker from '../workers/notify/src/index.js';
import { hashText } from '../workers/notify/src/clientSettings.js';
import { SWITCH_CANDIDATE_CATALOG } from '../workers/notify/src/switchRecommendation.js';
import {
  isSwitchConfigRunnable,
  MAX_SWITCH_RULES,
  switchConfigKey,
  switchPushDigestKey,
  switchSnapshotKey,
  switchStateKey
} from '../workers/notify/src/switchStrategy.js';

function createMemoryKv(seed = {}) {
  const memory = new Map(Object.entries(seed));
  return {
    async get(key) { return memory.has(key) ? memory.get(key) : null; },
    async put(key, value) { memory.set(key, String(value)); },
    async delete(key) { memory.delete(key); },
    async list({ prefix = '' } = {}) {
      return {
        keys: [...memory.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true
      };
    }
  };
}

function createMarketsBinding() {
  return {
    async fetch(request) {
      const body = await request.json();
      const requested = new Set(body.codes || []);
      const items = SWITCH_CANDIDATE_CATALOG
        .filter((fund) => requested.has(fund.code))
        .map((fund) => ({
          ok: true,
          code: fund.code,
          name: fund.name,
          price: 1,
          latestNav: 1,
          premiumPercent: ['513100', '159501'].includes(fund.code) ? 3.2 : 0.2,
          turnover: fund.code === '159513' ? 1000000 : 100000
        }));
      return Response.json({ items, generatedAt: '2026-07-21T06:00:00.000Z' });
    }
  };
}

async function createEnv({ config = null } = {}) {
  const clientId = 'web:opportunity-test';
  const secret = 'opportunity-secret';
  const settings = {
    clients: {
      [clientId]: {
        clientId,
        clientLabel: 'Opportunity test',
        accountUsername: 'lovexl',
        clientSecretHash: await hashText(secret)
      }
    }
  };
  const seed = { 'notify:settings': JSON.stringify(settings) };
  if (config) seed[switchConfigKey('lovexl')] = JSON.stringify(config);
  return {
    clientId,
    secret,
    env: {
      NOTIFY_STATE: createMemoryKv(seed),
      MARKETS: createMarketsBinding()
    }
  };
}

function requestFor(clientId, secret, path, body) {
  return new Request(`https://example.com/api/notify${path}?clientId=${encodeURIComponent(clientId)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-notify-client-secret': secret,
      'x-notify-account-username': 'lovexl'
    },
    body: JSON.stringify(body)
  });
}

test('opportunity routes create a holding rule and deduplicate repeated creation', async () => {
  const { env, clientId, secret } = await createEnv();
  const holdings = [{ fundCode: '513100', fundName: '持仓基金', quantity: 1000, marketValue: 3200 }];
  const opportunityResponse = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/opportunities', { mode: 'auto', holdings, limit: 10 }),
    env,
    { waitUntil() {} }
  );
  assert.equal(opportunityResponse.status, 200);
  const opportunityPayload = await opportunityResponse.json();
  assert.equal(opportunityPayload.mode, 'holding');
  assert.equal(opportunityPayload.opportunities.length, 1);
  const opportunity = opportunityPayload.opportunities[0];
  assert.equal(opportunity.sourceFund.code, '513100');
  assert.equal(opportunity.targetFund.code, '159513');

  const createBody = {
    opportunityId: opportunity.id,
    evaluatedAt: opportunity.evaluatedAt,
    mode: 'holding',
    holdings,
    feeConfig: { mode: 'estimated_total', estimatedTotalFee: 20 }
  };
  const createResponse = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/rules/from-opportunity', createBody),
    env,
    { waitUntil() {} }
  );
  assert.equal(createResponse.status, 200);
  const created = await createResponse.json();
  assert.equal(created.created, true);
  assert.equal(created.rule.ruleType, 'holding_switch');
  assert.equal(created.rule.preferredCandidateCode, '159513');
  assert.equal(created.rule.candidateFundCodes.includes('159513'), true);
  assert.equal(created.rule.createdFrom, 'opportunity');

  const duplicateResponse = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/rules/from-opportunity', createBody),
    env,
    { waitUntil() {} }
  );
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 200);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.reason, 'existing_rule');
  assert.equal(duplicate.ruleId, created.ruleId);
});

test('switch config is shared by account username across notification devices', async () => {
  const config = {
    enabled: true,
    rules: [{
      id: 'shared-rule',
      enabled: true,
      holdingFundCode: '513100',
      candidateFundCodes: ['159513'],
      thresholdMode: 'fixed',
      thresholdValue: 3
    }]
  };
  const { env, secret } = await createEnv({ config });
  const response = await notifyWorker.fetch(new Request(
    'https://example.com/api/notify/switch/config?clientId=web%3Anew-device',
    {
      headers: {
        'x-notify-client-secret': 'new-device-secret',
        'x-notify-account-username': 'lovexl'
      }
    }
  ), env);
  const payload = await response.json();

  assert.equal(secret, 'opportunity-secret');
  assert.equal(response.status, 200);
  assert.equal(payload.config.rules[0].id, 'shared-rule');
  const storedSettings = JSON.parse(await env.NOTIFY_STATE.get('notify:settings'));
  assert.equal(storedSettings.clients['web:new-device'].accountUsername, 'lovexl');
  assert.equal(await env.NOTIFY_STATE.get('switch:config:web:new-device'), null);
});

test('deleting the last switch rule clears runtime state for all account devices', async () => {
  const config = {
    enabled: true,
    rules: [{ id: 'last-rule', enabled: true, holdingFundCode: '513100', candidateFundCodes: ['159513'] }]
  };
  const { env, clientId, secret } = await createEnv({ config });
  const settings = JSON.parse(await env.NOTIFY_STATE.get('notify:settings'));
  const pairedClientId = 'web:paired-device';
  settings.clients[pairedClientId] = {
    clientId: pairedClientId,
    clientLabel: 'Paired device',
    accountUsername: 'lovexl',
    clientSecretHash: await hashText('paired-secret')
  };
  await env.NOTIFY_STATE.put('notify:settings', JSON.stringify(settings));
  for (const key of [
    ...[clientId, pairedClientId].flatMap((id) => [switchSnapshotKey(id), switchStateKey(id), switchPushDigestKey(id)])
  ]) {
    await env.NOTIFY_STATE.put(key, JSON.stringify({ old: true }));
  }

  const response = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/config', { enabled: false, activeRuleId: '', rules: [] }),
    env
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.config.rules, []);
  for (const id of [clientId, pairedClientId]) {
    assert.equal(await env.NOTIFY_STATE.get(switchSnapshotKey(id)), null);
    assert.equal(await env.NOTIFY_STATE.get(switchStateKey(id)), null);
    assert.equal(await env.NOTIFY_STATE.get(switchPushDigestKey(id)), null);
  }
});

test('switch config projection does not rewrite an unchanged account rule set', async () => {
  const config = {
    enabled: true,
    activeRuleId: 'stable-rule',
    rules: [{
      id: 'stable-rule',
      enabled: true,
      holdingFundCode: '513100',
      candidateFundCodes: ['159513'],
      thresholdMode: 'fixed',
      thresholdValue: 3
    }],
    updatedAt: '2026-07-21T06:00:00.000Z'
  };
  const { env, clientId, secret } = await createEnv({ config });
  const body = {
    enabled: true,
    activeRuleId: 'stable-rule',
    rules: config.rules,
    benchmarkCodes: ['513100'],
    enabledCodes: ['159513'],
    clientLabel: 'projection-device'
  };

  const firstResponse = await notifyWorker.fetch(requestFor(clientId, secret, '/switch/config', body), env);
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 10));

  const secondResponse = await notifyWorker.fetch(requestFor(clientId, secret, '/switch/config', body), env);
  const second = await secondResponse.json();
  assert.equal(secondResponse.status, 200);
  assert.equal(second.config.updatedAt, first.config.updatedAt);
});

test('switch config uses current clientId when the request has no account username', async () => {
  const config = {
    enabled: true,
    rules: [{ id: 'anonymous-switch-rule', enabled: true }]
  };
  const { env, clientId, secret } = await createEnv({ config: { rules: [{ id: 'logged-in-rule' }] } });
  await env.NOTIFY_STATE.put(switchConfigKey(clientId), JSON.stringify(config));

  const response = await notifyWorker.fetch(new Request(
    `https://example.com/api/notify/switch/config?clientId=${encodeURIComponent(clientId)}`,
    { headers: { 'x-notify-client-secret': secret } }
  ), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.config.rules[0].id, 'anonymous-switch-rule');
});

test('stale opportunity requires explicit latest-data confirmation', async () => {
  const { env, clientId, secret } = await createEnv();
  const holdings = [{ fundCode: '513100', quantity: 1000 }];
  const listResponse = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/opportunities', { mode: 'holding', holdings }),
    env,
    { waitUntil() {} }
  );
  const opportunity = (await listResponse.json()).opportunities[0];
  const response = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/rules/from-opportunity', {
      opportunityId: opportunity.id,
      evaluatedAt: '2026-01-01T00:00:00.000Z',
      mode: 'holding',
      holdings,
      feeConfig: { mode: 'estimated_total', estimatedTotalFee: 20 }
    }),
    env,
    { waitUntil() {} }
  );
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.reason, 'opportunity_expired');
  assert.equal(payload.latestOpportunity.id, opportunity.id);
});

test('market opportunity creates a runnable market-watch rule without a fee', async () => {
  const { env, clientId, secret } = await createEnv();
  const listResponse = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/opportunities', { mode: 'market', holdings: [], limit: 5 }),
    env,
    { waitUntil() {} }
  );
  const list = await listResponse.json();
  assert.equal(list.mode, 'market');
  assert.equal(list.opportunities.length > 0, true);
  const opportunity = list.opportunities[0];
  const createResponse = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/rules/from-opportunity', {
      opportunityId: opportunity.id,
      evaluatedAt: opportunity.evaluatedAt,
      mode: 'market',
      holdings: []
    }),
    env,
    { waitUntil() {} }
  );
  const created = await createResponse.json();
  assert.equal(createResponse.status, 200);
  assert.equal(created.rule.ruleType, 'market_watch');
  assert.equal(created.rule.holdingQuantity, undefined);
  assert.equal(isSwitchConfigRunnable(created.config), true);
});

test('market-watch rule upgrades in place when a related holding appears', async () => {
  const { env, clientId, secret } = await createEnv();
  const marketListResponse = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/opportunities', { mode: 'market', holdings: [], limit: 5 }),
    env,
    { waitUntil() {} }
  );
  const marketOpportunity = (await marketListResponse.json()).opportunities[0];
  const marketCreateResponse = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/rules/from-opportunity', {
      opportunityId: marketOpportunity.id,
      evaluatedAt: marketOpportunity.evaluatedAt,
      mode: 'market',
      holdings: []
    }),
    env,
    { waitUntil() {} }
  );
  const marketRule = await marketCreateResponse.json();
  const holdings = [{ fundCode: marketOpportunity.sourceFund.code, quantity: 500, marketValue: 1600 }];
  const holdingListResponse = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/opportunities', { mode: 'holding', holdings }),
    env,
    { waitUntil() {} }
  );
  const holdingOpportunity = (await holdingListResponse.json()).opportunities[0];
  assert.equal(holdingOpportunity.existingRule.ruleType, 'market_watch');

  const upgradeResponse = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/rules/from-opportunity', {
      opportunityId: holdingOpportunity.id,
      evaluatedAt: holdingOpportunity.evaluatedAt,
      mode: 'holding',
      holdings,
      upgradeMarketRule: true,
      feeConfig: { mode: 'estimated_total', estimatedTotalFee: 15 }
    }),
    env,
    { waitUntil() {} }
  );
  const upgraded = await upgradeResponse.json();
  assert.equal(upgradeResponse.status, 200, JSON.stringify(upgraded));
  assert.equal(upgraded.reason, 'upgraded');
  assert.equal(upgraded.ruleId, marketRule.ruleId);
  assert.equal(upgraded.rule.ruleType, 'holding_switch');
  assert.equal(upgraded.rule.holdingQuantity, 500);
  assert.equal(upgraded.rule.feeConfig.estimatedTotalFee, 15);
  assert.equal(isSwitchConfigRunnable(upgraded.config), true);
});

test('opportunity route rejects a new rule when the rule limit is reached', async () => {
  const rules = Array.from({ length: MAX_SWITCH_RULES }, (_, index) => ({
    id: `rule-limit-${index}`,
    enabled: false,
    holdingFundCode: `5000${String(index).padStart(2, '0')}`,
    candidateFundCodes: ['159513'],
    thresholdMode: 'fixed',
    thresholdValue: 3
  }));
  const { env, clientId, secret } = await createEnv({ config: { enabled: false, rules } });
  const holdings = [{ fundCode: '513100', quantity: 1000, marketValue: 3200 }];
  const listResponse = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/opportunities', { mode: 'holding', holdings }),
    env,
    { waitUntil() {} }
  );
  const opportunity = (await listResponse.json()).opportunities[0];
  const response = await notifyWorker.fetch(
    requestFor(clientId, secret, '/switch/rules/from-opportunity', {
      opportunityId: opportunity.id,
      evaluatedAt: opportunity.evaluatedAt,
      mode: 'holding',
      holdings,
      feeConfig: { mode: 'estimated_total', estimatedTotalFee: 20 }
    }),
    env,
    { waitUntil() {} }
  );
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.reason, 'rule_limit');
});
