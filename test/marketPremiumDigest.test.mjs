import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMarketPremiumDigestPayload } from '../workers/notify/src/marketPremiumDigest.js';
import notifyWorker from '../workers/notify/src/index.js';

function metric(code, name, premiumPercent, { price = 1, navBase = 1, previousClose = 1, asOf = '2026-07-07T07:34:57.000Z' } = {}) {
  return {
    ok: true,
    code,
    name,
    price,
    navBase,
    previousClose,
    premiumPercent,
    asOf,
    source: 'xueqiu-quote'
  };
}

test('market premium digest keeps all comparable groups without threshold filtering', () => {
  const { notification, meta } = buildMarketPremiumDigestPayload({
    generatedAt: '2026-07-07T09:03:08.734Z',
    tradingSession: false,
    items: [
      metric('159509', '纳指科技ETF景顺', 15.79, { price: 2.603, navBase: 2.248, previousClose: 2.615 }),
      metric('159501', '纳指ETF嘉实', 8.29, { price: 2.051, navBase: 1.894, previousClose: 2.053 }),
      metric('513100', '纳指ETF国泰', 7.56, { price: 2.169, navBase: 2.0166, previousClose: 2.171 }),
      metric('159941', '纳指ETF广发', 7.48, { price: 1.624, navBase: 1.511, previousClose: 1.625 }),
      metric('513110', '纳指ETF华泰柏瑞', 5.29, { price: 2.438, navBase: 2.3156, previousClose: 2.45 }),
      metric('513500', '标普500ETF博时', 4.2, { price: 2.528, navBase: 2.426, previousClose: 2.511 }),
      metric('513650', '标普500ETF南方', 3.18, { price: 1.907, navBase: 1.8482, previousClose: 1.894 }),
      metric('159612', '标普500ETF国泰', 3.94, { price: 1.979, navBase: 1.904, previousClose: 1.971 }),
      metric('159655', '标普500ETF华夏', 3.54, { price: 1.929, navBase: 1.863, previousClose: 1.911 }),
      metric('159577', '美国50ETF', 2.33, { price: 1.582, navBase: 1.546, previousClose: 1.585 }),
      metric('513850', '美国50ETF易方达', 3.09, { price: 1.772, navBase: 1.7189, previousClose: 1.762 })
    ]
  });

  assert.equal(notification.title, '今日QDII溢价市场速读');
  assert.match(notification.summary, /159501/);
  assert.match(notification.summary, /513100/);
  assert.match(notification.body, /增加持仓/);
  assert.match(notification.body, /配置 H\/L/);
  assert.match(notification.body, /开启 Server酱³\/浏览器通知/);
  assert.equal(meta.rows.length, 4);
  assert.deepEqual(meta.rows.map((row) => row.label), [
    '纳指科技 ↔ 纳指100',
    '纳指100 ↔ 纳指100',
    '标普500 ↔ 标普500',
    '美国50 ↔ 美国50'
  ]);
  assert.deepEqual(meta.rows.map((row) => row.gapPct), [10.5, 3, 1.02, 0.76]);
  assert.equal(meta.rows[2].from, '513500');
  assert.equal(meta.rows[2].to, '513650');
  assert.equal(meta.rows[3].from, '513850');
  assert.equal(meta.rows[3].to, '159577');
});

test('admin market premium digest dry-run is admin protected and resolves lovexl client', async () => {
  const clientId = 'web:test-lovexl';
  const settings = {
    clients: {
      [clientId]: {
        clientId,
        accountUsername: 'lovexl',
        clientLabel: 'Web 控制台 @ tools.freebacktrack.tech',
        serverChan3: { uid: 'uid', sendKey: 'send-key' },
        state: { recentEvents: [] }
      }
    },
    gcmRegistrations: []
  };
  const requestedBodies = [];
  const env = {
    ADMIN_TOKEN: 'secret-admin-token',
    NOTIFY_STATE: {
      async get(key) {
        return key === 'notify:settings' ? JSON.stringify(settings) : null;
      },
      async put() {
        throw new Error('dry-run should not write settings');
      }
    },
    MARKETS: {
      async fetch(request) {
        requestedBodies.push(await request.json());
        return new Response(JSON.stringify({
          generatedAt: '2026-07-07T09:03:08.734Z',
          tradingSession: true,
          items: [
            metric('159509', '纳指科技ETF景顺', 15.79, { price: 2.603, navBase: 2.248, previousClose: 2.615 }),
            metric('159501', '纳指ETF嘉实', 8.29, { price: 2.051, navBase: 1.894, previousClose: 2.053 }),
            metric('513100', '纳指ETF国泰', 7.56, { price: 2.169, navBase: 2.0166, previousClose: 2.171 }),
            metric('159941', '纳指ETF广发', 7.48, { price: 1.624, navBase: 1.511, previousClose: 1.625 }),
            metric('513110', '纳指ETF华泰柏瑞', 5.29, { price: 2.438, navBase: 2.3156, previousClose: 2.45 }),
            metric('513500', '标普500ETF博时', 4.2, { price: 2.528, navBase: 2.426, previousClose: 2.511 }),
            metric('513650', '标普500ETF南方', 3.18, { price: 1.907, navBase: 1.8482, previousClose: 1.894 }),
            metric('159612', '标普500ETF国泰', 3.94, { price: 1.979, navBase: 1.904, previousClose: 1.971 }),
            metric('159655', '标普500ETF华夏', 3.54, { price: 1.929, navBase: 1.863, previousClose: 1.911 }),
            metric('159577', '美国50ETF', 2.33, { price: 1.582, navBase: 1.546, previousClose: 1.585 }),
            metric('513850', '美国50ETF易方达', 3.09, { price: 1.772, navBase: 1.7189, previousClose: 1.762 })
          ]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }
  };
  const request = new Request('https://api.freebacktrack.tech/api/notify/admin/market-premium-digest', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-admin-token',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ dryRun: true, accountUsername: 'lovexl' })
  });

  const response = await notifyWorker.fetch(request, env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.clientId, clientId);
  assert.equal(body.meta.tradingSession, true);
  assert.equal(body.meta.rows.length, 4);
  assert.equal(requestedBodies.length, 1);
  assert.equal(requestedBodies[0].refresh, true);
  assert.ok(requestedBodies[0].codes.includes('159509'));
});
